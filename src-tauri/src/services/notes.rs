use crate::db::repo_notes;
use crate::error::AppResult;
use crate::models::{now_epoch_secs, Note};
use crate::state::{with_db, AppState};

/// The most notes the workspace will load at once.
pub const MAX_NOTES: usize = 500;

/// Every note, for the notes workspace.
///
/// Distinct from `list_notes`, which is the per-asset view in the research panel. A note with
/// no asset attached is invisible to that query by construction, so without this one there is
/// no way to reach a general note after writing it.
pub async fn list_all_notes(state: &AppState) -> AppResult<Vec<Note>> {
    with_db(state.pool.clone(), move |conn| {
        repo_notes::list_all(conn, MAX_NOTES)
    })
    .await
}

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

/// Puts a deleted note back, for the Undo on the delete toast.
///
/// The whole note travels from the frontend rather than an id, because by the time Undo is
/// pressed the row is gone and there is nothing left to look up. That makes this the one write
/// path that trusts a client-supplied `created_at`; `repo_notes::restore` still validates the
/// text, and the worst a malformed call can do is create a note with an odd timestamp in a
/// local database the user already owns.
pub async fn restore_note(state: &AppState, note: Note) -> AppResult<Note> {
    with_db(state.pool.clone(), move |conn| {
        repo_notes::restore(conn, &note)
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
