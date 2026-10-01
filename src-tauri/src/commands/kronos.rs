use tauri::State;

use crate::error::AppResult;
use crate::models::Envelope;
use crate::services::kronos::{self, KronosProjection, KronosStatus};
use crate::state::AppState;

/// Whether the Kronos weights are on disk, and who published them.
#[tauri::command]
pub async fn get_kronos_status(state: State<'_, AppState>) -> AppResult<KronosStatus> {
    Ok(kronos::status(&state))
}

/// Downloads the pinned weights. Progress and cancellation go through the same
/// `get_download_progress` and `cancel_download` the chat models use.
#[tauri::command]
pub async fn download_kronos(state: State<'_, AppState>) -> AppResult<KronosStatus> {
    kronos::download(&state).await
}

#[tauri::command]
pub async fn delete_kronos(state: State<'_, AppState>) -> AppResult<KronosStatus> {
    kronos::remove(&state)
}

/// Runs the model on an asset's recent candles. Refused until the user has acknowledged what
/// the model is — see `services::kronos::project`.
#[tauri::command]
pub async fn run_kronos_projection(
    state: State<'_, AppState>,
    asset_id: String,
) -> AppResult<Envelope<Option<KronosProjection>>> {
    kronos::project(&state, asset_id).await
}
