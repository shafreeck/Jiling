use tauri_plugin_log::{Target, TargetKind, RotationStrategy};

mod acp;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
                    !target.starts_with("tungstenite") && 
                    !target.starts_with("tokio_tungstenite") &&
                    !target.starts_with("tao") &&
                    !target.starts_with("tokio_util")
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            acp::execute_agent_acp_task,
            commands::get_api_key,
            commands::capture_screen
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
