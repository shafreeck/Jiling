use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures_util::{StreamExt, SinkExt};
use ed25519_dalek::{SigningKey, Signer, pkcs8::DecodePrivateKey};
use base64::{Engine as _, engine::general_purpose};
use std::fs;
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use dashmap::DashMap;
use crate::db::Db;

#[derive(Debug, Clone, serde::Serialize)]
pub struct AcpEvent {
    pub run_id: String,
    pub event_type: String,
    pub data: Value,
}

pub struct GlobalAcpManager {
    tx: mpsc::UnboundedSender<AcpCommand>,
    #[allow(dead_code)]
    db: Arc<Mutex<Db>>,
    #[allow(dead_code)]
    pending_requests: Arc<DashMap<String, PendingRequest>>,
}

struct PendingRequest {
    tx: mpsc::Sender<String>,
    agent_id: String,
    message: String,
}

enum AcpCommand {
    RunTask { agent_id: String, message: String, run_id_tx: mpsc::Sender<String> },
    AbortTask { run_id: String },
}

impl GlobalAcpManager {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<AcpCommand>();
        let db = Arc::new(Mutex::new(Db::new().expect("Failed to initialize DB")));
        let pending_requests = Arc::new(DashMap::new());
        
        let db_clone = Arc::clone(&db);
        let pending_clone = Arc::clone(&pending_requests);

        tokio::spawn(async move {
            loop {
                if let Err(e) = acp_loop(&app_handle, &mut rx, Arc::clone(&db_clone), Arc::clone(&pending_clone)).await {
                    eprintln!("ACP Loop Error: {}. Retrying in 5s...", e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                }
            }
        });

        GlobalAcpManager { tx, db, pending_requests }
    }

    pub async fn run_task(&self, agent_id: String, message: String) -> Result<String, String> {
        let (run_id_tx, mut run_id_rx) = mpsc::channel(1);
        self.tx.send(AcpCommand::RunTask { agent_id, message, run_id_tx }).map_err(|e| e.to_string())?;
        
        match tokio::time::timeout(tokio::time::Duration::from_secs(30), run_id_rx.recv()).await {
            Ok(Some(run_id)) => Ok(run_id),
            _ => Err("Failed to get runId (Timeout)".to_string())
        }
    }

    pub async fn abort_task(&self, run_id: String) -> Result<(), String> {
        self.tx.send(AcpCommand::AbortTask { run_id }).map_err(|e| e.to_string())
    }
}

