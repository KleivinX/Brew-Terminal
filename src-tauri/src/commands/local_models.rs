use tauri::State;

use crate::error::AppResult;
use crate::services;
use crate::services::local_models::{DownloadProgress, LocalModelOverview};
use crate::state::AppState;

#[tauri::command]
pub async fn get_local_models(state: State<'_, AppState>) -> AppResult<LocalModelOverview> {
    Ok(services::local_models::overview(&state))
}

/// Downloads and unpacks the inference engine for this platform.
#[tauri::command]
pub async fn install_engine(state: State<'_, AppState>) -> AppResult<LocalModelOverview> {
    services::local_models::install_engine(&state).await
}

#[tauri::command]
pub async fn download_model(
    state: State<'_, AppState>,
    model_id: String,
) -> AppResult<LocalModelOverview> {
    services::local_models::download_model(&state, model_id).await
}

/// Polled by the UI while something is downloading. Returns `None` when nothing is.
#[tauri::command]
pub async fn get_download_progress(
    state: State<'_, AppState>,
) -> AppResult<Option<DownloadProgress>> {
    Ok(services::local_models::progress(&state))
}

#[tauri::command]
pub async fn cancel_download(state: State<'_, AppState>) -> AppResult<()> {
    services::local_models::cancel_download(&state);
    Ok(())
}

#[tauri::command]
pub async fn delete_local_model(
    state: State<'_, AppState>,
    model_id: String,
) -> AppResult<LocalModelOverview> {
    services::local_models::delete_model(&state, model_id)
}

#[tauri::command]
pub async fn start_local_model(
    state: State<'_, AppState>,
    model_id: String,
) -> AppResult<LocalModelOverview> {
    services::local_models::start(&state, model_id).await
}

#[tauri::command]
pub async fn stop_local_model(state: State<'_, AppState>) -> AppResult<LocalModelOverview> {
    Ok(services::local_models::stop(&state))
}
