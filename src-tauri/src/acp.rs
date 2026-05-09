use crate::db::Db;
use base64::{Engine as _, engine::general_purpose};
use dashmap::DashMap;
use ed25519_dalek::{Signer, SigningKey, pkcs8::DecodePrivateKey};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::fs;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tokio::sync::{Mutex, mpsc};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

#[derive(Debug, Clone, serde::Serialize)]
pub struct AcpEvent {
    pub run_id: String,
    pub event_type: String,
    pub data: Value,
}

pub struct GlobalAcpManager {
    app_handle: tauri::AppHandle,
    pub db: Arc<Mutex<Db>>,
    tx_map: Arc<DashMap<String, mpsc::UnboundedSender<AcpCommand>>>,
    pending_requests: Arc<DashMap<String, PendingRequest>>,
}

struct PendingRequest {
    tx: mpsc::Sender<Result<String, String>>,
    agent_id: String,
    message: String,
}

enum AcpCommand {
    RunTask {
        agent_id: String,
        message: String,
        system_instruction: Option<String>,
        run_id_tx: mpsc::Sender<Result<String, String>>,
    },
    AbortTask {
        run_id: String,
    },
    RespondAction {
        agent_id: String,
        run_id: String,
        request_id: String,
        action: String,
        data: Value,
    },
}

impl GlobalAcpManager {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        let db = Arc::new(Mutex::new(Db::new().expect("Failed to initialize DB")));
        let pending_requests = Arc::new(DashMap::new());
        let tx_map = Arc::new(DashMap::new());

        GlobalAcpManager {
            app_handle,
            db,
            tx_map,
            pending_requests,
        }
    }

    pub async fn run_task(
        &self,
        provider_dir: String,
        agent_id: String,
        message: String,
        system_instruction: Option<String>,
    ) -> Result<String, String> {
        let tx = {
            if !self.tx_map.contains_key(&provider_dir) {
                let (tx, mut rx) = mpsc::unbounded_channel::<AcpCommand>();
                let db_clone = Arc::clone(&self.db);
                let pending_clone = Arc::clone(&self.pending_requests);
                let app_handle_clone = self.app_handle.clone();
                let provider_dir_clone = provider_dir.clone();

                tauri::async_runtime::spawn(async move {
                    loop {
                        if let Err(e) = acp_loop(
                            &app_handle_clone,
                            &mut rx,
                            Arc::clone(&db_clone),
                            Arc::clone(&pending_clone),
                            &provider_dir_clone,
                        )
                        .await
                        {
                            eprintln!(
                                "ACP Loop Error for {}: {}. Retrying in 5s...",
                                provider_dir_clone, e
                            );
                            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                        }
                    }
                });

                self.tx_map.insert(provider_dir.clone(), tx.clone());
                tx
            } else {
                self.tx_map.get(&provider_dir).unwrap().clone()
            }
        };

        let (run_id_tx, mut run_id_rx) = mpsc::channel(1);
        tx.send(AcpCommand::RunTask {
            agent_id,
            message,
            system_instruction,
            run_id_tx,
        })
        .map_err(|e| e.to_string())?;

        match tokio::time::timeout(tokio::time::Duration::from_secs(30), run_id_rx.recv()).await {
            Ok(Some(result)) => result,
            _ => Err("Failed to get runId (Timeout)".to_string()),
        }
    }

    pub async fn abort_task(&self, run_id: String) -> Result<(), String> {
        // Broadcast abort to all connected providers
        for entry in self.tx_map.iter() {
            let _ = entry.value().send(AcpCommand::AbortTask {
                run_id: run_id.clone(),
            });
        }
        // Persist the cancelled status in the database
        let db = self.db.lock().await;
        let _ = db.update_task_status(&run_id, "cancelled");
        Ok(())
    }

    pub async fn respond_action(
        &self,
        agent_id: String,
        run_id: String,
        request_id: String,
        action: String,
        data: Value,
    ) -> Result<(), String> {
        if let Some(agent_tx) = self.tx_map.get(&agent_id) {
            let _ = agent_tx.value().send(AcpCommand::RespondAction {
                agent_id: agent_id.clone(),
                run_id,
                request_id,
                action,
                data,
            });
            Ok(())
        } else {
            Err(format!("Provider {} not connected or not found", agent_id))
        }
    }

    pub async fn update_task_output(&self, run_id: String, output: String) -> Result<(), String> {
        let db = self.db.lock().await;
        db.set_task_output(&run_id, &output).map_err(|e| e.to_string())
    }

    pub async fn reconcile_tasks(&self) {
        let in_progress = {
            let db = self.db.lock().await;
            db.get_in_progress_tasks().unwrap_or_default()
        };

        for (run_id, _) in in_progress {
            // Since this is called at startup, tasks stuck in progress are considered lost
            let db = self.db.lock().await;
            let _ = db.update_task_status(&run_id, "lost");
            println!("[ACP] Reconciled zombie task: {}", run_id);
        }
    }
}

