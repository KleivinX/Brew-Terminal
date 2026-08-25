use tauri::State;

use crate::error::AppResult;
use crate::models::{
    AiContextItem, AiConversation, AiMessage, AiMode, AiOutboundEntry, AiSendPreview, AiSendResult,
    AiStatus,
};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn get_ai_status(state: State<'_, AppState>) -> AppResult<AiStatus> {
    services::ai::get_status(&state).await
}

#[tauri::command]
pub async fn save_ai_endpoint(
    state: State<'_, AppState>,
    endpoint: String,
    model: String,
) -> AppResult<AiStatus> {
    services::ai::save_local_endpoint(&state, endpoint, model).await
}

/// The address and model only. The key goes in through `save_provider_credential`, which is
/// the single inward path for every secret in the app.
#[tauri::command]
pub async fn save_ai_cloud_endpoint(
    state: State<'_, AppState>,
    endpoint: String,
    model: String,
) -> AppResult<AiStatus> {
    services::ai::save_cloud_endpoint(&state, endpoint, model).await
}

#[tauri::command]
pub async fn clear_ai_endpoint(state: State<'_, AppState>, mode: AiMode) -> AppResult<AiStatus> {
    services::ai::clear_endpoint(&state, mode).await
}

/// Makes one real request to the endpoint, and only when the user presses the button.
#[tauri::command]
pub async fn test_ai_endpoint(state: State<'_, AppState>) -> AppResult<services::ai::AiTestResult> {
    services::ai::test_endpoint(&state).await
}

/// Computes what a send would transmit. Sends nothing.
#[tauri::command]
pub async fn preview_ai_send(
    state: State<'_, AppState>,
    conversation_id: Option<String>,
    prompt: String,
    context: Vec<AiContextItem>,
) -> AppResult<AiSendPreview> {
    services::ai::preview_send(&state, conversation_id, prompt, context).await
}

/// The only command in the app that sends a user's own words anywhere.
#[tauri::command]
pub async fn send_ai_message(
    state: State<'_, AppState>,
    conversation_id: Option<String>,
    prompt: String,
    context: Vec<AiContextItem>,
) -> AppResult<AiSendResult> {
    services::ai::send_message(&state, conversation_id, prompt, context).await
}

#[tauri::command]
pub async fn list_ai_conversations(state: State<'_, AppState>) -> AppResult<Vec<AiConversation>> {
    services::ai::list_conversations(&state).await
}

#[tauri::command]
pub async fn get_ai_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> AppResult<Vec<AiMessage>> {
    services::ai::get_messages(&state, conversation_id).await
}

#[tauri::command]
pub async fn delete_ai_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
) -> AppResult<()> {
    services::ai::delete_conversation(&state, conversation_id).await
}

#[tauri::command]
pub async fn clear_ai_conversations(state: State<'_, AppState>) -> AppResult<()> {
    services::ai::clear_conversations(&state).await
}

#[tauri::command]
pub async fn list_ai_outbound_log(state: State<'_, AppState>) -> AppResult<Vec<AiOutboundEntry>> {
    services::ai::list_outbound_log(&state).await
}

#[tauri::command]
pub async fn clear_ai_outbound_log(state: State<'_, AppState>) -> AppResult<()> {
    services::ai::clear_outbound_log(&state).await
}
