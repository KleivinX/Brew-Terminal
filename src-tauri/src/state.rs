use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::db::{DbConnection, DbPool};
use crate::error::{AppError, AppResult};
use crate::providers::registry::ProviderRegistry;

pub struct AppState {
    pub pool: DbPool,
    pub registry: Arc<ProviderRegistry>,
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    /// The locally downloaded model server, if one has been started. Killed when the app
    /// exits — see `EngineProcess::drop`.
    pub engine: Arc<crate::localai::engine::EngineProcess>,
    /// The download in flight, if any. One at a time on purpose: two concurrent gigabyte
    /// downloads on a domestic connection make both of them slow and neither of them clear.
    pub downloads: Mutex<Option<(String, Arc<crate::localai::download::DownloadHandle>)>>,
    /// Atlas's per-provider rate-limit accounting.
    ///
    /// Lives here rather than in a global because it is process state with a lifetime — two
    /// tests that each bootstrap a state must not inherit each other's exhausted budgets, and a
    /// static would give them exactly that.
    pub atlas: Mutex<crate::services::atlas::AtlasUsage>,
}

impl AppState {
    pub fn new(pool: DbPool, data_dir: PathBuf, db_path: PathBuf) -> AppResult<Self> {
        Ok(Self {
            registry: Arc::new(ProviderRegistry::new(pool.clone())?),
            pool,
            data_dir,
            db_path,
            engine: Arc::new(crate::localai::engine::EngineProcess::default()),
            downloads: Mutex::new(None),
            atlas: Mutex::new(Default::default()),
        })
    }

    /// Opens the database, migrates it, and prepares first-run state.
    ///
    /// The app's `setup` hook and the integration tests both go through here, so a test that
    /// says "this survives a restart" is exercising the same startup path the user gets —
    /// not a parallel one that happens to agree today.
    pub fn bootstrap(data_dir: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&data_dir).map_err(|e| AppError::Storage(e.to_string()))?;
        let db_path = crate::db::pool::default_db_path(&data_dir);

        let pool = crate::db::pool::create(&db_path)?;
        {
            let mut conn = pool.get()?;
            let version = crate::db::migrations::run(&mut conn, Some(&db_path))?;
            tracing::info!(version, "schema ready");

            // Every user starts with somewhere to put their first asset. An app whose
            // "add to watchlist" has no list to add to is a dead end on first run.
            crate::db::repo_watchlists::ensure_default(&conn, crate::models::now_epoch_secs())?;

            // Seeds any provider the user has not seen yet. Existing rows are left alone, so
            // a provider the user turned off stays off.
            crate::db::repo_providers::upsert_defaults(
                &conn,
                &crate::providers::registry::default_provider_config(),
            )?;

            // Same contract as the provider defaults: seeded once, and a feed the user
            // removed is never brought back. See `repo_news_feeds::seed_defaults`.
            crate::db::repo_news_feeds::seed_defaults(
                &conn,
                crate::providers::live::rss::DEFAULT_FEEDS,
            )?;
        }

        Self::new(pool, data_dir, db_path)
    }
}

/// Runs blocking SQLite work off the async runtime.
///
/// rusqlite is synchronous. Calling it directly from an async command would stall a runtime
/// worker for the duration of the query — on a dual-core machine that is a visible stall, not
/// a theoretical one. See ARCHITECTURE.md §8.
pub async fn with_db<T, F>(pool: DbPool, work: F) -> AppResult<T>
where
    F: FnOnce(&mut DbConnection) -> AppResult<T> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let mut conn = pool.get()?;
        work(&mut conn)
    })
    .await
    .map_err(|error| AppError::Storage(format!("database task failed: {error}")))?
}
