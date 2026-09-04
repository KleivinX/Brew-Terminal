use crate::db::repo_saved_views;
use crate::error::AppResult;
use crate::models::{now_epoch_secs, SavedView, SavedViewKind};
use crate::state::{with_db, AppState};

pub async fn list(state: &AppState, kind: SavedViewKind) -> AppResult<Vec<SavedView>> {
    with_db(state.pool.clone(), move |conn| {
        repo_saved_views::list(conn, kind)
    })
    .await
}

pub async fn save(
    state: &AppState,
    kind: SavedViewKind,
    name: String,
    payload: String,
) -> AppResult<SavedView> {
    let now = now_epoch_secs();
    with_db(state.pool.clone(), move |conn| {
        repo_saved_views::save(conn, kind, &name, &payload, now)
    })
    .await
}

pub async fn delete(state: &AppState, id: String) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_saved_views::delete(conn, &id)
    })
    .await
}
