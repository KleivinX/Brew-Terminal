use std::path::Path;

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

/// Migrations are embedded, not read from disk: a bundled app has no reliable relative path to
/// a migrations directory, and `include_str!` makes a missing file a compile error rather than
/// a runtime one.
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../../migrations/0001_init.sql")),
    (
        2,
        include_str!("../../migrations/0002_ai_prompt_version.sql"),
    ),
    (3, include_str!("../../migrations/0003_news_feeds.sql")),
    (4, include_str!("../../migrations/0004_portfolio.sql")),
    (5, include_str!("../../migrations/0005_alerts.sql")),
];

pub fn latest_version() -> i64 {
    MIGRATIONS.last().map(|(v, _)| *v).unwrap_or(0)
}

pub fn current_version(conn: &Connection) -> AppResult<i64> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    Ok(version)
}

/// Applies every migration newer than the file's `user_version`, each inside its own
/// transaction. Forward-only: there are no down migrations, because a partially-applied
/// rollback on a user's only copy of their data is worse than the problem it solves.
pub fn run(conn: &mut Connection, db_path: Option<&Path>) -> AppResult<i64> {
    let from = current_version(conn)?;
    let target = latest_version();

    if from > target {
        // The user has run a newer build and then downgraded. Writing with an older schema
        // could silently drop columns the newer version relies on, so refuse instead.
        return Err(AppError::Storage(format!(
            "database schema version {from} is newer than this build supports ({target}). \
             Update Brew Terminal, or move the database file aside to start fresh."
        )));
    }

    if from == target {
        return Ok(from);
    }

    // One backup per migration run, taken before anything is written.
    if let Some(path) = db_path {
        if path.exists() {
            let backup = path.with_extension(format!("pre-{from}.bak"));
            if let Err(error) = std::fs::copy(path, &backup) {
                tracing::warn!(?error, "could not write pre-migration backup");
            } else {
                prune_backups(path);
            }
        }
    }

    for (version, sql) in MIGRATIONS {
        if *version <= from {
            continue;
        }

        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        // execute_batch cannot bind parameters, and user_version does not accept them either.
        // `version` is a compile-time constant from MIGRATIONS, so this is not user input.
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;

        tracing::info!(version, "applied migration");
    }

    Ok(target)
}

/// Keeps the two most recent backups. Unbounded backups of a growing database would quietly
/// consume disk on a machine that may not have much.
fn prune_backups(db_path: &Path) {
    let Some(dir) = db_path.parent() else { return };
    let Some(stem) = db_path.file_stem().and_then(|s| s.to_str()) else {
        return;
    };

    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    let mut backups: Vec<_> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(stem) && name.ends_with(".bak"))
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect();

    // Newest first, so `skip(2)` leaves the two most recent backups in place.
    backups.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));

    for (_, path) in backups.into_iter().skip(2) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn
    }

    #[test]
    fn applies_migrations_from_scratch() {
        let mut conn = memory_db();
        assert_eq!(current_version(&conn).unwrap(), 0);

        let version = run(&mut conn, None).unwrap();
        assert_eq!(version, latest_version());
        assert_eq!(current_version(&conn).unwrap(), latest_version());
    }

    #[test]
    fn is_idempotent() {
        let mut conn = memory_db();
        run(&mut conn, None).unwrap();
        // Running again must be a no-op, not an error and not a duplicate-table failure.
        let version = run(&mut conn, None).unwrap();
        assert_eq!(version, latest_version());
    }

    #[test]
    fn refuses_to_open_a_newer_schema() {
        let mut conn = memory_db();
        conn.pragma_update(None, "user_version", 999_i64).unwrap();

        let result = run(&mut conn, None);
        assert!(
            result.is_err(),
            "a downgraded app must not write to a newer database"
        );
    }

    #[test]
    fn creates_every_expected_table() {
        let mut conn = memory_db();
        run(&mut conn, None).unwrap();

        let expected = [
            "assets",
            "asset_provider_refs",
            "watchlists",
            "watchlist_items",
            "preferences",
            "provider_config",
            "cache_entries",
            "rate_limit_state",
            "news_articles",
            "news_asset_links",
            "community_posts",
            "notes",
            "notes_fts",
            "learning_progress",
            "bookmarks",
            "ai_conversations",
            "ai_messages",
            "ai_outbound_log",
        ];

        for table in expected {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "missing table: {table}");
        }
    }

    /// The schema must not grow a place to record holdings — that is an explicit non-goal,
    /// and this test is what stops it arriving by accident.
    #[test]
    fn no_credential_material_is_ever_stored_in_the_database() {
        // THREAT_MODEL.md §4: API keys live in the OS keychain and nowhere else. Asserted over
        // column names rather than the raw SQL, because the raw SQL contains the word
        // "credential" in `provider_config.has_credential` — which is a boolean recording
        // *whether* a key exists, and is exactly the design this test protects rather than a
        // violation of it. Matching on prose would have failed on a comment.
        let mut conn = memory_db();
        run(&mut conn, None).unwrap();

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|t| t.unwrap())
            .collect();

        // Flags that record presence are fine; anything that could hold the value is not.
        const PRESENCE_FLAGS: &[&str] = &["has_credential"];

        for table in tables {
            let columns: Vec<String> = conn
                .prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
                .unwrap()
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .map(|c| c.unwrap().to_lowercase())
                .collect();

            for column in columns {
                if PRESENCE_FLAGS.contains(&column.as_str()) {
                    continue;
                }
                for banned in [
                    "api_key",
                    "apikey",
                    "secret",
                    "password",
                    "token",
                    "credential",
                ] {
                    assert!(
                        !column.contains(banned),
                        "{table}.{column} looks like it could hold credential material"
                    );
                }
            }
        }
    }

    /// The other half of that test asserted the schema had no `quantity` or `holdings`, because
    /// portfolio tracking was an explicit non-goal in v0.1. That non-goal was reversed
    /// deliberately in v0.2 — `portfolio_transactions` exists and is the point of the feature —
    /// so the assertion is replaced rather than deleted, to record that the change was a
    /// decision and not an oversight.
    #[test]
    fn the_portfolio_table_holds_trades_and_nothing_personal() {
        let mut conn = memory_db();
        run(&mut conn, None).unwrap();

        let columns: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('portfolio_transactions')")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|c| c.unwrap())
            .collect();

        // Exactly the trade, and nothing identifying its owner: no account number, no broker
        // login, no exchange key.
        let mut expected = vec![
            "id",
            "asset_id",
            "symbol",
            "kind",
            "quantity",
            "unit_price",
            "fee",
            "currency",
            "executed_at",
            "note",
            "created_at",
        ];
        let mut actual: Vec<&str> = columns.iter().map(String::as_str).collect();
        expected.sort_unstable();
        actual.sort_unstable();
        assert_eq!(actual, expected);
    }
}
