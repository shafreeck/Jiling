use crate::db::{Db, TaskSnapshot};
use dashmap::DashMap;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use crate::acp::types::*;
use crate::acp::provider::*;
use crate::acp::discovery::*;
use crate::acp::auth::*;

pub struct GlobalAcpManager {
    app_handle: tauri::AppHandle,
    pub db: Arc<Mutex<Db>>,
    providers: Arc<DashMap<String, ProviderDescriptor>>,
    pub current_models: Arc<DashMap<String, Vec<Value>>>,
    tx_map: Arc<DashMap<String, mpsc::UnboundedSender<Value>>>,
    pub pending_runs: Arc<DashMap<String, tokio::sync::oneshot::Sender<Result<String, String>>>>,
}

impl GlobalAcpManager {
    pub fn new(app_handle: tauri::AppHandle) -> Arc<Self> {
        let db = Arc::new(Mutex::new(Db::new().expect("Failed to initialize DB")));
        let providers = Arc::new(DashMap::new());
        let current_models = Arc::new(DashMap::new());
        let tx_map = Arc::new(DashMap::new());
        let pending_runs = Arc::new(DashMap::new());

        let local_providers = discover_local_providers();
        for p in &local_providers {
            providers.insert(p.id.clone(), p.clone());
        }

        let manager = Arc::new(GlobalAcpManager {
            app_handle,
            db,
            providers,
            current_models,
            tx_map,
            pending_runs,
        });

        let manager_clone = Arc::clone(&manager);
        let lp_clone = local_providers.clone();
        tauri::async_runtime::spawn(async move {
            for p in lp_clone {
                let _ = manager_clone.ensure_provider_running(&p.id).await;
            }
        });

        manager
    }

    pub async fn ensure_provider_running(&self, provider_id: &str) -> Result<mpsc::UnboundedSender<Value>, String> {
        if let Some(tx) = self.tx_map.get(provider_id) {
            return Ok(tx.value().clone());
        }

        let descriptor = self.providers.get(provider_id)
            .ok_or_else(|| format!("Provider {} not found", provider_id))?
            .clone();

        let identity = load_local_identity(descriptor.config_dir.as_deref().unwrap_or(provider_id))?;
        let (tx, rx) = mpsc::unbounded_channel::<Value>();
        
        let runner = ProviderRunner {
            descriptor,
            identity,
            db: Arc::clone(&self.db),
            current_models: Arc::clone(&self.current_models),
            pending_runs: Arc::clone(&self.pending_runs),
            app_handle: self.app_handle.clone(),
        };

        let tx_map_clone = Arc::clone(&self.tx_map);
        let pid_clone = provider_id.to_string();
        
        tauri::async_runtime::spawn(async move {
            if let Err(e) = runner.run(rx).await {
                eprintln!("[ACP] Runner for {} stopped: {}", pid_clone, e);
            }
            tx_map_clone.remove(&pid_clone);
        });

        self.tx_map.insert(provider_id.to_string(), tx.clone());
        Ok(tx)
    }

