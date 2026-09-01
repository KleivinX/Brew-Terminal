use tauri::State;

use crate::error::AppResult;
use crate::models::{Envelope, Quote, ScreenerFilter};
use crate::services;
use crate::state::AppState;

/// Runs a screen. Filtering happens over the cached market list, so adjusting a filter costs
/// no provider request.
#[tauri::command]
pub async fn run_screen(
    state: State<'_, AppState>,
    filter: ScreenerFilter,
) -> AppResult<Envelope<Vec<Quote>>> {
    services::screener::run(&state, filter).await
}
