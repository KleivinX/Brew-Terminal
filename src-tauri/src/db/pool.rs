use std::path::{Path, PathBuf};

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;

use crate::error::AppResult;

pub type DbPool = Pool<SqliteConnectionManager>;
pub type DbConnection = r2d2::PooledConnection<SqliteConnectionManager>;

/// Four connections is plenty: the workload is small local queries, and WAL lets readers
/// proceed while a write is in flight. Blocking SQLite work runs on `spawn_blocking` so the
/// async runtime is never stalled.
const POOL_SIZE: u32 = 4;

fn configure(conn: &Connection) -> rusqlite::Result<()> {
    // WAL: readers do not block the writer, which matters when a refresh writes cache rows
    // while the UI is reading watchlists.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // NORMAL is the right trade for a local research tool: a crash can lose the last
    // transaction, and no financial record depends on it.
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(())
}

pub fn create(db_path: &Path) -> AppResult<DbPool> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| crate::error::AppError::Storage(e.to_string()))?;
    }

    let manager = SqliteConnectionManager::file(db_path).with_init(|conn| configure(conn));

    let pool = Pool::builder()
        .max_size(POOL_SIZE)
        .build(manager)
        .map_err(|e| crate::error::AppError::Storage(e.to_string()))?;

    restrict_permissions(db_path);

    Ok(pool)
}

/// In-memory pool for tests. `max_size(1)` because each `:memory:` connection would otherwise
/// get its own empty database.
#[cfg(test)]
pub fn create_in_memory() -> AppResult<DbPool> {
    let manager = SqliteConnectionManager::memory().with_init(|conn| configure(conn));
    Pool::builder()
        .max_size(1)
        .build(manager)
        .map_err(|e| crate::error::AppError::Storage(e.to_string()))
}

/// Owner-only permissions. Not a security boundary against a user-level attacker — see
/// THREAT_MODEL.md §5 — but it keeps the file out of reach of other accounts on shared machines.
#[cfg(unix)]
fn restrict_permissions(db_path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    if let Ok(metadata) = std::fs::metadata(db_path) {
        let mut perms = metadata.permissions();
        perms.set_mode(0o600);
        let _ = std::fs::set_permissions(db_path, perms);
    }
}

#[cfg(not(unix))]
fn restrict_permissions(_db_path: &Path) {
    // Windows inherits the user profile's ACL, which is already user-scoped.
}

pub fn default_db_path(data_dir: &Path) -> PathBuf {
    data_dir.join("brew.db")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_memory_pool_applies_pragmas() {
        let pool = create_in_memory().unwrap();
        let conn = pool.get().unwrap();

        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(foreign_keys, 1, "foreign keys must be enforced");
    }

    #[test]
    fn file_pool_creates_parent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("deeper").join("brew.db");

        let pool = create(&path).unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch("CREATE TABLE t (a INTEGER);").unwrap();

        assert!(path.exists());
    }
}
