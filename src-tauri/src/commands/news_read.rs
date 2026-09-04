use tauri::State;

use crate::error::AppResult;
use crate::services;
use crate::state::AppState;

/// Every headline URL marked read, newest first.
///
/// Returned whole rather than filtered against the articles on screen: the table is bounded,
/// the frontend already holds the articles, and one cached call it can intersect beats pushing
/// a list of URLs up and back on every panel refresh.
#[tauri::command]
pub async fn list_read_news(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    services::news_read::list_read(&state).await
}

#[tauri::command]
pub async fn mark_news_read(state: State<'_, AppState>, urls: Vec<String>) -> AppResult<usize> {
    services::news_read::mark_read(&state, urls).await
}

#[tauri::command]
pub async fn mark_news_unread(state: State<'_, AppState>, url: String) -> AppResult<()> {
    services::news_read::mark_unread(&state, url).await
}

#[tauri::command]
pub async fn clear_news_read(state: State<'_, AppState>) -> AppResult<()> {
    services::news_read::clear(&state).await
}
