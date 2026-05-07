use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::env;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};

#[derive(Debug, Default, Deserialize, Serialize)]
struct AppSettings {
    gemini_api_key: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyStatus {
    configured: bool,
    source: Option<String>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Failed to resolve app config directory: {}", e))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app config directory: {}", e))?;
    Ok(dir.join("settings.json"))
}

fn load_settings(app: &AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read app settings: {}", e))?;
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse app settings: {}", e))
}

fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize app settings: {}", e))?;
    std::fs::write(&path, text).map_err(|e| format!("Failed to write app settings: {}", e))
}

#[tauri::command]
pub async fn get_api_key(app: AppHandle) -> Result<String, String> {
    if let Some(api_key) = load_settings(&app)?.gemini_api_key {
        let trimmed = api_key.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(trimmed);
        }
    }

    dotenvy::dotenv().ok();
    env::var("GEMINI_API_KEY").map_err(|_| "GEMINI_API_KEY not found in environment".to_string())
}

#[tauri::command]
pub async fn set_api_key(app: AppHandle, api_key: String) -> Result<(), String> {
    let trimmed = api_key.trim().to_string();
    let mut settings = load_settings(&app)?;
    settings.gemini_api_key = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    };
    save_settings(&app, &settings)
}

#[tauri::command]
pub async fn get_api_key_status(app: AppHandle) -> Result<ApiKeyStatus, String> {
    if let Some(api_key) = load_settings(&app)?.gemini_api_key {
        if !api_key.trim().is_empty() {
            return Ok(ApiKeyStatus {
                configured: true,
                source: Some("应用设置".to_string()),
            });
        }
    }

    dotenvy::dotenv().ok();
    Ok(match env::var("GEMINI_API_KEY") {
        Ok(value) if !value.trim().is_empty() => ApiKeyStatus {
            configured: true,
            source: Some("环境变量".to_string()),
        },
        _ => ApiKeyStatus {
            configured: false,
            source: None,
        },
    })
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
