use ed25519_dalek::{pkcs8::DecodePrivateKey, Signer, SigningKey};
use base64::{engine::general_purpose, Engine as _};
use serde_json::{json, Value};
use crate::acp::types::*;
use std::fs;

pub fn load_local_identity(provider_id: &str) -> Result<Identity, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let device_json_path = format!("{}/{}/identity/device.json", home, provider_id);
    
    let content = fs::read_to_string(&device_json_path).map_err(|e| format!("Failed to read {}: {}", device_json_path, e))?;
    let device_data: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        
    let private_key_pem = device_data["privateKeyPem"]
        .as_str()
        .ok_or("Missing privateKeyPem")?;
        
    let device_id = device_data["deviceId"].as_str().unwrap_or("unknown").to_string();
    
    // 从私钥计算公钥以便展示
    let public_key = if let Ok(signing_key) = SigningKey::from_pkcs8_pem(private_key_pem) {
        general_purpose::URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes())
    } else {
        "".to_string()
    };
    
    Ok(Identity {
        device_id,
        public_key,
        private_key: Some(private_key_pem.to_string()),
    })
}

pub fn sign_auth_challenge(identity: &Identity, challenge: &Value, device_token: &str) -> Result<Value, String> {
    let private_key_pem = identity.private_key.as_ref().ok_or("No private key available")?;
    let signing_key = SigningKey::from_pkcs8_pem(private_key_pem).map_err(|e| e.to_string())?;
    
    let nonce = challenge["payload"]["nonce"].as_str().unwrap_or("");
    let ts = challenge["payload"]["ts"].as_i64().unwrap_or(0);
    
    let sign_payload = format!(
        "v3|{}|node-host|node|operator|operator.admin,operator.read,operator.write|{}|{}|{}|darwin|desktop",
        identity.device_id, ts, device_token, nonce
    );
    
    let sig = signing_key.sign(sign_payload.as_bytes());
    let sig_b64 = general_purpose::URL_SAFE_NO_PAD.encode(sig.to_bytes());
    let public_key_b64 = general_purpose::URL_SAFE_NO_PAD.encode(signing_key.verifying_key().to_bytes());

    Ok(json!({
        "type": "req", "method": "connect", "id": "auth",
        "params": {
            "minProtocol": 3, "maxProtocol": 3, "role": "operator", "scopes": vec!["operator.admin", "operator.read", "operator.write"],
            "client": { "id": "node-host", "version": "2026.4.29", "platform": "darwin", "mode": "node", "deviceFamily": "desktop" },
            "device": { "id": identity.device_id, "publicKey": public_key_b64, "signature": sig_b64, "signedAt": ts, "nonce": nonce },
            "auth": { "deviceToken": device_token }
        }
    }))
}

pub fn load_device_token(provider_id: &str) -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let device_auth_path = format!("{}/{}/identity/device-auth.json", home, provider_id);
    let auth_json: Value = serde_json::from_str(&fs::read_to_string(device_auth_path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
        
    let device_id = auth_json["deviceId"].as_str().ok_or("Missing deviceId")?;
    
    let paired_path = format!("{}/{}/devices/paired.json", home, provider_id);
    if let Ok(content) = fs::read_to_string(paired_path) {
        if let Ok(paired_json) = serde_json::from_str::<Value>(&content) {
            if let Some(token) = paired_json[device_id]["tokens"]["operator"]["token"].as_str() {
                if !token.is_empty() { return Ok(token.to_string()); }
            }
        }
    }

    auth_json["tokens"]["operator"]["token"]
        .as_str()
        .map(ToString::to_string)
        .ok_or_else(|| "Missing operator token".to_string())
}
