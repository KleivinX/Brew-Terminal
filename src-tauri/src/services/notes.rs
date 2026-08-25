use crate::db::repo_notes;
use crate::error::AppResult;
use crate::models::{now_epoch_secs, Note};
use crate::state::{with_db, AppState};

pub async fn list_notes(state: &AppState, asset_id: String) -> AppResult<Vec<Note>> {
    with_db(state.pool.clone(), move |conn| {
        repo_notes::list_for_asset(conn, &asset_id)
    })
    .await
}

pub async fn upsert_note(
    state: &AppState,
    note_id: Option<String>,
    asset_id: Option<String>,
    title: String,
    body_md: String,
) -> AppResult<Note> {
    let now = now_epoch_secs();
    with_db(state.pool.clone(), move |conn| {
        repo_notes::upsert(conn, note_id, asset_id, &title, &body_md, now)
    })
    .await
}

pub async fn delete_note(state: &AppState, note_id: String) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_notes::delete(conn, &note_id)
    })
    .await
}

pub async fn search_notes(state: &AppState, query: String, limit: usize) -> AppResult<Vec<Note>> {
    let limit = limit.clamp(1, 100);
    with_db(state.pool.clone(), move |conn| {
        repo_notes::search(conn, &query, limit)
    })
    .await
}
