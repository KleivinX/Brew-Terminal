//! Storage for portfolio transactions.
//!
//! Reads come back in execution order because that is the only order `models::portfolio::replay`
//! can be given them in.

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;
use crate::models::{now_epoch_secs, Transaction, TransactionKind};

fn kind_to_str(kind: TransactionKind) -> &'static str {
    match kind {
        TransactionKind::Buy => "buy",
        TransactionKind::Sell => "sell",
    }
}

fn kind_from_str(value: &str) -> TransactionKind {
    match value {
        "sell" => TransactionKind::Sell,
        _ => TransactionKind::Buy,
    }
}

const SELECT: &str = "SELECT id, asset_id, symbol, kind, quantity, unit_price, fee, currency, \
                      executed_at, note, created_at FROM portfolio_transactions";

fn row_to_tx(row: &rusqlite::Row<'_>) -> rusqlite::Result<Transaction> {
    Ok(Transaction {
        id: row.get(0)?,
        asset_id: row.get(1)?,
        symbol: row.get(2)?,
        kind: kind_from_str(&row.get::<_, String>(3)?),
        quantity: row.get(4)?,
        unit_price: row.get(5)?,
        fee: row.get(6)?,
        currency: row.get(7)?,
        executed_at: row.get(8)?,
        note: row.get(9)?,
        created_at: row.get(10)?,
    })
}

