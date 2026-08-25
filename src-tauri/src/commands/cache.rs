use tauri::State;

use crate::error::AppResult;
use crate::models::CacheStats;
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn get_cache_stats(state: State<'_, AppState>) -> AppResult<CacheStats> {
    services::cache::get_cache_stats(&state).await
}

#[tauri::command]
pub async fn clear_cache(state: State<'_, AppState>, kind: Option<String>) -> AppResult<()> {
    services::cache::clear_cache(&state, kind).await
}
