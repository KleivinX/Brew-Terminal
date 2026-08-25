use crate::db::repo_progress;
use crate::error::AppResult;
use crate::models::{now_epoch_secs, LearningProgress, ProgressStatus};
use crate::state::{with_db, AppState};

pub async fn list_progress(state: &AppState) -> AppResult<Vec<LearningProgress>> {
    with_db(state.pool.clone(), |conn| repo_progress::list(conn)).await
}

pub async fn set_progress(
    state: &AppState,
    item_id: String,
    path_id: String,
    status: ProgressStatus,
) -> AppResult<()> {
    let now = now_epoch_secs();
    with_db(state.pool.clone(), move |conn| {
        repo_progress::set(conn, &item_id, &path_id, status, now)
    })
    .await
}

pub async fn reset_progress(state: &AppState, path_id: Option<String>) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        match path_id {
            Some(id) => repo_progress::reset_path(conn, &id)?,
            None => repo_progress::reset_all(conn)?,
        };
        Ok(())
    })
    .await
}
