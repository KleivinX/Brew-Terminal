use tauri::State;

use crate::error::AppResult;
use crate::models::{PortfolioSummary, Transaction};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn get_portfolio(state: State<'_, AppState>) -> AppResult<PortfolioSummary> {
    services::portfolio::summary(&state).await
}

#[tauri::command]
pub async fn list_transactions(
    state: State<'_, AppState>,
    asset_id: Option<String>,
) -> AppResult<Vec<Transaction>> {
    services::portfolio::list_transactions(&state, asset_id).await
}

#[tauri::command]
pub async fn add_transaction(
    state: State<'_, AppState>,
    transaction: Transaction,
) -> AppResult<Transaction> {
    services::portfolio::add_transaction(&state, transaction).await
}

#[tauri::command]
pub async fn update_transaction(
    state: State<'_, AppState>,
    transaction: Transaction,
) -> AppResult<Transaction> {
    services::portfolio::update_transaction(&state, transaction).await
}

#[tauri::command]
pub async fn delete_transaction(state: State<'_, AppState>, id: String) -> AppResult<()> {
    services::portfolio::delete_transaction(&state, id).await
}