    pub async fn execute_task(&self, provider_id: &str, params: Value) -> Result<String, String> {
        let tx = self.ensure_provider_running(provider_id).await?;
        
        let req_id = format!("run-{}", timestamp_ns());
        let (otx, orx) = tokio::sync::oneshot::channel();
        
        self.pending_runs.insert(req_id.clone(), otx);
        
        // 构建请求参数
        let mut run_params = json!({
            "agentId": params["agent_id"].as_str()
                .or(params["agentId"].as_str())
                .unwrap_or("main"),
            "message": params["message"].as_str().unwrap_or(""),
            "idempotencyKey": format!("jiling-{}", timestamp_ns())
        });
        
        // 自动注入 context (如果是 autoclaw)
        if let Some(desc) = self.providers.get(provider_id) {
            if let Some(config_dir) = &desc.config_dir {
                apply_provider_request_context(config_dir, &mut run_params);
            }
        }

        let msg = json!({
            "type": "req",
            "method": "agent",
            "id": req_id.clone(),
            "params": run_params
        });

        tx.send(msg).map_err(|e| e.to_string())?;

        // 等待响应 (最多 30s)
        match tokio::time::timeout(std::time::Duration::from_secs(30), orx).await {
            Ok(Ok(Ok(run_id))) => {
                // 插入数据库
                let db = self.db.lock().await;
                let agent_id = params["agent_id"].as_str()
                    .or(params["agentId"].as_str())
                    .unwrap_or("main");
                let message = params["message"].as_str().unwrap_or("");
                let silent = params["silent"].as_bool().unwrap_or(false);
                let _ = db.insert_task(&run_id, provider_id, agent_id, message, silent);
                Ok(run_id)
            }
            Ok(Ok(Err(e))) => {
                self.pending_runs.remove(&req_id);
                Err(e)
            }
            _ => {
                self.pending_runs.remove(&req_id);
                Err("Timeout waiting for agent.run response".to_string())
            }
        }
    }

    pub async fn reconcile_tasks(&self) {
        let db = self.db.lock().await;
        if let Ok(in_progress) = db.get_in_progress_tasks() {
            for (run_id, _) in in_progress {
                let _ = db.update_task_status(&run_id, "lost");
            }
        }
    }

    pub async fn update_task_output(&self, run_id: String, output: String) -> Result<(), String> {
        let db = self.db.lock().await;
        db.set_task_output(&run_id, &output)
            .map_err(|e| e.to_string())
    }

    pub async fn get_task_output(&self, run_id: String) -> Result<String, String> {
        let db = self.db.lock().await;
        db.get_task_output(&run_id).map_err(|e| e.to_string())
    }

    pub async fn get_agent_task_status(&self, run_id: String) -> Result<TaskSnapshot, String> {
        let db = self.db.lock().await;
        db.get_task_snapshot(&run_id).map_err(|e| e.to_string())
    }

    pub async fn list_agent_tasks(&self) -> Result<Vec<TaskSnapshot>, String> {
        let db = self.db.lock().await;
        db.get_all_tasks().map_err(|e| e.to_string())
    }

    pub async fn abort_task(&self, run_id: String) -> Result<(), String> {
        let msg = json!({
            "type": "req",
            "method": "sessions.abort",
            "id": format!("abort-{}", timestamp_ns()),
            "params": { "runId": run_id }
        });
        
        for entry in self.tx_map.iter() {
            let _ = entry.value().send(msg.clone());
        }
        Ok(())
    }


    pub async fn switch_model(&self, _provider_id: String, _agent_id: String, _model: String) -> Result<(), String> {
        Ok(())
    }

    pub async fn get_identity(&self) -> Result<Identity, String> {
        // 尝试从常见的目录加载身份
        let paths = [".openclaw", ".openclaw-autoclaw", ".hermes"];
        for p in paths {
            if let Ok(id) = load_local_identity(p) {
                return Ok(id);
            }
        }
        Err("No local identity found in any common provider directories".to_string())
    }

    pub async fn get_acp_models(&self, provider_id: &str) -> Result<Vec<Value>, String> {
        // 1. 确保 Runner 已启动并连接
        self.ensure_provider_running(provider_id).await?;
        
        let mut models_by_name = std::collections::HashMap::new();

        // 2. 尝试从本地配置文件加载 (作为基础列表)
        if let Some(desc) = self.providers.get(provider_id) {
            if let Some(config_dir) = &desc.config_dir {
                if let Ok(file_models) = self.load_models_from_config(config_dir) {
                    for m in file_models {
                        let id = m["id"].as_str().unwrap_or_default().to_string();
                        let name = m["name"].as_str().unwrap_or(&id).to_string();
                        models_by_name.insert(name, m);
                    }
                }
            }
        }

        // 3. 合并 WebSocket 实时同步到的模型 (优先级更高，覆盖重名项)
        let live_models = self.current_models.get(provider_id).map(|v| v.clone()).unwrap_or_default();
        for m in live_models {
            let id = m["id"].as_str().unwrap_or_default().to_string();
            let name = m["name"].as_str().unwrap_or(&id).to_string();
            
            // 实时模型优先级最高，直接插入/覆盖同名项
            models_by_name.insert(name, m);
        }

        // 4. 将结果转回 Vec
        let final_result: Vec<Value> = models_by_name.into_values().collect();

        Ok(final_result)
    }

