use tauri::State;

use crate::error::AppResult;
use crate::services::{self, atlas::AtlasSnapshot};
use crate::state::AppState;

/// One tick of the Atlas ticker.
///
/// Returns the quotes it could refresh within the current provider allowance, whatever the
/// cache holds for the rest, and the route that served them — including which provider is
/// active and whether anything is behind it. The route is not decoration: a ticker that cannot
/// say which free tier is answering, and how much of its allowance is left, is asking the user
/// to trust a number with no account of where it came from.
#[tauri::command]
pub async fn atlas_snapshot(
    state: State<'_, AppState>,
    asset_ids: Vec<String>,
) -> AppResult<AtlasSnapshot> {
    services::atlas::snapshot(&state, asset_ids).await
}
