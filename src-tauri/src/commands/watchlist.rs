use tauri::State;

use crate::error::AppResult;
use crate::models::{Watchlist, WatchlistItem};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn list_watchlists(state: State<'_, AppState>) -> AppResult<Vec<Watchlist>> {
    services::watchlist::list_watchlists(&state).await
}

#[tauri::command]
pub async fn get_watchlist_items(
    state: State<'_, AppState>,
    watchlist_id: String,
) -> AppResult<Vec<WatchlistItem>> {
    services::watchlist::get_watchlist_items(&state, watchlist_id).await
}

#[tauri::command]
pub async fn create_watchlist(state: State<'_, AppState>, name: String) -> AppResult<Watchlist> {
    services::watchlist::create_watchlist(&state, name).await
}

#[tauri::command]
pub async fn rename_watchlist(
    state: State<'_, AppState>,
    watchlist_id: String,
    name: String,
) -> AppResult<()> {
    services::watchlist::rename_watchlist(&state, watchlist_id, name).await
}

#[tauri::command]
pub async fn delete_watchlist(state: State<'_, AppState>, watchlist_id: String) -> AppResult<()> {
    services::watchlist::delete_watchlist(&state, watchlist_id).await
}

#[tauri::command]
pub async fn add_watchlist_item(
    state: State<'_, AppState>,
    watchlist_id: String,
    asset_id: String,
) -> AppResult<()> {
    services::watchlist::add_watchlist_item(&state, watchlist_id, asset_id).await
}

#[tauri::command]
pub async fn remove_watchlist_item(
    state: State<'_, AppState>,
    watchlist_id: String,
    asset_id: String,
) -> AppResult<()> {
    services::watchlist::remove_watchlist_item(&state, watchlist_id, asset_id).await
}

#[tauri::command]
pub async fn reorder_watchlist_items(
    state: State<'_, AppState>,
    watchlist_id: String,
    asset_ids: Vec<String>,
) -> AppResult<()> {
    services::watchlist::reorder_watchlist_items(&state, watchlist_id, asset_ids).await
}
