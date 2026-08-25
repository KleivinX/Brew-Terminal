use crate::db::repo_cache;
use crate::error::AppResult;
use crate::models::{now_epoch_secs, CacheStats};
use crate::state::{with_db, AppState};

pub async fn get_cache_stats(state: &AppState) -> AppResult<CacheStats> {
    with_db(state.pool.clone(), |conn| repo_cache::stats(conn)).await
}

pub async fn clear_cache(state: &AppState, kind: Option<String>) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_cache::clear(conn, kind.as_deref())?;
        Ok(())
    })
    .await
}

/// Startup housekeeping: drop entries far past their TTL.
///
/// The multiplier keeps recently-expired rows alive so the stale-while-revalidate path still
/// has something to show when a provider is unreachable on launch.
pub async fn evict_expired_on_startup(pool: crate::db::DbPool) {
    let now = now_epoch_secs();
    let result = with_db(pool, move |conn| repo_cache::evict_expired(conn, now, 10)).await;

    match result {
        Ok(removed) if removed > 0 => tracing::info!(removed, "evicted expired cache entries"),
        Ok(_) => {}
        Err(error) => tracing::warn!(?error, "cache eviction failed"),
    }
}
