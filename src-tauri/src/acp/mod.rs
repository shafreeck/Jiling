pub mod types;
pub mod manager;
pub mod provider;
pub mod discovery;
pub mod auth;
pub mod utils;
#[cfg(test)]
pub mod tests;

pub use types::*;
pub use manager::GlobalAcpManager;

use std::sync::Arc;
use serde_json::{json, Value};

#[tauri::command]
pub async fn execute_agent_acp_task(
    provider_id: String,
    agent: String,
    task: String,
    system_instruction: String,
    attachments: Option<Vec<String>>,
    silent: bool,
    manager: tauri::State<'_, Arc<GlobalAcpManager>>,
) -> Result<String, String> {
    manager.execute_task(&provider_id, json!({
        "agent_id": agent,
        "message": task,
        "system_instruction": system_instruction,
        "attachments": attachments,
        "silent": silent
    })).await
}

#[tauri::command]
pub async fn abort_agent_task(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    run_id: String,
) -> Result<(), String> {
    state.abort_task(run_id).await
}

#[tauri::command]
pub async fn get_task_output(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    run_id: String,
) -> Result<String, String> {
    state.get_task_output(run_id).await
}

#[tauri::command]
pub async fn get_agent_task_status(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    run_id: String,
) -> Result<crate::db::TaskSnapshot, String> {
    state.get_agent_task_status(run_id).await
}

#[tauri::command]
pub async fn list_agent_tasks(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
) -> Result<Vec<crate::db::TaskSnapshot>, String> {
    state.list_agent_tasks().await
}


#[tauri::command]
pub async fn get_acp_models(
    manager: tauri::State<'_, Arc<GlobalAcpManager>>,
    provider_id: String,
) -> Result<Vec<Value>, String> {
    manager.get_acp_models(&provider_id).await
}

#[tauri::command]
pub async fn switch_agent_model(
    manager: tauri::State<'_, Arc<GlobalAcpManager>>,
    provider_id: String,
    model_id: String,
) -> Result<(), String> {
    manager.switch_agent_model(&provider_id, &model_id).await
}

#[tauri::command]
pub async fn get_device_identity(
    manager: tauri::State<'_, Arc<GlobalAcpManager>>,
) -> Result<Identity, String> {
    manager.get_identity().await
}

#[tauri::command]
pub async fn update_agent_task_output(
    state: tauri::State<'_, Arc<GlobalAcpManager>>,
    run_id: String,
    output: String,
) -> Result<(), String> {
    state.update_task_output(run_id, output).await
}
