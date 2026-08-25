use tauri::State;

use crate::error::AppResult;
use crate::models::{
    Asset, AssetSearchResult, AssetType, ChartPoint, ChartRange, Envelope, NewsArticle, NewsFilter,
    Quote,
};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn search_assets(
    state: State<'_, AppState>,
    query: String,
    limit: usize,
) -> AppResult<Envelope<Vec<AssetSearchResult>>> {
    services::market::search_assets(&state, query, limit).await
}

#[tauri::command]
pub async fn get_quotes(
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
) -> AppResult<Envelope<Vec<Quote>>> {
    services::market::get_quotes(&state, asset_ids).await
}

#[tauri::command]
pub async fn get_market_list(
    state: State<'_, AppState>,
    asset_type: AssetType,
    region: String,
    limit: usize,
) -> AppResult<Envelope<Vec<Quote>>> {
    services::market::get_market_list(&state, asset_type, region, limit).await
}

#[tauri::command]
pub async fn get_asset(state: State<'_, AppState>, asset_id: String) -> AppResult<Option<Asset>> {
    services::market::get_asset(&state, asset_id).await
}

#[tauri::command]
pub async fn get_chart(
    state: State<'_, AppState>,
    asset_id: String,
    range: ChartRange,
) -> AppResult<Envelope<Vec<ChartPoint>>> {
    services::market::get_chart(&state, asset_id, range).await
}

#[tauri::command]
pub async fn get_news(
    state: State<'_, AppState>,
    filter: NewsFilter,
) -> AppResult<Envelope<Vec<NewsArticle>>> {
    services::market::get_news(&state, filter).await
}
