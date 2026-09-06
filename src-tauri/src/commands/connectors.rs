use tauri::State;

use crate::error::AppResult;
use crate::models::ConnectorCatalogue;
use crate::services;
use crate::state::AppState;

/// Every data source this project has wired, declined, or written down as a candidate.
///
/// Read-only. Switching a connector on is `set_provider_enabled` and adding a key is
/// `save_provider_credential` — the commands Settings already uses, so there is exactly one
/// write path for a credential.
#[tauri::command]
pub async fn list_connectors(state: State<'_, AppState>) -> AppResult<ConnectorCatalogue> {
    services::connectors::list(&state).await
}
