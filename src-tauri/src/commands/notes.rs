use tauri::State;

use crate::error::AppResult;
use crate::models::Note;
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn list_notes(state: State<'_, AppState>, asset_id: String) -> AppResult<Vec<Note>> {
    services::notes::list_notes(&state, asset_id).await
}

#[tauri::command]
pub async fn upsert_note(
    state: State<'_, AppState>,
    note_id: Option<String>,
    asset_id: Option<String>,
    title: String,
    body_md: String,
) -> AppResult<Note> {
    services::notes::upsert_note(&state, note_id, asset_id, title, body_md).await
}

#[tauri::command]
pub async fn delete_note(state: State<'_, AppState>, note_id: String) -> AppResult<()> {
    services::notes::delete_note(&state, note_id).await
}

#[tauri::command]
pub async fn search_notes(
    state: State<'_, AppState>,
    query: String,
    limit: usize,
) -> AppResult<Vec<Note>> {
    services::notes::search_notes(&state, query, limit).await
}