async fn acp_loop(
    app_handle: &tauri::AppHandle, 
    rx: &mut mpsc::UnboundedReceiver<AcpCommand>, 
    db: Arc<Mutex<Db>>,
    pending_requests: Arc<DashMap<String, PendingRequest>>
) -> Result<(), String> {
    let ws_url = "ws://127.0.0.1:18789/acp";
    let (ws_stream, _) = connect_async(ws_url).await.map_err(|e| e.to_string())?;
    let (mut ws_write, mut ws_read) = ws_stream.split();

    let mut authenticated = false;
    let (device_id, device_token, signing_key) = load_identity()?;

    loop {
        tokio::select! {
            Some(cmd) = rx.recv() => {
                if !authenticated { continue; }
                match cmd {
                    AcpCommand::RunTask { agent_id, message, run_id_tx } => {
                        let req_id = format!("run-{}", timestamp_ns());
                        pending_requests.insert(req_id.clone(), PendingRequest {
                            tx: run_id_tx,
                            agent_id: agent_id.clone(),
                            message: message.clone(),
                        });
                        
                        let idempotency_key = format!("jiling-{}", timestamp_ns());
                        let msg = json!({
                            "type": "req", "method": "agent", "id": req_id,
                            "params": { "agentId": agent_id, "message": message, "idempotencyKey": idempotency_key }
                        });
                        let _ = ws_write.send(Message::Text(msg.to_string().into())).await;
                    }
                    AcpCommand::AbortTask { run_id } => {
                        let msg = json!({
                            "type": "req", "method": "sessions.abort", "id": format!("abort-{}", timestamp_ns()),
                            "params": { "runId": run_id }
                        });
                        let _ = ws_write.send(Message::Text(msg.to_string().into())).await;
                    }
                }
            }
            Some(Ok(msg)) = ws_read.next() => {
                if let Message::Text(text) = msg {
                    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                    
                    if v["event"] == "connect.challenge" {
                        let auth_msg = build_auth_msg(&v, &device_id, &device_token, &signing_key);
                        let _ = ws_write.send(Message::Text(auth_msg.to_string().into())).await;
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
                                    let _ = ws_write.send(Message::Text(wait_msg.to_string().into())).await;
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
                        let run_id = payload["runId"].as_str().unwrap_or("");
                        let stream = payload["stream"].as_str().unwrap_or("");
                        
                        let db_lock = db.lock().await;
                        if stream == "assistant" {
                            if let Some(text) = payload["data"]["text"].as_str() {
                                // 采用覆盖写策略防止累加重复
                                let _ = db_lock.set_task_output(run_id, text);
                                app_handle.emit("acp-event", AcpEvent {
                                    run_id: run_id.to_string(),
                                    event_type: "assistant".to_string(),
                                    data: payload["data"].clone()
                                }).unwrap_or(());
                            }
                        } else if stream == "lifecycle" {
                            let phase = payload["data"]["phase"].as_str().unwrap_or("");
                            let _ = db_lock.update_task_status(run_id, phase);
                             app_handle.emit("acp-event", AcpEvent {
                                run_id: run_id.to_string(),
                                event_type: "lifecycle".to_string(),
                                data: payload["data"].clone()
                            }).unwrap_or(());
                        }
                    }
                    
                    if v["type"] == "res" {
                        let res_id = v["id"].as_str().unwrap_or("");
                        if res_id.starts_with("run-") {
                            if let Some((_, pending)) = pending_requests.remove(res_id) {
                                if v["ok"] == true {
                                    let run_id = v["payload"]["runId"].as_str().unwrap_or("").to_string();
                                    let db_lock = db.lock().await;
                                    let _ = db_lock.insert_task(&run_id, &pending.agent_id, &pending.message);
                                    let _ = pending.tx.send(run_id).await;
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
                                        // 仅当最终结果非空时覆盖
                                        if !output.is_empty() {
                                            let _ = db_lock.set_task_output(run_id, output);
                                        }
                                    }
                                }
                            } else if v["error"] == "not_found" {
                                let db_lock = db.lock().await;
                                let _ = db_lock.update_task_status(run_id, "lost");
                            }
                        }
                    }
                }
            }
        }
    }
}

fn load_identity() -> Result<(String, String, SigningKey), String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let device_auth_path = format!("{}/.openclaw/identity/device-auth.json", home);
    let auth_json: Value = serde_json::from_str(&fs::read_to_string(device_auth_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let device_id = auth_json["deviceId"].as_str().ok_or("Missing deviceId")?.to_string();
    let device_token = auth_json["tokens"]["operator"]["token"].as_str().ok_or("Missing token")?.to_string();

    let device_json_path = format!("{}/.openclaw/identity/device.json", home);
    let device_data: Value = serde_json::from_str(&fs::read_to_string(device_json_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let private_key_pem = device_data["privateKeyPem"].as_str().ok_or("Missing privateKeyPem")?;
    let signing_key = SigningKey::from_pkcs8_pem(private_key_pem).map_err(|e| e.to_string())?;

    Ok((device_id, device_token, signing_key))
}

fn build_auth_msg(v: &Value, device_id: &str, device_token: &str, signing_key: &SigningKey) -> Value {
    let nonce = v["payload"]["nonce"].as_str().unwrap_or("");
    let ts = v["payload"]["ts"].as_i64().unwrap_or(0);
    let sign_payload = format!("v3|{}|node-host|node|operator|operator.admin,operator.read,operator.write|{}|{}|{}|darwin|desktop", 
        device_id, ts, device_token, nonce);
    let sig = signing_key.sign(sign_payload.as_bytes());
    let sig_b64 = general_purpose::URL_SAFE_NO_PAD.encode(sig.to_bytes());
    let public_key_b64 = general_purpose::URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes());

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
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
}

// Tauri Commands
#[tauri::command]
pub async fn execute_agent_acp_task(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    agent: String,
    task: String
) -> Result<String, String> {
    state.run_task(agent, task).await
}

#[tauri::command]
pub async fn abort_agent_task(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    run_id: String
) -> Result<(), String> {
    state.abort_task(run_id).await
}
