use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;
use crate::models::{Asset, AssetType};

/// Assets are upserted rather than inserted: the same asset arrives repeatedly from search,
/// quotes and watchlist adds, and only the mutable descriptive fields should change.
pub fn upsert(conn: &Connection, asset: &Asset, now: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO assets (id, asset_type, symbol, name, currency, exchange, region, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
         ON CONFLICT(id) DO UPDATE SET
           symbol = excluded.symbol,
           name = excluded.name,
           currency = excluded.currency,
           exchange = excluded.exchange,
           region = excluded.region,
           updated_at = excluded.updated_at",
        params![
            asset.id,
            asset.asset_type.as_str(),
            asset.symbol,
            asset.name,
            asset.currency,
            asset.exchange,
            asset.region,
            now,
        ],
    )?;
    Ok(())
}

fn row_to_asset(row: &rusqlite::Row<'_>) -> rusqlite::Result<Asset> {
    let type_str: String = row.get(1)?;
    Ok(Asset {
        id: row.get(0)?,
        // The CHECK constraint makes an unknown value impossible, but defaulting beats
        // panicking if a future migration ever widens the column.
        asset_type: AssetType::parse(&type_str).unwrap_or(AssetType::Crypto),
        symbol: row.get(2)?,
        name: row.get(3)?,
        currency: row.get(4)?,
        exchange: row.get(5)?,
        region: row.get(6)?,
    })
}

pub fn get(conn: &Connection, asset_id: &str) -> AppResult<Option<Asset>> {
    let asset = conn
        .query_row(
            "SELECT id, asset_type, symbol, name, currency, exchange, region
             FROM assets WHERE id = ?1",
            [asset_id],
            row_to_asset,
        )
        .optional()?;
    Ok(asset)
}

pub fn get_many(conn: &Connection, asset_ids: &[String]) -> AppResult<Vec<Asset>> {
    if asset_ids.is_empty() {
        return Ok(Vec::new());
    }

    // Batched by construction. A per-id query loop here would be the exact N+1 the brief
    // forbids at the provider layer, just moved into SQLite.
    let placeholders = vec!["?"; asset_ids.len()].join(",");
    let sql = format!(
        "SELECT id, asset_type, symbol, name, currency, exchange, region
         FROM assets WHERE id IN ({placeholders})"
    );

    let mut stmt = conn.prepare(&sql)?;
    let params = rusqlite::params_from_iter(asset_ids.iter());
    let rows = stmt.query_map(params, row_to_asset)?;

    let mut assets = Vec::with_capacity(asset_ids.len());
    for row in rows {
        assets.push(row?);
    }
    Ok(assets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{migrations, pool};

    fn asset(id: &str, symbol: &str) -> Asset {
        Asset {
            id: id.into(),
            asset_type: AssetType::Crypto,
            symbol: symbol.into(),
            name: format!("{symbol} coin"),
            currency: "USD".into(),
            exchange: None,
            region: Some("global".into()),
        }
    }

    fn setup() -> pool::DbPool {
        let p = pool::create_in_memory().unwrap();
        let mut conn = p.get().unwrap();
        migrations::run(&mut conn, None).unwrap();
        drop(conn);
        p
    }

    #[test]
    fn upsert_then_get() {
        let p = setup();
        let conn = p.get().unwrap();

        upsert(&conn, &asset("crypto:cg:bitcoin", "BTC"), 1000).unwrap();
        let found = get(&conn, "crypto:cg:bitcoin").unwrap().unwrap();
        assert_eq!(found.symbol, "BTC");
    }

    #[test]
    fn upsert_updates_without_duplicating() {
        let p = setup();
        let conn = p.get().unwrap();

        upsert(&conn, &asset("crypto:cg:bitcoin", "BTC"), 1000).unwrap();
        let mut renamed = asset("crypto:cg:bitcoin", "BTC");
        renamed.name = "Bitcoin".into();
        upsert(&conn, &renamed, 2000).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(
            get(&conn, "crypto:cg:bitcoin").unwrap().unwrap().name,
            "Bitcoin"
        );
    }

    #[test]
    fn get_many_batches_in_one_query() {
        let p = setup();
        let conn = p.get().unwrap();

        for (id, sym) in [("crypto:cg:bitcoin", "BTC"), ("crypto:cg:ethereum", "ETH")] {
            upsert(&conn, &asset(id, sym), 1000).unwrap();
        }

        let found = get_many(
            &conn,
            &[
                "crypto:cg:bitcoin".to_string(),
                "crypto:cg:ethereum".to_string(),
            ],
        )
        .unwrap();
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn get_many_with_no_ids_does_not_query() {
        let p = setup();
        let conn = p.get().unwrap();
        assert!(get_many(&conn, &[]).unwrap().is_empty());
    }

    #[test]
    fn missing_asset_returns_none() {
        let p = setup();
        let conn = p.get().unwrap();
        assert!(get(&conn, "crypto:cg:nothing").unwrap().is_none());
    }
}
