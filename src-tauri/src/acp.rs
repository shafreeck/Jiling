use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures_util::{StreamExt, SinkExt};
use ed25519_dalek::{SigningKey, Signer, pkcs8::DecodePrivateKey};
use base64::{Engine as _, engine::general_purpose};
use std::fs;

#[tauri::command]
pub async fn execute_agent_acp_task(agent: String, task: String) -> Result<String, String> {
    println!("🚀 [Jiling] 正在发起 ACP 任务: {}", task);

    let home = std::env::var("HOME").map_err(|_| "HOME not found".to_string())?;
    let openclaw_json_path = format!("{}/.openclaw/openclaw.json", home);
    let gateway_json: serde_json::Value = serde_json::from_str(&fs::read_to_string(openclaw_json_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let address = gateway_json["gateway"]["address"].as_str().unwrap_or("127.0.0.1:18789");
    let ws_url = format!("ws://{}/acp", address);

    let device_auth_path = format!("{}/.openclaw/identity/device-auth.json", home);
    let auth_json: serde_json::Value = serde_json::from_str(&fs::read_to_string(device_auth_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let device_id = auth_json["deviceId"].as_str().ok_or("No deviceId in device-auth.json")?;
    let device_token = auth_json["tokens"]["operator"]["token"].as_str().ok_or("No operator token in device-auth.json")?;

    let device_json_path = format!("{}/.openclaw/identity/device.json", home);
    let device_data: serde_json::Value = serde_json::from_str(&fs::read_to_string(device_json_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let private_key_pem = device_data["privateKeyPem"].as_str().ok_or("No privateKeyPem in device.json")?;
    let signing_key = SigningKey::from_pkcs8_pem(private_key_pem).map_err(|e| e.to_string())?;

    let client_id = "node-host";
    let mode = "node";
    let role = "operator";
    let platform = "darwin";
    let device_family = "desktop";
    let scopes = vec![
        "operator.admin".to_string(),
        "operator.read".to_string(),
        "operator.write".to_string(),
    ];
    let scopes_str = scopes.join(",");

    let (mut ws_stream, _) = connect_async(ws_url).await.map_err(|e| e.to_string())?;
    let mut authenticated = false;
    let mut response_text = String::new();

    while let Some(Ok(msg)) = ws_stream.next().await {
        if let Message::Text(text) = msg {
            let v: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            if v["event"] == "connect.challenge" {
                let nonce = v["payload"]["nonce"].as_str().ok_or("No nonce in challenge")?;
                let ts = v["payload"]["ts"].as_i64().ok_or("No ts in challenge")?;
                let sign_payload = format!("v3|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}", 
                    device_id, client_id, mode, role, scopes_str, ts, device_token, nonce, platform, device_family);
                let sig = signing_key.sign(sign_payload.as_bytes());
                let sig_b64 = general_purpose::URL_SAFE_NO_PAD.encode(sig.to_bytes());
                let public_key_b64 = general_purpose::URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes());
                let auth_msg = serde_json::json!({
                    "type": "req", "method": "connect", "id": "1",
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
            if v["type"] == "res" && !authenticated {
                if v["id"] == "1" {
                    if v["ok"].as_bool().unwrap_or(false) {
                        println!("✅ [Jiling] ACP 认证成功");
                        authenticated = true;
                        let agent_msg = serde_json::json!({
                            "type": "req", "method": "agent", "id": "2",
                            "params": { "agentId": agent, "message": task.clone() }
                        });
                        ws_stream.send(Message::Text(serde_json::to_string(&agent_msg).unwrap().into())).await.map_err(|e| e.to_string())?;
                    } else {
                        return Err(format!("ACP Auth failed: {}", v["error"]["message"]));
                    }
                }
                continue;
            }
            if v["type"] == "res" && v["id"] == "2" {
                if v["ok"] == true {
                    response_text = v["payload"]["output"].as_str().unwrap_or("Done").to_string();
                } else {
                    return Err(format!("Execution failed: {}", v["error"]["message"]));
                }
                break;
            }
        }
    }
    Ok(response_text)
}
