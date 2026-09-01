use tauri::State;

use crate::error::AppResult;
use crate::models::Alert;
use crate::services;
use crate::services::alerts::TriggeredAlert;
use crate::state::AppState;

#[tauri::command]
pub async fn list_alerts(state: State<'_, AppState>) -> AppResult<Vec<Alert>> {
    services::alerts::list(&state).await
}

#[tauri::command]
pub async fn create_alert(state: State<'_, AppState>, alert: Alert) -> AppResult<Alert> {
    services::alerts::create(&state, alert).await
}

#[tauri::command]
pub async fn delete_alert(state: State<'_, AppState>, id: String) -> AppResult<()> {
    services::alerts::delete(&state, id).await
}

#[tauri::command]
pub async fn set_alert_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> AppResult<()> {
    services::alerts::set_enabled(&state, id, enabled).await
}

/// Puts a fired alert back on watch.
#[tauri::command]
pub async fn rearm_alert(state: State<'_, AppState>, id: String) -> AppResult<()> {
    services::alerts::rearm(&state, id).await
}

/// Runs an alert check now, rather than waiting for the next background tick.
#[tauri::command]
pub async fn check_alerts(state: State<'_, AppState>) -> AppResult<Vec<TriggeredAlert>> {
    services::alerts::check_once(&state).await
}
