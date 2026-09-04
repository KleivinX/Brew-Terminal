use tauri::State;

use crate::error::AppResult;
use crate::models::Note;
use crate::services;
use crate::state::AppState;

/// Every note, newest first — the notes workspace.
#[tauri::command]
pub async fn list_all_notes(state: State<'_, AppState>) -> AppResult<Vec<Note>> {
    services::notes::list_all_notes(&state).await
}

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

/// Undo for a deleted note. Takes the whole note because the row it would be read from is
/// already gone — see `services::notes::restore_note`.
#[tauri::command]
pub async fn restore_note(state: State<'_, AppState>, note: Note) -> AppResult<Note> {
    services::notes::restore_note(&state, note).await
}

#[tauri::command]
pub async fn search_notes(
    state: State<'_, AppState>,
    query: String,
    limit: usize,
) -> AppResult<Vec<Note>> {
    services::notes::search_notes(&state, query, limit).await
}
