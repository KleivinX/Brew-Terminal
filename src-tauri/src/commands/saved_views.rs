use tauri::State;

use crate::error::AppResult;
use crate::models::{SavedView, SavedViewKind};
use crate::services;
use crate::state::AppState;

/// The saved views for one screen, most recently updated first.
#[tauri::command]
pub async fn list_saved_views(
    state: State<'_, AppState>,
    kind: SavedViewKind,
) -> AppResult<Vec<SavedView>> {
    services::saved_views::list(&state, kind).await
}

/// Saves a view, replacing one of the same name on the same screen.
#[tauri::command]
pub async fn save_view(
    state: State<'_, AppState>,
    kind: SavedViewKind,
    name: String,
    payload: String,
) -> AppResult<SavedView> {
    services::saved_views::save(&state, kind, name, payload).await
}

#[tauri::command]
pub async fn delete_saved_view(state: State<'_, AppState>, id: String) -> AppResult<()> {
    services::saved_views::delete(&state, id).await
}
