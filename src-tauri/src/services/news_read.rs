use crate::db::repo_news_read;
use crate::error::AppResult;
use crate::models::now_epoch_secs;
use crate::state::{with_db, AppState};

pub async fn list_read(state: &AppState) -> AppResult<Vec<String>> {
    with_db(state.pool.clone(), |conn| repo_news_read::list_read(conn)).await
}

pub async fn mark_read(state: &AppState, urls: Vec<String>) -> AppResult<usize> {
    let now = now_epoch_secs();
    with_db(state.pool.clone(), move |conn| {
        repo_news_read::mark_read(conn, &urls, now)
    })
    .await
}

pub async fn mark_unread(state: &AppState, url: String) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_news_read::mark_unread(conn, &url)
    })
    .await
}

pub async fn clear(state: &AppState) -> AppResult<()> {
    with_db(state.pool.clone(), |conn| repo_news_read::clear(conn)).await
}
