use crate::db::{repo_assets, repo_watchlists};
use crate::error::AppResult;
use crate::models::{now_epoch_secs, Watchlist, WatchlistItem};
use crate::state::{with_db, AppState};

pub async fn list_watchlists(state: &AppState) -> AppResult<Vec<Watchlist>> {
    with_db(state.pool.clone(), |conn| repo_watchlists::list(conn)).await
}

pub async fn get_watchlist_items(
    state: &AppState,
    watchlist_id: String,
) -> AppResult<Vec<WatchlistItem>> {
    with_db(state.pool.clone(), move |conn| {
        repo_watchlists::items(conn, &watchlist_id)
    })
    .await
}

pub async fn create_watchlist(state: &AppState, name: String) -> AppResult<Watchlist> {
    let now = now_epoch_secs();
    with_db(state.pool.clone(), move |conn| {
        repo_watchlists::create(conn, &name, now)
    })
    .await
}

pub async fn rename_watchlist(
    state: &AppState,
    watchlist_id: String,
    name: String,
) -> AppResult<()> {
    let now = now_epoch_secs();
    with_db(state.pool.clone(), move |conn| {
        repo_watchlists::rename(conn, &watchlist_id, &name, now)
    })
    .await
}

pub async fn delete_watchlist(state: &AppState, watchlist_id: String) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_watchlists::delete(conn, &watchlist_id)
    })
    .await
}

/// Adding an asset also persists the asset itself.
///
/// `watchlist_items.asset_id` has a foreign key onto `assets`, so an asset the user has only
/// ever seen in a provider response has to exist locally before it can be watched. This is
/// also what makes watchlists survive a provider being removed later.
pub async fn add_watchlist_item(
    state: &AppState,
    watchlist_id: String,
    asset_id: String,
) -> AppResult<()> {
    // Resolve through the market service: it checks the local store first, so adding an
    // asset the user already has costs no provider budget, and it routes to whichever
    // provider owns this id.
    let asset = super::market::get_asset(state, asset_id.clone()).await?;
    let now = now_epoch_secs();

    with_db(state.pool.clone(), move |conn| {
        let tx = conn.transaction()?;
        if let Some(asset) = asset {
            repo_assets::upsert(&tx, &asset, now)?;
        }
        repo_watchlists::add_item(&tx, &watchlist_id, &asset_id, now)?;
        tx.commit()?;
        Ok(())
    })
    .await
}

pub async fn remove_watchlist_item(
    state: &AppState,
    watchlist_id: String,
    asset_id: String,
) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_watchlists::remove_item(conn, &watchlist_id, &asset_id)
    })
    .await
}

pub async fn reorder_watchlist_items(
    state: &AppState,
    watchlist_id: String,
    asset_ids: Vec<String>,
) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_watchlists::reorder(conn, &watchlist_id, &asset_ids)
    })
    .await
}
