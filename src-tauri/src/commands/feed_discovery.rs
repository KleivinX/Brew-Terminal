use tauri::State;

use crate::error::AppResult;
use crate::services::{self, feed_discovery::FeedCandidate};
use crate::state::AppState;

/// Finds the feeds a site publishes, from its address.
///
/// Reads the site's own `<link rel="alternate">` declarations — the published autodiscovery
/// convention — rather than asking a third-party feed-search service. An empty list means the
/// site does not advertise a feed, which is an answer rather than a failure.
#[tauri::command]
pub async fn discover_feeds(
    state: State<'_, AppState>,
    input: String,
) -> AppResult<Vec<FeedCandidate>> {
    services::feed_discovery::discover(&state, input).await
}
