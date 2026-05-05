use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::env;
use std::process::Command;

#[tauri::command]
pub async fn get_api_key() -> Result<String, String> {
    dotenvy::dotenv().ok();
    env::var("GEMINI_API_KEY").map_err(|_| "GEMINI_API_KEY not found in environment".to_string())
}

#[tauri::command]
pub async fn capture_screen() -> Result<String, String> {
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
