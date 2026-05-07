use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

pub mod acp;
mod commands;
pub mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("jiling.log".to_string()),
                    }),
                    Target::new(TargetKind::Webview),
                ])
                .rotation_strategy(RotationStrategy::KeepAll)
                .filter(|metadata| {
                    let target = metadata.target();
                    !target.starts_with("tungstenite")
                        && !target.starts_with("tokio_tungstenite")
                        && !target.starts_with("tao")
                        && !target.starts_with("tokio_util")
                })
                .build(),
        )
        .setup(|app| {
            let manager = std::sync::Arc::new(acp::GlobalAcpManager::new(app.handle().clone()));
            app.manage(manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            acp::execute_agent_acp_task,
            acp::abort_agent_task,
            acp::get_task_output,
            acp::get_agent_task_status,
            commands::get_api_key,
            commands::get_api_key_status,
            commands::set_api_key,
            commands::capture_screen
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
