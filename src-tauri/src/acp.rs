use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures_util::{StreamExt, SinkExt};
use ed25519_dalek::{SigningKey, Signer, pkcs8::DecodePrivateKey};
use base64::{Engine as _, engine::general_purpose};
use std::fs;
use serde_json::json;

#[tauri::command]
pub async fn execute_agent_acp_task(agent: String, task: String) -> Result<String, String> {
    println!("🚀 [Jiling] 正在发起 ACP 任务: {}", task);
    
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    
    // 1. 加载身份
    let device_auth_path = format!("{}/.openclaw/identity/device-auth.json", home);
    let auth_json: serde_json::Value = serde_json::from_str(&fs::read_to_string(device_auth_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let device_id = auth_json["deviceId"].as_str().ok_or("Missing deviceId")?;
    let device_token = auth_json["tokens"]["operator"]["token"].as_str().ok_or("Missing token")?;

    let device_json_path = format!("{}/.openclaw/identity/device.json", home);
    let device_data: serde_json::Value = serde_json::from_str(&fs::read_to_string(device_json_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let private_key_pem = device_data["privateKeyPem"].as_str().ok_or("Missing privateKeyPem")?;
    let signing_key = SigningKey::from_pkcs8_pem(private_key_pem).map_err(|e| e.to_string())?;

    // 2. 连接 WebSocket
    let ws_url = "ws://127.0.0.1:18789/acp";
    let (mut ws_stream, _) = connect_async(ws_url).await.map_err(|e| e.to_string())?;
    
    let client_id = "node-host";
    let mode = "node";
    let role = "operator";
    let platform = "darwin";
    let device_family = "desktop";
    let scopes = vec!["operator.admin", "operator.read", "operator.write"];
    let scopes_str = scopes.join(",");

    let mut response_text = String::from("任务已执行，但未获取到详细返回结果。");

    while let Some(Ok(msg)) = ws_stream.next().await {
        if let Message::Text(text) = msg {
            let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            
            // A. 处理 Challenge
            if v["event"] == "connect.challenge" {
                let nonce = v["payload"]["nonce"].as_str().unwrap_or("");
                let ts = v["payload"]["ts"].as_i64().unwrap_or(0);
                
                let sign_payload = format!("v3|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}", 
                    device_id, client_id, mode, role, scopes_str, ts, device_token, nonce, platform, device_family);
                
                let sig = signing_key.sign(sign_payload.as_bytes());
                let sig_b64 = general_purpose::URL_SAFE_NO_PAD.encode(sig.to_bytes());
                let public_key_b64 = general_purpose::URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes());

                let auth_msg = json!({
                    "type": "req", "method": "connect", "id": "auth",
                    "params": {
                        "minProtocol": 3, "maxProtocol": 3, "role": role, "scopes": scopes,
                        "client": { "id": client_id, "version": "2026.4.29", "platform": platform, "mode": mode, "deviceFamily": device_family },
                        "device": { "id": device_id, "publicKey": public_key_b64, "signature": sig_b64, "signedAt": ts, "nonce": nonce },
                        "auth": { "deviceToken": device_token }
                    }
                });
                ws_stream.send(Message::Text(serde_json::to_string(&auth_msg).unwrap().into())).await.map_err(|e| e.to_string())?;
                continue;
            }

            // B. 认证成功后发起任务
            if v["type"] == "res" && v["id"] == "auth" {
                if v["ok"].as_bool().unwrap_or(false) {
                    println!("✅ [Jiling] ACP 认证成功");
                    let idempotency_key = format!("jiling-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
                    let agent_msg = json!({
                        "type": "req", "method": "agent", "id": "agent_run",
                        "params": { 
                            "agentId": agent, 
                            "message": task.clone(),
                            "deliver": false,
                            "idempotencyKey": idempotency_key
                        }
                    });
                    ws_stream.send(Message::Text(serde_json::to_string(&agent_msg).unwrap().into())).await.map_err(|e| e.to_string())?;
                } else {
                    return Err(format!("ACP 认证失败: {}", v["error"]));
                }
                continue;
            }

            // C. 任务已受理，获取 runId 并调用 wait
            if v["type"] == "res" && v["id"] == "agent_run" {
                if v["ok"].as_bool().unwrap_or(false) {
                    let run_id = v["payload"]["runId"].as_str().unwrap_or("").to_string();
                    println!("🎉 [Jiling] 任务已受理, runId: {}", run_id);
                    
                    let wait_msg = json!({
                        "type": "req", "method": "agent.wait", "id": "agent_wait",
                        "params": {
                            "runId": run_id,
                            "timeoutMs": 120000 
                        }
                    });
                    ws_stream.send(Message::Text(serde_json::to_string(&wait_msg).unwrap().into())).await.map_err(|e| e.to_string())?;
                } else {
                    return Err(format!("任务发起失败: {}", v["error"]));
                }
                continue;
            }

            // D. 获取最终执行结果
            if v["type"] == "res" && v["id"] == "agent_wait" {
                if v["ok"].as_bool().unwrap_or(false) {
                    if let Some(output) = v["payload"]["result"]["payload"]["output"].as_str() {
                        response_text = output.to_string();
                    } else if let Some(summary) = v["payload"]["result"]["meta"]["terminalSummary"].as_str() {
                        response_text = summary.to_string();
                    } else {
                        response_text = format!("任务执行完成。状态: {}", v["payload"]["status"]);
                    }
                    println!("🎊 [Jiling] 任务执行完成");
                } else {
                    response_text = format!("任务等待超时或失败: {}", v["error"]["message"]);
                }
                break;
            }
        }
    }

    Ok(response_text)
}