    fn load_models_from_config(&self, provider_dir: &str) -> Result<Vec<Value>, String> {
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let config_path = format!("{}/{}/openclaw.json", home, provider_dir);
        
        let content = std::fs::read_to_string(config_path).map_err(|e| format!("无法读取配置文件: {}", e))?;
        let config: Value = serde_json::from_str(&content).map_err(|e| format!("解析配置文件失败: {}", e))?;
        
        let mut models: Vec<Value> = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        // 1. 从 agents.defaults.models 解析
        if let Some(agent_models) = config["agents"]["defaults"]["models"].as_object() {
            for (id, val) in agent_models {
                let name = val["alias"].as_str().unwrap_or_else(|| {
                    id.split('/').last().unwrap_or(id)
                });
                if seen_ids.insert(id.clone()) {
                    models.push(json!({
                        "id": id,
                        "name": name
                    }));
                }
            }
        }
        
        // 2. 同时也从 models.providers 字段解析
        if let Some(providers) = config["models"]["providers"].as_object() {
            for (provider_id, provider_val) in providers {
                if let Some(provider_models) = provider_val["models"].as_array() {
                    for m in provider_models {
                        if let Some(m_id) = m["id"].as_str() {
                            let full_id = format!("{}/{}", provider_id, m_id);
                            if seen_ids.insert(full_id.clone()) {
                                let name = m["name"].as_str().unwrap_or(m_id);
                                models.push(json!({
                                    "id": full_id,
                                    "name": name
                                }));
                            }
                        }
                    }
                }
            }
        }

        Ok(models)
    }

    pub async fn switch_agent_model(&self, provider_id: &str, model_id: &str) -> Result<(), String> {
        let tx = self.ensure_provider_running(provider_id).await?;
        let _ = tx.send(json!({
            "type": "cmd",
            "id": "switch-model",
            "payload": { "model": model_id }
        }));
        Ok(())
    }

    pub async fn get_models(&self, provider_id: &str) -> Vec<Value> {
        self.current_models.get(provider_id).map(|v| v.clone()).unwrap_or_default()
    }
}

fn timestamp_ns() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

fn apply_provider_request_context(provider_dir: &str, params: &mut Value) {
    if !provider_dir.contains("autoclaw") {
        return;
    }

    let agent_id = params["agent_id"].as_str()
        .or(params["agentId"].as_str())
        .unwrap_or("main");
    if let Some(session_key) = load_preferred_session_key(provider_dir, agent_id) {
        params["sessionKey"] = json!(session_key);
    }
}

fn load_preferred_session_key(provider_dir: &str, agent_id: &str) -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let sessions_path = format!(
        "{}/{}/agents/{}/sessions/sessions.json",
        home, provider_dir, agent_id
    );
    let content = std::fs::read_to_string(sessions_path).ok()?;
    let sessions_json: Value = serde_json::from_str(&content).ok()?;
    let sessions = sessions_json.as_object()?;
    let preferred_key = format!("agent:{}:preset_0", agent_id);

    let selected = sessions.get_key_value(&preferred_key).or_else(|| {
        sessions
            .iter()
            .filter(|(key, _)| key.starts_with(&format!("agent:{}:preset_", agent_id)))
            .max_by_key(|(_, value)| value["updatedAt"].as_i64().unwrap_or(0))
    })?;

    let (key, _value) = selected;
    Some(key.to_string())
}
