#[tauri::command]
fn execute_agent(agent: String, task: String) -> Result<String, String> {
    use std::process::Command;
    
    // 严谨起见，这里可以增加对 agent 名称的白名单校验
    let output = Command::new(&agent)
        .arg(&task)
        .output()
        .map_err(|e| format!("Failed to execute {}: {}", agent, e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![execute_agent])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
