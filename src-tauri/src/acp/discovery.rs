use std::fs;
use serde_json::Value;
use crate::acp::types::*;

pub fn discover_local_providers() -> Vec<ProviderDescriptor> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut providers = Vec::new();

    // 扫描常见的 OpenClaw/AutoClaw 目录
    let paths = [
        (".openclaw", "openclaw", "OpenClaw"),
        (".openclaw-autoclaw", "autoclaw", "AutoClaw"),
        (".hermes", "hermes", "Hermes")
    ];
    for (dir, id, name) in paths {
        let full_path = format!("{}/{}", home, dir);
        if let Ok(metadata) = fs::metadata(&full_path) {
            if metadata.is_dir() {
                let port = get_port_from_config(&full_path);
                providers.push(ProviderDescriptor {
                    id: id.to_string(),
                    name: name.to_string(),
                    endpoint: format!("ws://127.0.0.1:{}/acp", port),
                    auth_type: AuthType::ChallengeResponse,
                    config_dir: Some(dir.to_string()),
                });
            }
        }
    }

    providers
}

fn get_port_from_config(dir: &str) -> u16 {
    let config_files = ["node.json", "openclaw.json"];
    for f in &config_files {
        let path = format!("{}/{}", dir, f);
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(json) = serde_json::from_str::<Value>(&content) {
                if let Some(port) = json["gateway"]["port"].as_u64() {
                    return port as u16;
                }
            }
        }
    }
    18789 // Default
}
