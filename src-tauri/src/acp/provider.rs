use futures_util::{SinkExt, StreamExt};
use dashmap::DashMap;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use crate::acp::types::*;
use crate::acp::auth::*;
use crate::db::Db;
use tauri::Emitter;
use crate::acp::utils::extract_error_message;

pub struct WsConnection {
    ws_stream: tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
}

impl WsConnection {
    pub async fn send(&mut self, msg: Value) -> Result<(), String> {
        let text = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        self.ws_stream.send(Message::Text(text)).await.map_err(|e| e.to_string())
    }

    pub async fn recv(&mut self) -> Option<Result<Value, String>> {
        while let Some(msg) = self.ws_stream.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    return Some(serde_json::from_str(&text).map_err(|e| e.to_string()));
                }
                Ok(Message::Binary(bin)) => {
                    return Some(serde_json::from_slice(&bin).map_err(|e| e.to_string()));
                }
                Ok(_) => continue,
                Err(e) => return Some(Err(e.to_string())),
            }
        }
        None
    }
}

pub struct ProviderRunner {
    pub descriptor: ProviderDescriptor,
    pub identity: Identity,
    pub db: Arc<Mutex<Db>>,
    pub current_models: Arc<DashMap<String, Vec<Value>>>,
    pub pending_runs: Arc<DashMap<String, tokio::sync::oneshot::Sender<Result<String, String>>>>,
    pub app_handle: tauri::AppHandle,
}

impl ProviderRunner {
    pub async fn run(&self, mut rx: mpsc::UnboundedReceiver<Value>) -> Result<(), String> {
        loop {
            match self.connect_and_loop(&mut rx).await {
                Ok(_) => break Ok(()),
                Err(e) => {
                    eprintln!("[ACP] Provider {} error: {}. Retrying in 5s...", self.descriptor.id, e);
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            }
        }
    }

    async fn connect_and_loop(&self, rx: &mut mpsc::UnboundedReceiver<Value>) -> Result<(), String> {
        let (ws_stream, _) = connect_async(&self.descriptor.endpoint).await.map_err(|e| e.to_string())?;
        let mut conn = WsConnection { ws_stream };
        
        let mut authenticated = false;
        let device_token = load_device_token(self.descriptor.config_dir.as_deref().unwrap_or(&self.descriptor.id))?;

        let mut cmd_buffer = Vec::new();

        loop {
            tokio::select! {
                Some(cmd) = rx.recv() => {
                    if authenticated {
                        conn.send(cmd).await?;
                    } else {
                        cmd_buffer.push(cmd);
                    }
                }
                res = conn.recv() => {
                    match res {
                        Some(Ok(msg)) => {
                            if msg["event"] == "connect.challenge" {
                                let auth_msg = sign_auth_challenge(&self.identity, &msg, &device_token)?;
                                conn.send(auth_msg).await?;
                            } else if msg["type"] == "res" && msg["id"] == "auth" {
                                if msg["ok"] == true {
                                    authenticated = true;
                                    self.on_authenticated(&mut conn).await?;
                                    
                                    // 发送缓存的命令
                                    for cmd in cmd_buffer.drain(..) {
                                        conn.send(cmd).await?;
                                    }
                                }
                            } else {
                                self.handle_message(msg).await?;
                            }
                        }
                        Some(Err(e)) => return Err(e),
                        None => return Err("Connection closed".to_string()),
                    }
                }
            }
        }
    }

    async fn on_authenticated(&self, conn: &mut WsConnection) -> Result<(), String> {
        // 1. 同步模型列表
        conn.send(json!({
            "type": "req",
            "method": "models.list",
            "id": "initial-models-list"
        })).await?;

        // 2. 为所有进行中的任务发送 wait (恢复追踪)
        let db = self.db.lock().await;
        if let Ok(tasks) = db.get_in_progress_tasks() {
            for (run_id, _) in tasks {
                let wait_msg = json!({
                    "type": "req",
                    "method": "agent.wait",
                    "id": format!("wait-{}", run_id),
                    "params": { "runId": run_id }
                });
                conn.send(wait_msg).await?;
            }
        }

        Ok(())
    }

    async fn handle_message(&self, msg: Value) -> Result<(), String> {
        if msg["event"] == "tick" {
            let _ = self.app_handle.emit("acp-tick", ());
            return Ok(());
        }

        // 处理命令响应 (Req/Res)
        if msg["type"] == "res" {
            if let Some(id) = msg["id"].as_str() {
                if id.starts_with("run-") {
                    if let Some((_, tx)) = self.pending_runs.remove(id) {
                        if msg["ok"] == true {
                            let run_id = msg["payload"]["run_id"].as_str()
                                .or(msg["payload"]["runId"].as_str())
                                .unwrap_or("")
                                .to_string();
                            let _ = tx.send(Ok(run_id));
                        } else {
                            let error = extract_error_message(&msg).unwrap_or_else(|| "Unknown error".to_string());
                            eprintln!("[ACP] Command {} failed: {}", id, msg);
                            let _ = tx.send(Err(error));
                        }
                    }
                } else if id.starts_with("wait-") {
                    let run_id = &id[5..];
                    if msg["ok"] == true {
                        let payload = &msg["payload"];
                        let task_ok = payload["ok"].as_bool().unwrap_or(false);
                        let db = self.db.lock().await;
                        if task_ok {
                            let output = payload["output"].as_str().unwrap_or("");
                            let _ = db.set_task_output(run_id, output);
                        }
                        let status = if task_ok { "completed" } else { "failed" };
                        let _ = db.update_task_status(run_id, status);
                        println!("[ACP] Task {} recovered and marked as {}", run_id, status);
                    }
                }
            }
        }

        // 处理模型列表返回
        if msg["type"] == "res" && msg["id"] == "initial-models-list" {
            if msg["ok"] == true {
                if let Some(models_arr) = msg["payload"]["models"].as_array() {
                    let mut processed_models = Vec::new();
                    for m in models_arr {
                        if let Some(m_id) = m["id"].as_str() {
                            let name = m["name"].as_str().unwrap_or(m_id);
                            processed_models.push(json!({
                                "id": m_id,
                                "name": name
                            }));
                        }
                    }
                    
                    self.current_models.insert(self.descriptor.id.clone(), processed_models.clone());
                    println!("[ACP] Provider {} synced {} models", self.descriptor.id, processed_models.len());
                    
                    let _ = self.app_handle.emit("acp-models-updated", json!({
                        "provider_id": self.descriptor.id,
                        "models": processed_models
                    }));
                }
            }
            return Ok(());
        }

        // 处理任务事件 (Assistant stream)
        if msg["event"] == "agent" {
            let payload = &msg["payload"];
            let stream = payload["stream"].as_str().unwrap_or("");
            let run_id = payload["run_id"].as_str()
                .or(payload["runId"].as_str())
                .unwrap_or("");
            
            // 持久化 assistant 输出
            if stream == "assistant" {
                if let Some(text) = payload["data"]["text"].as_str() {
                    let db = self.db.lock().await;
                    let current = db.get_task_output(run_id).unwrap_or_default();
                    let _ = db.set_task_output(run_id, &(current + text));
                }
            }

            let _ = self.app_handle.emit("acp-event", json!({
                "run_id": run_id,
                "event_type": stream,
                "data": payload["data"]
            }));
        }

        Ok(())
    }
}
