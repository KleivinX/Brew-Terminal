use tauri::State;

use crate::error::AppResult;
use crate::models::SentrySnapshot;
use crate::services;
use crate::state::AppState;

/// One refresh of the Sentry board.
///
/// Returns every layer's status alongside its data, so the sidebar can say which sources
/// answered, how old each one is, and why any of them did not — rather than presenting a map
/// whose gaps are indistinguishable from quiet.
#[tauri::command]
pub async fn sentry_snapshot(state: State<'_, AppState>) -> AppResult<SentrySnapshot> {
    services::sentry::snapshot(&state).await
}

/// Attribution for every source that can appear on the board.
///
/// A command rather than a constant in the frontend, so the list cannot drift out of step with
/// the registry: adding a source without attributing it would take deleting a line here.
#[tauri::command]
pub fn sentry_attributions() -> Vec<String> {
    services::sentry::attributions()
}
