use tauri::State;

use crate::error::AppResult;
use crate::models::{AppInfo, Preferences, ProviderInfo};
use crate::providers::mock::MockBehavior;
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn get_preferences(state: State<'_, AppState>) -> AppResult<Preferences> {
    services::settings::get_preferences(&state).await
}

#[tauri::command]
pub async fn set_preference(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> AppResult<()> {
    services::settings::set_preference(&state, key, value).await
}

#[tauri::command]
pub async fn list_providers(state: State<'_, AppState>) -> AppResult<Vec<ProviderInfo>> {
    services::settings::list_providers(&state).await
}

#[tauri::command]
pub async fn get_app_info(state: State<'_, AppState>) -> AppResult<AppInfo> {
    services::settings::get_app_info(&state).await
}

/// Dev-only. Forces the mock provider into a failure mode so every UI state is reachable
/// without a network. The frontend only exposes this behind `isDev()`.
#[tauri::command]
pub async fn set_mock_behavior(
    state: State<'_, AppState>,
    behavior: MockBehavior,
) -> AppResult<()> {
    services::settings::set_mock_behavior(&state, behavior).await
}

#[tauri::command]
pub async fn set_provider_enabled(
    state: State<'_, AppState>,
    provider_id: String,
    enabled: bool,
) -> AppResult<()> {
    services::settings::set_provider_enabled(&state, provider_id, enabled).await
}

/// Returns only a masked hint. The key itself is never sent back.
#[tauri::command]
pub async fn save_provider_credential(
    state: State<'_, AppState>,
    provider_id: String,
    api_key: String,
) -> AppResult<String> {
    services::settings::save_provider_credential(&state, provider_id, api_key).await
}

#[tauri::command]
pub async fn delete_provider_credential(
    state: State<'_, AppState>,
    provider_id: String,
) -> AppResult<()> {
    services::settings::delete_provider_credential(&state, provider_id).await
}

#[tauri::command]
pub async fn test_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> AppResult<services::settings::ProviderTestResult> {
    services::settings::test_provider(&state, provider_id).await
}
