use serde::{Deserialize, Serialize};
use std::env;
use std::process::Command;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{SigningKey, Signer};
use pkcs8::DecodePrivateKey;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use futures_util::{StreamExt, SinkExt};
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
async fn get_api_key() -> Result<String, String> {
    dotenvy::dotenv().ok();
    env::var("GEMINI_API_KEY").map_err(|_| "GEMINI_API_KEY not found in environment".to_string())
}

#[tauri::command]
async fn capture_screen() -> Result<String, String> {
    let path = "/tmp/jiling_screen.png";
    let output = Command::new("screencapture")
        .args(["-x", path])
        .output()
        .map_err(|e| format!("Failed to run screencapture: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read screenshot: {}", e))?;
    let b64 = STANDARD.encode(bytes);
    Ok(b64)
}

#[derive(Serialize, Deserialize, Debug)]
struct AcpRequest<T> {
    #[serde(rename = "type")]
    msg_type: String,
    method: String,
    params: T,
}

#[derive(Serialize, Deserialize, Debug)]
struct ConnectParams {
    id: String,
    mode: String,
    role: String,
    scopes: Vec<String>,
    platform: String,
    #[serde(rename = "deviceFamily")]
    device_family: String,
    #[serde(rename = "authType")]
    auth_type: String,
    ts: u64,
    nonce: String,
    signature: String,
    token: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct AgentRunParams {
    agent: String,
    message: String,
}

#[tauri::command]
async fn execute_agent(agent: String, task: String) -> Result<String, String> {
    println!("🚀 [Jiling] 正在发起 ACP 调用处理任务: {}", task);
    
    // 1. 读取身份信息
    let home = env::var("HOME").map_err(|_| "HOME not found")?;
    let id_content = std::fs::read_to_string(format!("{}/.openclaw/identity/device.json", home))
        .map_err(|_| "Device identity not found")?;
    let id_json: serde_json::Value = serde_json::from_str(&id_content).map_err(|_| "Invalid identity JSON")?;
    
    let device_id = id_json["deviceId"].as_str().ok_or("No deviceId")?;
    let priv_key_hex = id_json["privateKey"].as_str().ok_or("No privateKey")?;
    
    // 读取网关 Token
    let gateway_content = std::fs::read_to_string(format!("{}/.openclaw/openclaw.json", home))
        .map_err(|_| "Gateway config not found")?;
    let gateway_json: serde_json::Value = serde_json::from_str(&gateway_content).map_err(|_| "Invalid gateway JSON")?;
    let token = gateway_json["gateway"]["auth"]["token"].as_str().unwrap_or("");

    // 2. 构造握手签名 (V3)
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() * 1000;
    let nonce = format!("{:x}", rand::random::<u64>());
    let scope = "operator.admin";
    
    // 拼接顺序: v3|deviceId|cli|cli|role|scope|ts|token|nonce|platform|deviceFamily
    let sign_payload = format!("v3|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}", 
        device_id, "jiling", "jiling", "operator", scope, ts, token, nonce, "macos", "desktop");
    
    let priv_key_bytes = hex::decode(priv_key_hex).map_err(|_| "Invalid hex key")?;
    let signing_key = SigningKey::from_bytes(&priv_key_bytes.try_into().map_err(|_| "Invalid key length")?);
    let signature = signing_key.sign(sign_payload.as_bytes());
    let sig_hex = hex::encode(signature.to_bytes());

    // 3. 连接并握手
    let url = "ws://127.0.0.1:18789/acp";
    let (mut ws_stream, _) = connect_async(url).await.map_err(|e| format!("Connection failed: {}", e))?;

    let connect_msg = AcpRequest {
        msg_type: "req".to_string(),
        method: "connect".to_string(),
        params: ConnectParams {
            id: "jiling".to_string(),
            mode: "jiling".to_string(),
            role: "operator".to_string(),
            scopes: vec![scope.to_string()],
            platform: "macos".to_string(),
            device_family: "desktop".to_string(),
            auth_type: "v3".to_string(),
            ts,
            nonce,
            signature: sig_hex,
            token: token.to_string(),
        }
    };

    ws_stream.send(Message::Text(serde_json::to_string(&connect_msg).unwrap())).await.map_err(|e| e.to_string())?;

    // 等待握手响应
    if let Some(Ok(msg)) = ws_stream.next().await {
        println!("✅ [Jiling] ACP 握手响应: {}", msg);
    }

    // 4. 执行 Agent 任务
    // 这里使用标准的 ACP 结构 (虽然 OpenClaw 喜欢 req 帧，我们兼容它)
    let run_msg = AcpRequest {
        msg_type: "req".to_string(),
        method: "agent/run".to_string(),
        params: AgentRunParams {
            agent: "openclaw".to_string(),
            message: task,
        }
    };

    ws_stream.send(Message::Text(serde_json::to_string(&run_msg).unwrap())).await.map_err(|e| e.to_string())?;

    // 5. 获取结果
    let mut result = String::new();
    while let Some(Ok(msg)) = ws_stream.next().await {
        if let Message::Text(text) = msg {
            let v: serde_json::Value = serde_json::from_str(&text).map_err(|_| "Invalid JSON response")?;
            // 如果是 partialResult 或者最终 result
            if let Some(content) = v["result"]["content"].as_str() {
                result = content.to_string();
                break; 
            }
            // 处理错误
            if v["error"].is_object() {
                return Err(v["error"]["message"].as_str().unwrap_or("Unknown error").to_string());
            }
        }
    }

    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|_app| {
            dotenvy::dotenv().ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            execute_agent, 
            capture_screen, 
            get_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
