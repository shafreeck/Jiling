use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::process::{Child, Command};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex};
use tauri::{AppHandle, Manager, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WechatStatus {
    pub state: String,
    pub error: Option<String>,
}

pub struct WechatManager {
    app_handle: AppHandle,
    child: Arc<Mutex<Option<Child>>>,
    stdin_tx: mpsc::UnboundedSender<String>,
}

impl WechatManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<String>();
        let child_arc: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None::<Child>));
        let child_clone = child_arc.clone();

        // Stdin writer thread
        tauri::async_runtime::spawn(async move {
            while let Some(msg) = stdin_rx.recv().await {
                let mut child_lock = child_clone.lock().await;
                if let Some(child) = child_lock.as_mut() {
                    if let Some(stdin) = child.stdin.as_mut() {
                        let _ = AsyncWriteExt::write_all(stdin, format!("{}\n", msg).as_bytes()).await;
                        let _ = AsyncWriteExt::flush(stdin).await;
                    }
                }
            }
        });

        WechatManager {
            app_handle,
            child: child_arc,
            stdin_tx,
        }
    }

    pub async fn login(&self) -> Result<(), String> {
        let mut child_lock = self.child.lock().await;
        
        // Kill existing process if any to ensure a clean start
        if let Some(mut old_child) = child_lock.take() {
            let _ = old_child.kill().await;
        }

        let app_handle = self.app_handle.clone();

        let base_path = if cfg!(debug_assertions) {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        } else {
            app_handle.path().resource_dir().map_err(|e| e.to_string())?
        };
        
        let gateway_path = base_path.join("weixin-gateway/index.ts");

        if !gateway_path.exists() {
            return Err(format!("Wechat gateway not found at: {}", gateway_path.display()));
        }

        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let state_dir = format!("{}/.jiling/weixin", home);

        let mut child = Command::new("pnpm")
            .env("OPENCLAW_STATE_DIR", state_dir)
            .args(["ts-node", gateway_path.to_str().unwrap()])
            .current_dir(gateway_path.parent().unwrap())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn gateway via shell: {}", e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

        *child_lock = Some(child);

        // Stdout reader
        let app_handle_stdout = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            while let Ok(n) = reader.read_line(&mut line).await {
                if n == 0 { break; }
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    if v["type"] == "event" {
                        let _ = app_handle_stdout.emit("wechat-event", v);
                    }
                }
                line.clear();
            }
        });

        // Stderr reader (for debugging)
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            while let Ok(n) = reader.read_line(&mut line).await {
                if n == 0 { break; }
                eprintln!("[Wechat Gateway Error] {}", line.trim());
                line.clear();
            }
        });

        Ok(())
    }

    pub async fn logout(&self) -> Result<(), String> {
        let mut child_lock = self.child.lock().await;
        if let Some(mut child) = child_lock.take() {
            // Kill the process immediately, but DO NOT delete files here
            let _ = child.kill().await;
            println!("[Wechat] Gateway process killed.");
        }
        Ok(())
    }

    pub async fn cleanup_session(&self) -> Result<(), String> {
        // Physical cleanup
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let state_dir = std::path::PathBuf::from(format!("{}/.jiling/weixin", home));
        
        // The SDK seems to append "openclaw-weixin" to the state dir or use it as a subfolder
        let sub_dir = state_dir.join("openclaw-weixin");
        
        if sub_dir.exists() {
            let _ = std::fs::remove_dir_all(&sub_dir);
            println!("[Wechat] Removed sub-directory: {:?}", sub_dir);
        }

        let accounts_json = state_dir.join("accounts.json");
        let accounts_dir = state_dir.join("accounts");
        if accounts_json.exists() { let _ = std::fs::remove_file(accounts_json); }
        if accounts_dir.exists() { let _ = std::fs::remove_dir_all(accounts_dir); }
        
        println!("[Wechat] Physical session cleanup complete.");
        Ok(())
    }

    pub fn send_response(&self, request_id: String, payload: Value) {
        let msg = json!({
            "type": "response",
            "requestId": request_id,
            "payload": payload
        });
        let _ = self.stdin_tx.send(msg.to_string());
    }

    pub fn send_command(&self, method: String, params: Value) {
        let msg = json!({
            "type": "command",
            "method": method,
            "params": params
        });
        let _ = self.stdin_tx.send(msg.to_string());
    }
}

#[tauri::command]
pub async fn wechat_login(manager: tauri::State<'_, Arc<WechatManager>>) -> Result<(), String> {
    manager.login().await
}

#[tauri::command]
pub async fn wechat_logout(manager: tauri::State<'_, Arc<WechatManager>>) -> Result<(), String> {
    // This now only stops the process, preserving the session
    manager.logout().await
}

#[tauri::command]
pub async fn wechat_destroy_session(manager: tauri::State<'_, Arc<WechatManager>>) -> Result<(), String> {
    // This is the true logout: stop process AND delete files
    manager.logout().await?;
    manager.cleanup_session().await?;
    Ok(())
}

#[tauri::command]
pub async fn wechat_respond(
    manager: tauri::State<'_, Arc<WechatManager>>,
    request_id: String,
    payload: Value,
) -> Result<(), String> {
    manager.send_response(request_id, payload);
    Ok(())
}