fn collect(
    stmt: &mut rusqlite::Statement<'_>,
    args: &[&dyn rusqlite::ToSql],
) -> AppResult<Vec<Transaction>> {
    let rows = stmt.query_map(args, row_to_tx)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Every transaction, oldest first.
pub fn list_all(conn: &Connection) -> AppResult<Vec<Transaction>> {
    let sql = format!("{SELECT} ORDER BY executed_at, created_at");
    let mut stmt = conn.prepare(&sql)?;
    collect(&mut stmt, &[])
}

/// One asset's transactions, oldest first.
pub fn list_for_asset(conn: &Connection, asset_id: &str) -> AppResult<Vec<Transaction>> {
    let sql = format!("{SELECT} WHERE asset_id = ?1 ORDER BY executed_at, created_at");
    let mut stmt = conn.prepare(&sql)?;
    collect(&mut stmt, &[&asset_id])
}

/// Most recent first, for the activity list.
pub fn list_recent(conn: &Connection, limit: i64) -> AppResult<Vec<Transaction>> {
    let sql = format!("{SELECT} ORDER BY executed_at DESC, created_at DESC LIMIT ?1");
    let mut stmt = conn.prepare(&sql)?;
    collect(&mut stmt, &[&limit])
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<Transaction>> {
    let sql = format!("{SELECT} WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], row_to_tx).optional()?)
}

/// Inserts a transaction, returning it as stored.
pub fn insert(conn: &Connection, tx: &Transaction) -> AppResult<Transaction> {
    let id = if tx.id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        tx.id.clone()
    };

    conn.execute(
        "INSERT INTO portfolio_transactions
           (id, asset_id, symbol, kind, quantity, unit_price, fee, currency, executed_at, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            tx.asset_id,
            tx.symbol,
            kind_to_str(tx.kind),
            tx.quantity,
            tx.unit_price,
            tx.fee,
            tx.currency.to_uppercase(),
            tx.executed_at,
            tx.note,
            now_epoch_secs(),
        ],
    )?;

    Ok(get(conn, &id)?.expect("the row was just inserted"))
}

pub fn update(conn: &Connection, tx: &Transaction) -> AppResult<Option<Transaction>> {
    let changed = conn.execute(
        "UPDATE portfolio_transactions
            SET asset_id = ?2, symbol = ?3, kind = ?4, quantity = ?5, unit_price = ?6,
                fee = ?7, currency = ?8, executed_at = ?9, note = ?10
          WHERE id = ?1",
        params![
            tx.id,
            tx.asset_id,
            tx.symbol,
            kind_to_str(tx.kind),
            tx.quantity,
            tx.unit_price,
            tx.fee,
            tx.currency.to_uppercase(),
            tx.executed_at,
            tx.note,
        ],
    )?;

    if changed == 0 {
        return Ok(None);
    }
    get(conn, &tx.id)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<bool> {
    let removed = conn.execute(
        "DELETE FROM portfolio_transactions WHERE id = ?1",
        params![id],
    )?;
    Ok(removed > 0)
}

/// Every distinct asset the portfolio has ever touched, with its most recent label.
pub fn held_assets(conn: &Connection) -> AppResult<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT asset_id,
                (SELECT symbol FROM portfolio_transactions s
                  WHERE s.asset_id = t.asset_id ORDER BY executed_at DESC LIMIT 1),
                (SELECT currency FROM portfolio_transactions c
                  WHERE c.asset_id = t.asset_id ORDER BY executed_at DESC LIMIT 1)
           FROM portfolio_transactions t
          GROUP BY asset_id
          ORDER BY asset_id",
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;

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

    fn tx(asset: &str, kind: TransactionKind, qty: f64, price: f64, at: i64) -> Transaction {
        Transaction {
            id: String::new(),
            asset_id: asset.into(),
            symbol: asset.split(':').next_back().unwrap_or("X").to_uppercase(),
            kind,
            quantity: qty,
            unit_price: price,
            fee: 0.0,
            currency: "usd".into(),
            executed_at: at,
            note: None,
            created_at: 0,
        }
    }

    #[test]
    fn stores_and_reads_back_a_transaction() {
        let conn = db();
        let stored = insert(
            &conn,
            &tx("crypto:cg:bitcoin", TransactionKind::Buy, 0.5, 40000.0, 100),
        )
        .unwrap();

        assert!(!stored.id.is_empty());
        assert_eq!(stored.currency, "USD", "currency is normalised on write");
        assert_eq!(stored.quantity, 0.5);
        assert_eq!(list_all(&conn).unwrap().len(), 1);
    }

    /// Replay depends entirely on this ordering, so it is asserted rather than assumed.
    #[test]
    fn transactions_come_back_in_execution_order() {
        let conn = db();
        for at in [300, 100, 200] {
            insert(
                &conn,
                &tx("crypto:cg:bitcoin", TransactionKind::Buy, 1.0, 10.0, at),
            )
            .unwrap();
        }

        let order: Vec<i64> = list_all(&conn)
            .unwrap()
            .iter()
            .map(|t| t.executed_at)
            .collect();
        assert_eq!(order, vec![100, 200, 300]);
    }

    #[test]
    fn recent_is_newest_first() {
        let conn = db();
        for at in [100, 300, 200] {
            insert(
                &conn,
                &tx("crypto:cg:bitcoin", TransactionKind::Buy, 1.0, 10.0, at),
            )
            .unwrap();
        }
        let order: Vec<i64> = list_recent(&conn, 10)
            .unwrap()
            .iter()
            .map(|t| t.executed_at)
            .collect();
        assert_eq!(order, vec![300, 200, 100]);
    }

    #[test]
    fn filters_by_asset() {
        let conn = db();
        insert(
            &conn,
            &tx("crypto:cg:bitcoin", TransactionKind::Buy, 1.0, 10.0, 100),
        )
        .unwrap();
        insert(
            &conn,
            &tx("stock:us:AAPL", TransactionKind::Buy, 2.0, 20.0, 200),
        )
        .unwrap();

        assert_eq!(list_for_asset(&conn, "stock:us:AAPL").unwrap().len(), 1);
        assert_eq!(held_assets(&conn).unwrap().len(), 2);
    }

    #[test]
    fn updates_and_deletes() {
        let conn = db();
        let mut stored = insert(
            &conn,
            &tx("crypto:cg:bitcoin", TransactionKind::Buy, 1.0, 10.0, 100),
        )
        .unwrap();

        stored.quantity = 2.5;
        let updated = update(&conn, &stored).unwrap().unwrap();
        assert_eq!(updated.quantity, 2.5);

        assert!(delete(&conn, &stored.id).unwrap());
        assert!(
            !delete(&conn, &stored.id).unwrap(),
            "deleting twice is not a success"
        );
        assert!(list_all(&conn).unwrap().is_empty());
    }

    #[test]
    fn updating_something_that_is_gone_reports_it_rather_than_inserting() {
        let conn = db();
        let ghost = tx("crypto:cg:bitcoin", TransactionKind::Buy, 1.0, 10.0, 100);
        let mut ghost = ghost;
        ghost.id = "does-not-exist".into();

        assert!(update(&conn, &ghost).unwrap().is_none());
        assert!(list_all(&conn).unwrap().is_empty());
    }

    #[test]
    fn the_schema_refuses_a_nonsensical_transaction() {
        let conn = db();
        // The CHECK constraints are the last line of defence behind `Transaction::validate`.
        assert!(insert(
            &conn,
            &tx("crypto:cg:bitcoin", TransactionKind::Buy, -1.0, 10.0, 100)
        )
        .is_err());
        assert!(insert(
            &conn,
            &tx("crypto:cg:bitcoin", TransactionKind::Buy, 1.0, -10.0, 100)
        )
        .is_err());
    }
}
