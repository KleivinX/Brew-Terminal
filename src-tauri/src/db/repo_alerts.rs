//! Storage for price alerts.

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;
use crate::models::{now_epoch_secs, Alert, AlertKind};

const SELECT: &str = "SELECT id, asset_id, symbol, kind, threshold, enabled, note, created_at, \
                      triggered_at, triggered_value FROM alerts";

fn row_to_alert(row: &rusqlite::Row<'_>) -> rusqlite::Result<Alert> {
    Ok(Alert {
        id: row.get(0)?,
        asset_id: row.get(1)?,
        symbol: row.get(2)?,
        kind: AlertKind::from_str_or_default(&row.get::<_, String>(3)?),
        threshold: row.get(4)?,
        enabled: row.get::<_, i64>(5)? != 0,
        note: row.get(6)?,
        created_at: row.get(7)?,
        triggered_at: row.get(8)?,
        triggered_value: row.get(9)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Alert>> {
    let sql = format!("{SELECT} ORDER BY triggered_at DESC, created_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_alert)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Alerts that are still waiting to fire. These are the only ones worth polling for.
pub fn armed(conn: &Connection) -> AppResult<Vec<Alert>> {
    let sql = format!("{SELECT} WHERE enabled = 1 AND triggered_at IS NULL");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_alert)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<Alert>> {
    let sql = format!("{SELECT} WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], row_to_alert).optional()?)
}

pub fn insert(conn: &Connection, alert: &Alert) -> AppResult<Alert> {
    let id = if alert.id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        alert.id.clone()
    };

    conn.execute(
        "INSERT INTO alerts (id, asset_id, symbol, kind, threshold, enabled, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            alert.asset_id,
            alert.symbol,
            alert.kind.as_str(),
            alert.threshold,
            alert.enabled as i64,
            alert.note,
            now_epoch_secs(),
        ],
    )?;

    Ok(get(conn, &id)?.expect("the row was just inserted"))
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<bool> {
    Ok(conn.execute("DELETE FROM alerts WHERE id = ?1", params![id])? > 0)
}

pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE alerts SET enabled = ?2 WHERE id = ?1",
        params![id, enabled as i64],
    )?;
    Ok(())
}

/// Records that an alert fired.
pub fn mark_triggered(conn: &Connection, id: &str, value: f64) -> AppResult<()> {
    conn.execute(
        "UPDATE alerts SET triggered_at = ?2, triggered_value = ?3 WHERE id = ?1",
        params![id, now_epoch_secs(), value],
    )?;
    Ok(())
}

/// Puts a fired alert back on watch.
pub fn rearm(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE alerts SET triggered_at = NULL, triggered_value = NULL WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Every asset any armed alert is watching, so the poller fetches those and nothing else.
pub fn armed_asset_ids(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT asset_id FROM alerts WHERE enabled = 1 AND triggered_at IS NULL",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrations::run(&mut conn, None).unwrap();
        conn
    }

    fn alert(asset: &str, kind: AlertKind, threshold: f64) -> Alert {
        Alert {
            id: String::new(),
            asset_id: asset.into(),
            symbol: "BTC".into(),
            kind,
            threshold,
            enabled: true,
            note: None,
            created_at: 0,
            triggered_at: None,
            triggered_value: None,
        }
    }

    #[test]
    fn stores_and_reads_back_an_alert() {
        let conn = db();
        let stored = insert(
            &conn,
            &alert("crypto:cg:bitcoin", AlertKind::PriceAbove, 100.0),
        )
        .unwrap();

        assert!(!stored.id.is_empty());
        assert_eq!(stored.threshold, 100.0);
        assert!(stored.triggered_at.is_none());
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    /// Only armed alerts are worth a request, and this is what bounds what the poller fetches.
    #[test]
    fn only_armed_alerts_are_polled_for() {
        let conn = db();
        let a = insert(
            &conn,
            &alert("crypto:cg:bitcoin", AlertKind::PriceAbove, 1.0),
        )
        .unwrap();
        let b = insert(
            &conn,
            &alert("crypto:cg:ethereum", AlertKind::PriceAbove, 1.0),
        )
        .unwrap();
        let c = insert(&conn, &alert("stock:us:AAPL", AlertKind::PriceAbove, 1.0)).unwrap();

        mark_triggered(&conn, &a.id, 5.0).unwrap();
        set_enabled(&conn, &b.id, false).unwrap();

        let ids = armed_asset_ids(&conn).unwrap();
        assert_eq!(ids, vec![c.asset_id]);
        assert_eq!(armed(&conn).unwrap().len(), 1);
    }

    #[test]
    fn firing_records_the_value_that_tripped_it() {
        let conn = db();
        let stored = insert(
            &conn,
            &alert("crypto:cg:bitcoin", AlertKind::PriceAbove, 100.0),
        )
        .unwrap();

        mark_triggered(&conn, &stored.id, 123.45).unwrap();
        let after = get(&conn, &stored.id).unwrap().unwrap();

        assert!(after.triggered_at.is_some());
        assert_eq!(after.triggered_value, Some(123.45));
    }

    #[test]
    fn re_arming_puts_it_back_on_watch() {
        let conn = db();
        let stored = insert(
            &conn,
            &alert("crypto:cg:bitcoin", AlertKind::PriceAbove, 100.0),
        )
        .unwrap();
        mark_triggered(&conn, &stored.id, 150.0).unwrap();

        rearm(&conn, &stored.id).unwrap();
        let after = get(&conn, &stored.id).unwrap().unwrap();

        assert!(after.triggered_at.is_none());
        assert!(after.triggered_value.is_none());
        assert_eq!(armed(&conn).unwrap().len(), 1);
    }

    #[test]
    fn deduplicates_assets_so_one_request_covers_several_alerts() {
        let conn = db();
        insert(
            &conn,
            &alert("crypto:cg:bitcoin", AlertKind::PriceAbove, 100.0),
        )
        .unwrap();
        insert(
            &conn,
            &alert("crypto:cg:bitcoin", AlertKind::PriceBelow, 50.0),
        )
        .unwrap();

        assert_eq!(armed_asset_ids(&conn).unwrap().len(), 1);
        assert_eq!(armed(&conn).unwrap().len(), 2);
    }

    #[test]
    fn deletes() {
        let conn = db();
        let stored = insert(
            &conn,
            &alert("crypto:cg:bitcoin", AlertKind::PriceAbove, 100.0),
        )
        .unwrap();
        assert!(delete(&conn, &stored.id).unwrap());
        assert!(!delete(&conn, &stored.id).unwrap());
        assert!(list(&conn).unwrap().is_empty());
    }
}
