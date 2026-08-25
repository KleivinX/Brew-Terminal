use tauri::State;

use crate::error::AppResult;
use crate::models::{CommunityFilter, CommunityPost, Envelope};
use crate::services;
use crate::state::AppState;

/// Returns community posts, or `not_configured` when the opt-in preference is off or no
/// provider is enabled. Both gates live in the service, not here.
#[tauri::command]
pub async fn get_community_posts(
    state: State<'_, AppState>,
    filter: CommunityFilter,
) -> AppResult<Envelope<Vec<CommunityPost>>> {
    services::community::get_posts(&state, filter).await
}
