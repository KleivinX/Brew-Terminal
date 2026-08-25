use tauri::State;

use crate::error::AppResult;
use crate::models::{LearningProgress, ProgressStatus};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn list_progress(state: State<'_, AppState>) -> AppResult<Vec<LearningProgress>> {
    services::learn::list_progress(&state).await
}

#[tauri::command]
pub async fn set_progress(
    state: State<'_, AppState>,
    item_id: String,
    path_id: String,
    status: ProgressStatus,
) -> AppResult<()> {
    services::learn::set_progress(&state, item_id, path_id, status).await
}

#[tauri::command]
pub async fn reset_progress(state: State<'_, AppState>, path_id: Option<String>) -> AppResult<()> {
    services::learn::reset_progress(&state, path_id).await
}
