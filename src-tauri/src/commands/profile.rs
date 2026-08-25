use tauri::State;

use crate::error::AppResult;
use crate::models::{ImportMode, ImportResult, ProfileSummary};
use crate::services;
use crate::state::AppState;

/// Writes an encrypted profile to a path the user chose in a file dialog.
///
/// The file is written in Rust. The frontend never receives the payload or the file bytes.
#[tauri::command]
pub async fn export_profile(
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> AppResult<services::profile::ExportResult> {
    services::profile::export(&state, path, password).await
}

/// Decrypts and validates a file, and writes nothing. Backs the "here is what is in it" step.
#[tauri::command]
pub async fn inspect_profile(
    state: State<'_, AppState>,
    path: String,
    password: String,
) -> AppResult<ProfileSummary> {
    services::profile::inspect(&state, path, password).await
}

#[tauri::command]
pub async fn import_profile(
    state: State<'_, AppState>,
    path: String,
    password: String,
    mode: ImportMode,
) -> AppResult<ImportResult> {
    services::profile::import(&state, path, password, mode).await
}
