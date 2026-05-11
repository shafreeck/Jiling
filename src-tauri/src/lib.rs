use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

pub mod acp;
mod commands;
pub mod db;
pub mod wechat;

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
            let manager = acp::GlobalAcpManager::new(app.handle().clone());
            let wechat_manager = std::sync::Arc::new(wechat::WechatManager::new(app.handle().clone()));
            
            // Reconcile tasks on startup to clear zombie entries
            let manager_clone = manager.clone();
            tauri::async_runtime::spawn(async move {
                manager_clone.reconcile_tasks().await;
            });

            app.manage(manager);
            app.manage(wechat_manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            acp::execute_agent_acp_task,
            acp::abort_agent_task,
            acp::get_task_output,
            acp::get_agent_task_status,
            acp::list_agent_tasks,
            acp::update_agent_task_output,
            acp::get_acp_models,
            acp::switch_agent_model,
            wechat::wechat_login,
            wechat::wechat_logout,
            wechat::wechat_destroy_session,
            wechat::wechat_respond,
            commands::get_api_key,
            commands::get_api_key_status,
            commands::set_api_key,
            acp::get_device_identity,
            commands::capture_screen,
            commands::open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
