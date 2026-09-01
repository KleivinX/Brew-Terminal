use tauri::State;

use crate::error::AppResult;
use crate::models::{ChartPoint, ChartRange, Envelope};
use crate::providers::live::fred::MacroSeries;
use crate::services;
use crate::services::macro_data::MultiSeries;
use crate::state::AppState;

/// The macro series on offer. No request is made — this is the shipped list.
#[tauri::command]
pub async fn list_macro_series(_state: State<'_, AppState>) -> AppResult<Vec<MacroSeries>> {
    Ok(services::macro_data::catalogue().to_vec())
}

#[tauri::command]
pub async fn get_macro_series(
    state: State<'_, AppState>,
    id: String,
    range: ChartRange,
) -> AppResult<Envelope<Vec<ChartPoint>>> {
    services::macro_data::series(&state, id, range).await
}

/// Chart history for several assets at once, for comparison and correlation.
#[tauri::command]
pub async fn get_multi_series(
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
    range: ChartRange,
) -> AppResult<MultiSeries> {
    services::macro_data::multi_series(&state, asset_ids, range).await
}
