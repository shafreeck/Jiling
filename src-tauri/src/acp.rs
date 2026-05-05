use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures_util::{StreamExt, SinkExt};
use ed25519_dalek::{SigningKey, Signer, pkcs8::DecodePrivateKey};
use base64::{Engine as _, engine::general_purpose};
use std::fs::{self, OpenOptions};
use std::io::Write;
use serde_json::json;
use tokio::time::{timeout, Duration};
use std::time::{SystemTime, UNIX_EPOCH};

/// 辅助函数：记录日志到文件，方便调试
fn log_acp(msg: &str) {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let log_path = format!("{}/.openclaw/logs/jiling-acp.log", home);
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(file, "[{}] {}", timestamp, msg);
    }
    println!("{}", msg); // 同时打印到控制台
}

#[tauri::command]
pub async fn execute_agent_acp_task(agent: String, task: String) -> Result<String, String> {
    log_acp(&format!("🚀 [Jiling] 发起任务: {}", task));
    
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    
    // 1. 加载身份
    let device_auth_path = format!("{}/.openclaw/identity/device-auth.json", home);
    let auth_json: serde_json::Value = serde_json::from_str(&fs::read_to_string(device_auth_path).map_err(|e| {
        let err = format!("❌ 无法读取 device-auth.json: {}", e);
        log_acp(&err);
        err
    })?).map_err(|e| e.to_string())?;
    
    let device_id = auth_json["deviceId"].as_str().ok_or("Missing deviceId")?;
    let device_token = auth_json["tokens"]["operator"]["token"].as_str().ok_or("Missing token")?;

    let device_json_path = format!("{}/.openclaw/identity/device.json", home);
    let device_data: serde_json::Value = serde_json::from_str(&fs::read_to_string(device_json_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let private_key_pem = device_data["privateKeyPem"].as_str().ok_or("Missing privateKeyPem")?;
    let signing_key = SigningKey::from_pkcs8_pem(private_key_pem).map_err(|e| e.to_string())?;

    // 2. 连接 WebSocket
    let ws_url = "ws://127.0.0.1:18789/acp";
    let (mut ws_stream, _) = connect_async(ws_url).await.map_err(|e| {
        let err = format!("❌ WebSocket 连接失败: {}", e);
        log_acp(&err);
        err
    })?;
    
    let mut response_text = String::new();
    let mut run_id = String::new();
    let mut task_completed = false;

    let task_future = async {
        while let Some(Ok(msg)) = ws_stream.next().await {
            if let Message::Text(text) = msg {
                log_acp(&format!("📥 [收]: {}", text));
                let v: serde_json::Value = serde_json::from_str(&text).ok()?;
                
                if v["event"] == "connect.challenge" {
                    let auth_msg = build_auth_msg(&v, device_id, device_token, &signing_key);
                    log_acp("📤 发送认证请求");
                    let _ = ws_stream.send(Message::Text(serde_json::to_string(&auth_msg).unwrap().into())).await;
                    continue;
                }

                if v["type"] == "res" && v["id"] == "auth" {
                    if v["ok"] == true {
                        log_acp("✅ 认证成功");
                        let idempotency_key = format!("jiling-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos());
                        let agent_msg = json!({
                            "type": "req", "method": "agent", "id": "run",
                            "params": { "agentId": agent, "message": task.clone(), "deliver": false, "idempotencyKey": idempotency_key }
                        });
                        let _ = ws_stream.send(Message::Text(serde_json::to_string(&agent_msg).unwrap().into())).await;
                    } else {
                        log_acp(&format!("❌ 认证失败: {}", v["error"]));
                    }
                    continue;
                }

                if v["type"] == "res" && v["id"] == "run" {
                    if v["ok"] == true {
                        run_id = v["payload"]["runId"].as_str().unwrap_or("").to_string();
                        log_acp(&format!("🚀 任务受理, runId: {}", run_id));
                        let wait_msg = json!({
                            "type": "req", "method": "agent.wait", "id": "wait",
                            "params": { "runId": run_id.clone(), "timeoutMs": 45000 }
                        });
                        let _ = ws_stream.send(Message::Text(serde_json::to_string(&wait_msg).unwrap().into())).await;
                    } else {
                        log_acp(&format!("❌ 任务发起失败: {}", v["error"]));
                    }
                    continue;
                }

                if v["event"] == "agent" && v["payload"]["runId"] == run_id {
                    let payload = &v["payload"];
                    if payload["stream"] == "assistant" {
                        if let Some(txt) = payload["data"]["text"].as_str() {
                            response_text = txt.to_string();
                        }
                    }
                    if payload["stream"] == "lifecycle" && (payload["data"]["phase"] == "end" || payload["data"]["phase"] == "error") {
                        task_completed = true;
                        break;
                    }
                }

                if v["type"] == "res" && v["id"] == "wait" && v["ok"] == true {
                    if v["payload"]["status"] == "success" {
                        if let Some(out) = v["payload"]["result"]["payload"]["output"].as_str() {
                            response_text = out.to_string();
                        }
                        task_completed = true;
                        break;
                    }
                }
            }
        }
        Some(())
    };

    match timeout(Duration::from_secs(50), task_future).await {
        Ok(_) => {
            if task_completed {
                Ok(response_text)
            } else {
                let msg = format!("(阶段性回答): {}\n\n任务可能仍在进行中 (ID: {})", response_text, run_id);
                log_acp(&msg);
                Ok(msg)
            }
        },
        Err(_) => {
            let msg = format!("任务处理超时。当前获取: {}\n任务 ID: {}", response_text, run_id);
            log_acp(&msg);
            Ok(msg)
        }
    }
}

#[tauri::command]
pub async fn query_agent_task(run_id: String) -> Result<String, String> {
    log_acp(&format!("🔍 [Jiling] 查询任务进度: {}", run_id));
    
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    
    // 1. 加载身份 (复用上面的逻辑)
    let device_auth_path = format!("{}/.openclaw/identity/device-auth.json", home);
    let auth_json: serde_json::Value = serde_json::from_str(&fs::read_to_string(device_auth_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let device_id = auth_json["deviceId"].as_str().ok_or("Missing deviceId")?;
    let device_token = auth_json["tokens"]["operator"]["token"].as_str().ok_or("Missing token")?;

    let device_json_path = format!("{}/.openclaw/identity/device.json", home);
    let device_data: serde_json::Value = serde_json::from_str(&fs::read_to_string(device_json_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let private_key_pem = device_data["privateKeyPem"].as_str().ok_or("Missing privateKeyPem")?;
    let signing_key = SigningKey::from_pkcs8_pem(private_key_pem).map_err(|e| e.to_string())?;

    let ws_url = "ws://127.0.0.1:18789/acp";
    let (mut ws_stream, _) = connect_async(ws_url).await.map_err(|e| e.to_string())?;
    
    let mut response_text = String::new();
    let mut task_completed = false;

    let query_future = async {
        while let Some(Ok(msg)) = ws_stream.next().await {
            if let Message::Text(text) = msg {
                log_acp(&format!("📥 [查询-收]: {}", text));
                let v: serde_json::Value = serde_json::from_str(&text).ok()?;
                
                if v["event"] == "connect.challenge" {
                    let auth_msg = build_auth_msg(&v, device_id, device_token, &signing_key);
                    let _ = ws_stream.send(Message::Text(serde_json::to_string(&auth_msg).unwrap().into())).await;
                    continue;
                }

                if v["type"] == "res" && v["id"] == "auth" && v["ok"] == true {
                    // 发起 wait 来查询已有的 runId
                    let wait_msg = json!({
                        "type": "req", "method": "agent.wait", "id": "query_wait",
                        "params": { "runId": run_id.clone(), "timeoutMs": 15000 }
                    });
                    let _ = ws_stream.send(Message::Text(serde_json::to_string(&wait_msg).unwrap().into())).await;
                    continue;
                }

                if v["event"] == "agent" && v["payload"]["runId"] == run_id {
                    if v["payload"]["stream"] == "assistant" {
                        if let Some(txt) = v["payload"]["data"]["text"].as_str() {
                            response_text = txt.to_string();
                        }
                    }
                    if v["payload"]["stream"] == "lifecycle" && (v["payload"]["data"]["phase"] == "end" || v["payload"]["data"]["phase"] == "error") {
                        task_completed = true;
                        break;
                    }
                }

                if v["type"] == "res" && v["id"] == "query_wait" && v["ok"] == true {
                    if let Some(out) = v["payload"]["result"]["payload"]["output"].as_str() {
                        response_text = out.to_string();
                        task_completed = true;
                        break;
                    }
                }
            }
        }
        Some(())
    };

    match timeout(Duration::from_secs(20), query_future).await {
        Ok(_) => Ok(response_text),
        Err(_) => {
            if response_text.is_empty() {
                Ok("任务仍在思考中，暂无结果。".to_string())
            } else {
                Ok(format!("(最新进展): {}", response_text))
            }
        }
    }
}

fn build_auth_msg(v: &serde_json::Value, device_id: &str, device_token: &str, signing_key: &SigningKey) -> serde_json::Value {
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