fn get_active_port(provider_dir: &str) -> u16 {
    let home = std::env::var("HOME").unwrap_or_default();
    let config_path = format!("{}/{}/openclaw.json", home, provider_dir);
    if let Ok(content) = fs::read_to_string(config_path) {
        if let Ok(json) = serde_json::from_str::<Value>(&content) {
            if let Some(port) = json["gateway"]["port"].as_u64() {
                return port as u16;
            }
        }
    }
    18789 // default port
}

async fn acp_loop(
    app_handle: &tauri::AppHandle,
    rx: &mut mpsc::UnboundedReceiver<AcpCommand>,
    db: Arc<Mutex<Db>>,
    pending_requests: Arc<DashMap<String, PendingRequest>>,
    provider_dir: &str,
) -> Result<(), String> {
    let port = get_active_port(provider_dir);
    let ws_url = format!("ws://127.0.0.1:{}/acp", port);
    let (ws_stream, _) = connect_async(&ws_url).await.map_err(|e| e.to_string())?;
    let (mut ws_write, mut ws_read) = ws_stream.split();

    let mut authenticated = false;
    let (device_id, device_token, signing_key) = load_identity(provider_dir)?;
    
    // Map dynamically generated AutoClaw runIds back to original Jiling runIds
    let mut virtual_run_map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut base_outputs: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    loop {
        tokio::select! {
            Some(cmd) = rx.recv(), if authenticated => {
                match cmd {
                    AcpCommand::RunTask { agent_id, message, system_instruction, run_id_tx } => {
                        let req_id = format!("run-{}", timestamp_ns());
                        pending_requests.insert(req_id.clone(), PendingRequest {
                            tx: run_id_tx,
                            agent_id: agent_id.clone(),
                            message: message.clone(),
                        });

                        let idempotency_key = format!("jiling-{}", timestamp_ns());
                        
                        // Combine message and system_instruction into a single message field for compatibility
                        let final_message = if let Some(si) = system_instruction {
                            format!("{}\n\n{}", si, message)
                        } else {
                            message
                        };

                        let mut params = json!({
                            "message": final_message,
                            "agentId": agent_id,
                            "idempotencyKey": idempotency_key,
                        });
                        
                        apply_provider_request_context(provider_dir, &mut params);

                        let msg = json!({
                            "type": "req", "method": "agent", "id": req_id,
                            "params": params
                        });
                        let _ = ws_write.send(Message::Text(msg.to_string())).await;
                    }
                    AcpCommand::AbortTask { run_id } => {
                        println!("[ACP] Sending abort request for run_id: {}", run_id);
                        let msg = json!({
                            "type": "req", "method": "agent.abort", "id": format!("abort-{}", timestamp_ns()),
                            "params": { "runId": run_id }
                        });
                        let _ = ws_write.send(Message::Text(msg.to_string())).await;
                    }
                    AcpCommand::RespondAction { agent_id, run_id, request_id, action, data } => {
                        println!("[ACP] Sending interaction feedback for run_id={} on agent={}", run_id, agent_id);
                        
                        let feedback_data = json!({
                            "type": "a2ui_feedback",
                            "requestId": request_id,
                            "action": action,
                            "data": data
                        });

                        let message = format!("[A2UI Feedback] This is the approval result for the previous task, please continue execution based on this result:\n\n{}\n\nIMPORTANT: You MUST wrap any further A2UI output strictly in ```json blocks!", feedback_data.to_string());

                        let req_id = format!("respond|{}|{}", run_id, timestamp_ns());
                        let idempotency_key = format!("jiling-{}", timestamp_ns());
                        
                        // Use "main" as the hardcoded agentId, just like runTask does
                        let mut params = json!({
                            "message": message,
                            "agentId": "main",
                            "idempotencyKey": idempotency_key
                        });
                        
                        apply_provider_request_context(provider_dir, &mut params);

                        let msg = json!({
                            "type": "req", 
                            "method": "agent", 
                            "id": req_id,
                            "params": params
                        });
                        
                        if let Err(e) = ws_write.send(Message::Text(msg.to_string())).await {
                            eprintln!("[ACP] Failed to send feedback message: {}", e);
                        } else {
                            println!("[ACP] Feedback message successfully sent: {}", msg);
                        }
                    }
                }
            }
            Some(Ok(msg)) = ws_read.next() => {
                if let Message::Text(text) = msg {
                    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);

                    if v["event"] == "connect.challenge" {
                        let auth_msg = build_auth_msg(&v, &device_id, &device_token, &signing_key);
                        let _ = ws_write.send(Message::Text(auth_msg.to_string())).await;
                        continue;
                    }
                    if v["type"] == "res" && v["id"] == "auth" {
                        if v["ok"] == true {
                            authenticated = true;
                            let db_lock = db.lock().await;
                            if let Ok(tasks) = db_lock.get_in_progress_tasks() {
                                for (run_id, _) in tasks {
                                    let wait_msg = json!({
                                        "type": "req", "method": "agent.wait", "id": format!("wait-{}", run_id),
                                        "params": { "runId": run_id }
                                    });
                                    let _ = ws_write.send(Message::Text(wait_msg.to_string())).await;
                                }
                            }
                        }
                        continue;
                    }

                    if v["event"] == "tick" {
                        app_handle.emit("acp-tick", ()).unwrap_or(());
                        continue;
                    }

                    if v["event"] == "agent" {
                        let payload = &v["payload"];
                        let original_run_id = payload["runId"].as_str().unwrap_or("").to_string();
                        let mut mapped_run_id = original_run_id.clone();
                        
                        // Map the dynamically generated AutoClaw runId back to the original task
                        if let Some(mapped_id) = virtual_run_map.get(&original_run_id) {
                            mapped_run_id = mapped_id.clone();
                        }
                        
                        let stream = payload["stream"].as_str().unwrap_or("");

                        let db_lock = db.lock().await;
                        if stream == "assistant" {
                            if let Some(text) = payload["data"]["text"].as_str() {
                                let base = base_outputs.get(&original_run_id).cloned().unwrap_or_default();
                                let separator = if base.is_empty() { "" } else { "\n\n___JILING_STEP_SEPARATOR___\n\n" };
                                let combined = format!("{}{}{}", base, separator, text);

                                let _ = db_lock.set_task_output(&mapped_run_id, &combined);

                                let mut new_data = payload["data"].clone();
                                new_data["text"] = json!(combined);

                                app_handle.emit("acp-event", AcpEvent {
                                    run_id: mapped_run_id.clone(),
                                    event_type: "assistant".to_string(),
                                    data: new_data
                                }).unwrap_or(());
                            }
                        } else if stream == "lifecycle" {
                            let phase = payload["data"]["phase"].as_str().unwrap_or("");
                            let mut data = payload["data"].clone();
                            if phase == "error" && data["error"].as_str().unwrap_or("").is_empty() {
                                if let Some(message) = extract_error_message(payload) {
                                    data["error"] = json!(message);
                                }
                            }
                            
                            let _ = db_lock.update_task_status(&mapped_run_id, phase);
                             app_handle.emit("acp-event", AcpEvent {
                                run_id: mapped_run_id.clone(),
                                event_type: "lifecycle".to_string(),
                                data
                            }).unwrap_or(());
                        }
                    }

                    if v["type"] == "res" {
                        let res_id = v["id"].as_str().unwrap_or("");
                        if res_id.starts_with("run-") {
                            if let Some((_, pending)) = pending_requests.remove(res_id) {
                                if v["ok"] == true {
                                    let run_id = v["payload"]["runId"].as_str().unwrap_or("").to_string();
                                    if run_id.is_empty() {
                                        let _ = pending.tx.send(Err("Agent response missing runId".to_string())).await;
                                    } else {
                                        let db_lock = db.lock().await;
                                        let _ = db_lock.insert_task(&run_id, provider_dir, &pending.message);
                                        let _ = pending.tx.send(Ok(run_id)).await;
                                    }
                                } else {
                                    let message = extract_error_message(&v)
                                        .unwrap_or_else(|| "Agent request failed".to_string());
                                    let _ = pending.tx.send(Err(message)).await;
                                }
                            }
                        } else if res_id.starts_with("wait-") {
                            let run_id = res_id.trim_start_matches("wait-");
                            if v["ok"] == true {
                                let payload = &v["payload"];
                                if payload["status"] == "success" {
                                    let db_lock = db.lock().await;
                                    let _ = db_lock.update_task_status(run_id, "end");
                                    if let Some(output) = payload["result"]["payload"]["output"].as_str() {
                                        if !output.is_empty() {
                                            let _ = db_lock.set_task_output(run_id, output);
                                        }
                                    }
                                }
                            } else if v["error"] == "not_found" {
                                let db_lock = db.lock().await;
                                let _ = db_lock.update_task_status(run_id, "lost");
                            }
                        } else if res_id.starts_with("respond|") {
                            if let Some(new_run_id) = v["payload"]["runId"].as_str() {
                                let parts: Vec<&str> = res_id.split('|').collect();
                                if parts.len() == 3 {
                                    let old_run_id = parts[1].to_string();
                                    virtual_run_map.insert(new_run_id.to_string(), old_run_id.clone());
                                    
                                    let db_lock = db.lock().await;
                                    let old_output = db_lock.get_task_output(&old_run_id).unwrap_or_default();
                                    base_outputs.insert(new_run_id.to_string(), old_output);
                                    
                                    println!("[ACP] Mapped dynamically generated AutoClaw runId {} to original Jiling runId {}", new_run_id, old_run_id);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

fn apply_provider_request_context(provider_dir: &str, params: &mut Value) {
    if !provider_dir.contains("autoclaw") {
        return;
    }

    let agent_id = params["agentId"].as_str().unwrap_or("main");
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
    let sessions_json: Value =
        serde_json::from_str(&fs::read_to_string(sessions_path).ok()?).ok()?;
    let sessions = sessions_json.as_object()?;
    let preferred_key = format!("agent:{}:preset_0", agent_id);

    let selected = sessions.get_key_value(&preferred_key).or_else(|| {
        sessions
            .iter()
            .filter(|(key, _)| key.starts_with(&format!("agent:{}:preset_", agent_id)))
            .max_by_key(|(_, value)| value["updatedAt"].as_i64().unwrap_or(0))
    })?;

    let (key, value) = selected;
    let _ = value;
    Some(key.to_string())
}

fn extract_error_message(v: &Value) -> Option<String> {
    for candidate in [
        v["error"]["message"].as_str(),
        v["errorMessage"].as_str(),
        v["payload"]["error"]["message"].as_str(),
        v["payload"]["error"].as_str(),
        v["payload"]["data"]["error"].as_str(),
        v["payload"]["data"]["message"].as_str(),
        v["payload"]["data"]["text"].as_str(),
        v["message"].as_str(),
        v["error"].as_str(),
    ] {
        if let Some(message) = candidate {
            let trimmed = message.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn load_identity(provider_dir: &str) -> Result<(String, String, SigningKey), String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let device_auth_path = format!("{}/{}/identity/device-auth.json", home, provider_dir);
    let auth_json: Value =
        serde_json::from_str(&fs::read_to_string(device_auth_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let device_id = auth_json["deviceId"]
        .as_str()
        .ok_or("Missing deviceId")?
        .to_string();
    let device_token = load_operator_token(&home, provider_dir, &device_id, &auth_json)?;

    let device_json_path = format!("{}/{}/identity/device.json", home, provider_dir);
    let device_data: Value =
        serde_json::from_str(&fs::read_to_string(device_json_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let private_key_pem = device_data["privateKeyPem"]
        .as_str()
        .ok_or("Missing privateKeyPem")?;
    let signing_key = SigningKey::from_pkcs8_pem(private_key_pem).map_err(|e| e.to_string())?;

    Ok((device_id, device_token, signing_key))
}

fn load_operator_token(
    home: &str,
    provider_dir: &str,
    device_id: &str,
    auth_json: &Value,
) -> Result<String, String> {
    let paired_path = format!("{}/{}/devices/paired.json", home, provider_dir);
    if let Ok(content) = fs::read_to_string(paired_path) {
        if let Ok(paired_json) = serde_json::from_str::<Value>(&content) {
            for key in [device_id, "undefined"] {
                if let Some(token) = paired_json[key]["tokens"]["operator"]["token"].as_str() {
                    if !token.is_empty() {
                        return Ok(token.to_string());
                    }
                }
            }
        }
    }

    auth_json["tokens"]["operator"]["token"]
        .as_str()
        .filter(|token| !token.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "Missing operator token".to_string())
}

fn build_auth_msg(
    v: &Value,
    device_id: &str,
    device_token: &str,
    signing_key: &SigningKey,
) -> Value {
    let nonce = v["payload"]["nonce"].as_str().unwrap_or("");
    let ts = v["payload"]["ts"].as_i64().unwrap_or(0);
    let sign_payload = format!(
        "v3|{}|node-host|node|operator|operator.admin,operator.read,operator.write|{}|{}|{}|darwin|desktop",
        device_id, ts, device_token, nonce
    );
    let sig = signing_key.sign(sign_payload.as_bytes());
    let sig_b64 = general_purpose::URL_SAFE_NO_PAD.encode(sig.to_bytes());
    let public_key_b64 =
        general_purpose::URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes());

    json!({
        "type": "req", "method": "connect", "id": "auth",
        "params": {
            "minProtocol": 3, "maxProtocol": 3, "role": "operator", "scopes": vec!["operator.admin", "operator.read", "operator.write"],
            "client": { "id": "node-host", "version": "2026.4.29", "platform": "darwin", "mode": "node", "deviceFamily": "desktop" },
            "device": { "id": device_id, "publicKey": public_key_b64, "signature": sig_b64, "signedAt": ts, "nonce": nonce },
            "auth": { "deviceToken": device_token }
        }
    })
}

fn timestamp_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

#[tauri::command]
pub async fn execute_agent_acp_task(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    provider_dir: String,
    agent: String,
    task: String,
    system_instruction: Option<String>,
) -> Result<String, String> {
    state.run_task(provider_dir, agent, task, system_instruction).await
}

#[tauri::command]
pub async fn abort_agent_task(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    run_id: String,
) -> Result<(), String> {
    state.abort_task(run_id).await
}

#[tauri::command]
pub async fn get_task_output(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    run_id: String,
) -> Result<String, String> {
    let db = state.db.lock().await;
    db.get_task_output(&run_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_agent_task_status(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    run_id: String,
) -> Result<crate::db::TaskSnapshot, String> {
    let db = state.db.lock().await;
    db.get_task_snapshot(&run_id).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn list_agent_tasks(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
) -> Result<Vec<crate::db::TaskSnapshot>, String> {
    let db = state.db.lock().await;
    db.get_all_tasks().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn respond_agent_task_action(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    agent_id: String,
    run_id: String,
    request_id: String,
    action: String,
    data: Value,
) -> Result<(), String> {
    state.respond_action(agent_id, run_id, request_id, action, data).await
}

#[tauri::command]
pub async fn update_agent_task_output(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    run_id: String,
    output: String,
) -> Result<(), String> {
    state.update_task_output(run_id, output).await
}
