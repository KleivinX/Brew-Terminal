use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;
use crate::models::CacheStats;

pub struct CachedPayload {
    pub payload_json: String,
    pub fetched_at: i64,
    pub ttl_seconds: i64,
}

pub fn get(conn: &Connection, cache_key: &str) -> AppResult<Option<CachedPayload>> {
    let row = conn
        .query_row(
            "SELECT payload_json, fetched_at, ttl_seconds FROM cache_entries WHERE cache_key = ?1",
            [cache_key],
            |row| {
                Ok(CachedPayload {
                    payload_json: row.get(0)?,
                    fetched_at: row.get(1)?,
                    ttl_seconds: row.get(2)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

pub fn put(
    conn: &Connection,
    cache_key: &str,
    provider_id: &str,
    kind: &str,
    payload_json: &str,
    ttl_seconds: i64,
    now: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO cache_entries
           (cache_key, provider_id, kind, payload_json, fetched_at, ttl_seconds, byte_size)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(cache_key) DO UPDATE SET
           payload_json = excluded.payload_json,
           fetched_at = excluded.fetched_at,
           ttl_seconds = excluded.ttl_seconds,
           byte_size = excluded.byte_size",
        params![
            cache_key,
            provider_id,
            kind,
            payload_json,
            now,
            ttl_seconds,
            payload_json.len() as i64,
        ],
    )?;
    Ok(())
}

pub fn stats(conn: &Connection) -> AppResult<CacheStats> {
    let (entry_count, total_bytes, oldest) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(byte_size), 0), MIN(fetched_at) FROM cache_entries",
        [],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        },
    )?;

    Ok(CacheStats {
        entry_count,
        total_bytes,
        oldest_fetched_at: oldest,
    })
}

pub fn clear(conn: &Connection, kind: Option<&str>) -> AppResult<usize> {
    let removed = match kind {
        Some(k) => conn.execute("DELETE FROM cache_entries WHERE kind = ?1", [k])?,
        None => conn.execute("DELETE FROM cache_entries", [])?,
    };
    Ok(removed)
}

/// Evicts entries far past their TTL. Run on startup and periodically — the multiplier means
/// recently-expired rows survive to serve the stale-while-revalidate path.
pub fn evict_expired(conn: &Connection, now: i64, ttl_multiplier: i64) -> AppResult<usize> {
    let removed = conn.execute(
        "DELETE FROM cache_entries WHERE fetched_at + (ttl_seconds * ?2) < ?1",
        params![now, ttl_multiplier],
    )?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{migrations, pool};

    fn setup() -> pool::DbPool {
        let p = pool::create_in_memory().unwrap();
        let mut conn = p.get().unwrap();
        migrations::run(&mut conn, None).unwrap();
        drop(conn);
        p
    }

    #[test]
    fn round_trips_a_payload() {
        let p = setup();
        let conn = p.get().unwrap();

        put(&conn, "k1", "mock", "quote", "[1,2,3]", 60, 1000).unwrap();
        let cached = get(&conn, "k1").unwrap().unwrap();

        assert_eq!(cached.payload_json, "[1,2,3]");
        assert_eq!(cached.fetched_at, 1000);
        assert_eq!(cached.ttl_seconds, 60);
    }

    #[test]
    fn overwrites_on_refetch() {
        let p = setup();
        let conn = p.get().unwrap();

        put(&conn, "k1", "mock", "quote", "[1]", 60, 1000).unwrap();
        put(&conn, "k1", "mock", "quote", "[2]", 60, 2000).unwrap();

        assert_eq!(stats(&conn).unwrap().entry_count, 1);
        assert_eq!(get(&conn, "k1").unwrap().unwrap().payload_json, "[2]");
    }

    #[test]
    fn eviction_keeps_recently_expired_entries_for_the_stale_path() {
        let p = setup();
        let conn = p.get().unwrap();

        // Fetched at t=1000 with a 60s TTL. At t=1100 it is expired but only ~1.6 TTLs old.
        put(&conn, "k1", "mock", "quote", "[1]", 60, 1000).unwrap();
        evict_expired(&conn, 1100, 10).unwrap();
        assert!(
            get(&conn, "k1").unwrap().is_some(),
            "still useful as stale data"
        );

        evict_expired(&conn, 5000, 10).unwrap();
        assert!(get(&conn, "k1").unwrap().is_none(), "far past TTL, evicted");
    }

    #[test]
    fn clear_by_kind_leaves_other_kinds() {
        let p = setup();
        let conn = p.get().unwrap();

        put(&conn, "q1", "mock", "quote", "[]", 60, 1000).unwrap();
        put(&conn, "n1", "mock", "news", "[]", 60, 1000).unwrap();

        clear(&conn, Some("quote")).unwrap();
        assert!(get(&conn, "q1").unwrap().is_none());
        assert!(get(&conn, "n1").unwrap().is_some());
    }

    #[test]
    fn stats_track_size() {
        let p = setup();
        let conn = p.get().unwrap();

        put(&conn, "k1", "mock", "quote", "12345", 60, 1000).unwrap();
        let s = stats(&conn).unwrap();
        assert_eq!(s.entry_count, 1);
        assert_eq!(s.total_bytes, 5);
        assert_eq!(s.oldest_fetched_at, Some(1000));
    }
}
