use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{validate_watchlist_name, Watchlist, WatchlistItem};

pub const DEFAULT_WATCHLIST_ID: &str = "wl-default";

/// Called once on first run. Every user starts with somewhere to put their first asset —
/// an empty app with no watchlist to add to is a dead end.
pub fn ensure_default(conn: &Connection, now: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO watchlists (id, name, position, is_default, created_at, updated_at)
         VALUES (?1, 'My watchlist', 0, 1, ?2, ?2)
         ON CONFLICT(id) DO NOTHING",
        params![DEFAULT_WATCHLIST_ID, now],
    )?;
    Ok(())
}

pub fn list(conn: &Connection) -> AppResult<Vec<Watchlist>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, position, is_default FROM watchlists ORDER BY position, created_at",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Watchlist {
            id: row.get(0)?,
            name: row.get(1)?,
            position: row.get(2)?,
            is_default: row.get::<_, i64>(3)? != 0,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn create(conn: &Connection, name: &str, now: i64) -> AppResult<Watchlist> {
    let name = validate_watchlist_name(name).map_err(|detail| AppError::Validation {
        field: "name".into(),
        detail,
    })?;

    let id = format!("wl-{}", uuid::Uuid::new_v4());
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM watchlists",
        [],
        |row| row.get(0),
    )?;

    conn.execute(
        "INSERT INTO watchlists (id, name, position, is_default, created_at, updated_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?4)",
        params![id, name, position, now],
    )?;

    Ok(Watchlist {
        id,
        name,
        position,
        is_default: false,
    })
}

pub fn rename(conn: &Connection, watchlist_id: &str, name: &str, now: i64) -> AppResult<()> {
    let name = validate_watchlist_name(name).map_err(|detail| AppError::Validation {
        field: "name".into(),
        detail,
    })?;

    let changed = conn.execute(
        "UPDATE watchlists SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![watchlist_id, name, now],
    )?;

    if changed == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn delete(conn: &Connection, watchlist_id: &str) -> AppResult<()> {
    // The default list is the app's guaranteed landing place for a first asset; removing it
    // would leave "add to watchlist" with nowhere to go.
    if watchlist_id == DEFAULT_WATCHLIST_ID {
        return Err(AppError::Validation {
            field: "watchlistId".into(),
            detail: "the default watchlist cannot be deleted".into(),
        });
    }

    let changed = conn.execute("DELETE FROM watchlists WHERE id = ?1", [watchlist_id])?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn items(conn: &Connection, watchlist_id: &str) -> AppResult<Vec<WatchlistItem>> {
    let mut stmt = conn.prepare(
        "SELECT watchlist_id, asset_id, position, added_at
         FROM watchlist_items WHERE watchlist_id = ?1 ORDER BY position",
    )?;
    let rows = stmt.query_map([watchlist_id], |row| {
        Ok(WatchlistItem {
            watchlist_id: row.get(0)?,
            asset_id: row.get(1)?,
            position: row.get(2)?,
            added_at: row.get(3)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Adding an asset already in the list is a no-op rather than an error — the caller is a
/// toggle, and double-clicking a star should not produce a failure dialog.
pub fn add_item(conn: &Connection, watchlist_id: &str, asset_id: &str, now: i64) -> AppResult<()> {
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position) + 1, 0) FROM watchlist_items WHERE watchlist_id = ?1",
        [watchlist_id],
        |row| row.get(0),
    )?;

    conn.execute(
        "INSERT INTO watchlist_items (watchlist_id, asset_id, position, added_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(watchlist_id, asset_id) DO NOTHING",
        params![watchlist_id, asset_id, position, now],
    )?;

    Ok(())
}

pub fn remove_item(conn: &mut Connection, watchlist_id: &str, asset_id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM watchlist_items WHERE watchlist_id = ?1 AND asset_id = ?2",
        params![watchlist_id, asset_id],
    )?;
    compact_positions(&tx, watchlist_id)?;
    tx.commit()?;
    Ok(())
}

/// Rewrites positions for the whole list in one transaction. Sparse or fractional indexing
/// would avoid the rewrite, but at watchlist scale it buys nothing and adds a rebalancing
/// edge case. See DATA_MODEL.md §2.2.
pub fn reorder(conn: &mut Connection, watchlist_id: &str, asset_ids: &[String]) -> AppResult<()> {
    let tx = conn.transaction()?;
    for (index, asset_id) in asset_ids.iter().enumerate() {
        tx.execute(
            "UPDATE watchlist_items SET position = ?3 WHERE watchlist_id = ?1 AND asset_id = ?2",
            params![watchlist_id, asset_id, index as i64],
        )?;
    }
    compact_positions(&tx, watchlist_id)?;
    tx.commit()?;
    Ok(())
}

/// Closes gaps left by a removal so positions stay 0..n-1.
fn compact_positions(conn: &Connection, watchlist_id: &str) -> AppResult<()> {
    let mut stmt = conn.prepare(
        "SELECT asset_id FROM watchlist_items WHERE watchlist_id = ?1 ORDER BY position",
    )?;
    let ids: Vec<String> = stmt
        .query_map([watchlist_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<_>>()?;

    for (index, asset_id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE watchlist_items SET position = ?3 WHERE watchlist_id = ?1 AND asset_id = ?2",
            params![watchlist_id, asset_id, index as i64],
        )?;
    }
    Ok(())
}
