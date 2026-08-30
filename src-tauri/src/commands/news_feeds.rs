use tauri::State;

use crate::error::AppResult;
use crate::models::{NewsCategory, NewsFeed};
use crate::services;
use crate::services::news_feeds::FeedPreview;
use crate::state::AppState;

#[tauri::command]
pub async fn list_news_feeds(state: State<'_, AppState>) -> AppResult<Vec<NewsFeed>> {
    services::news_feeds::list(&state).await
}

#[tauri::command]
pub async fn preview_news_feed(state: State<'_, AppState>, url: String) -> AppResult<FeedPreview> {
    services::news_feeds::preview(&state, url).await
}

#[tauri::command]
pub async fn add_news_feed(
    state: State<'_, AppState>,
    url: String,
    title: String,
    category: NewsCategory,
) -> AppResult<NewsFeed> {
    services::news_feeds::add(&state, url, title, category).await
}

#[tauri::command]
pub async fn remove_news_feed(state: State<'_, AppState>, feed_id: String) -> AppResult<()> {
    services::news_feeds::remove(&state, feed_id).await
}

#[tauri::command]
pub async fn set_news_feed_enabled(
    state: State<'_, AppState>,
    feed_id: String,
    enabled: bool,
) -> AppResult<()> {
    services::news_feeds::set_enabled(&state, feed_id, enabled).await
}

#[tauri::command]
pub async fn restore_default_news_feeds(state: State<'_, AppState>) -> AppResult<Vec<NewsFeed>> {
    services::news_feeds::restore_defaults(&state).await
}
