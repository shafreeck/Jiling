use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn extract_error_message(v: &Value) -> Option<String> {
    for candidate in [
        v["error"]["message"].as_str(),
        v["error"]["error"].as_str(), // 有些 provider 嵌套两层
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

    // 最后回退：如果 error 是个对象或数组，直接转字符串
    if !v["error"].is_null() {
        return Some(v["error"].to_string());
    }
    
    None
}

pub fn timestamp_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}
