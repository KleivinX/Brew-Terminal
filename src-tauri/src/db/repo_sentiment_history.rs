use rusqlite::{params, Connection};

use crate::error::AppResult;
use crate::models::{SentimentMarket, SentimentPoint};

/// How many readings to keep per market.
///
/// Ten years of daily readings. Far beyond what any provider offers, which is the point — this
/// table exists to outlast them — and still a few hundred kilobytes.
pub const MAX_POINTS_PER_MARKET: usize = 3_700;

fn market_key(market: SentimentMarket) -> &'static str {
    match market {
        SentimentMarket::Crypto => "crypto",
        SentimentMarket::Stocks => "stocks",
    }
}

/// Records readings, keeping whatever is already stored for a day.
///
/// `DO NOTHING` rather than `DO UPDATE` on purpose. The equity index is this app's arithmetic
/// over FRED series, and FRED revises: recomputing last March with today's data can produce a
/// different number for last March. Keeping the first observation makes the stored series a
/// record of what the app actually showed on each day, rather than a rolling re-derivation that
/// silently rewrites its own past.
///
/// Values outside 0-100 are dropped rather than clamped. A reading off the scale means the
/// producer is wrong, and clamping would file that as a legitimate 100.
pub fn record(
    conn: &mut Connection,
    market: SentimentMarket,
    points: &[SentimentPoint],
) -> AppResult<usize> {
    if points.is_empty() {
        return Ok(0);
    }

    let key = market_key(market);
    let tx = conn.transaction()?;
    let mut written = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO sentiment_history (market, as_of, value) VALUES (?1, ?2, ?3)
             ON CONFLICT(market, as_of) DO NOTHING",
        )?;
        for point in points {
            if !(0..=100).contains(&point.value) {
                continue;
            }
            written += stmt.execute(params![key, point.time, point.value])?;
        }
    }

    // Pruned in the same transaction, so a crash between the two writes cannot leave the table
    // over its ceiling.
    tx.execute(
        "DELETE FROM sentiment_history WHERE market = ?1 AND as_of IN (
             SELECT as_of FROM sentiment_history WHERE market = ?1
             ORDER BY as_of DESC LIMIT -1 OFFSET ?2
         )",
        params![key, MAX_POINTS_PER_MARKET as i64],
    )?;

    tx.commit()?;
    Ok(written)
}

/// Stored readings for one market, oldest first — the order a trend line wants.
pub fn history(conn: &Connection, market: SentimentMarket) -> AppResult<Vec<SentimentPoint>> {
    let mut stmt = conn.prepare(
        "SELECT as_of, value FROM sentiment_history WHERE market = ?1 ORDER BY as_of ASC",
    )?;
    let rows = stmt.query_map([market_key(market)], |row| {
        Ok(SentimentPoint {
            time: row.get(0)?,
            value: row.get(1)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn clear(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM sentiment_history", [])?;
    Ok(())
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

    fn point(day: i64, value: i32) -> SentimentPoint {
        SentimentPoint {
            time: day * 86_400,
            value,
        }
    }

    #[test]
    fn records_and_reads_back_oldest_first() {
        let p = setup();
        let mut conn = p.get().unwrap();

        record(
            &mut conn,
            SentimentMarket::Crypto,
            &[point(3, 70), point(1, 40), point(2, 55)],
        )
        .unwrap();

        let stored = history(&conn, SentimentMarket::Crypto).unwrap();
        assert_eq!(
            stored.iter().map(|p| p.value).collect::<Vec<_>>(),
            vec![40, 55, 70],
            "a trend line reads oldest first"
        );
    }

    /// The two indices are different measurements of different markets. Mixing them would draw
    /// one on the other's chart.
    #[test]
    fn the_two_markets_are_kept_apart() {
        let p = setup();
        let mut conn = p.get().unwrap();

        record(&mut conn, SentimentMarket::Crypto, &[point(1, 20)]).unwrap();
        record(&mut conn, SentimentMarket::Stocks, &[point(1, 80)]).unwrap();

        assert_eq!(
            history(&conn, SentimentMarket::Crypto).unwrap()[0].value,
            20
        );
        assert_eq!(
            history(&conn, SentimentMarket::Stocks).unwrap()[0].value,
            80
        );
    }

    /// FRED revises, so recomputing an old day can produce a different number for it. The first
    /// observation is what the app actually showed that day, and it stands.
    #[test]
    fn a_day_already_recorded_is_not_rewritten() {
        let p = setup();
        let mut conn = p.get().unwrap();

        record(&mut conn, SentimentMarket::Stocks, &[point(1, 45)]).unwrap();
        let second = record(&mut conn, SentimentMarket::Stocks, &[point(1, 99)]).unwrap();

        assert_eq!(second, 0, "nothing new was written");
        assert_eq!(
            history(&conn, SentimentMarket::Stocks).unwrap()[0].value,
            45
        );
    }

    #[test]
    fn re_recording_a_whole_window_only_adds_what_is_new() {
        let p = setup();
        let mut conn = p.get().unwrap();

        record(
            &mut conn,
            SentimentMarket::Crypto,
            &[point(1, 10), point(2, 20)],
        )
        .unwrap();
        let added = record(
            &mut conn,
            SentimentMarket::Crypto,
            &[point(1, 10), point(2, 20), point(3, 30)],
        )
        .unwrap();

        assert_eq!(added, 1);
        assert_eq!(history(&conn, SentimentMarket::Crypto).unwrap().len(), 3);
    }

    /// A reading off the scale means the producer is wrong. Clamping would file that as a
    /// legitimate 100 and draw it as maximum greed.
    #[test]
    fn a_value_off_the_scale_is_dropped_rather_than_clamped() {
        let p = setup();
        let mut conn = p.get().unwrap();

        record(
            &mut conn,
            SentimentMarket::Crypto,
            &[point(1, -5), point(2, 101), point(3, 50)],
        )
        .unwrap();

        let stored = history(&conn, SentimentMarket::Crypto).unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].value, 50);
    }

    #[test]
    fn the_bounds_themselves_are_accepted() {
        let p = setup();
        let mut conn = p.get().unwrap();
        record(
            &mut conn,
            SentimentMarket::Crypto,
            &[point(1, 0), point(2, 100)],
        )
        .unwrap();
        assert_eq!(history(&conn, SentimentMarket::Crypto).unwrap().len(), 2);
    }

    #[test]
    fn the_table_is_pruned_to_its_ceiling_keeping_the_newest() {
        let p = setup();
        let mut conn = p.get().unwrap();

        let many: Vec<SentimentPoint> = (1..=(MAX_POINTS_PER_MARKET as i64 + 10))
            .map(|day| point(day, 50))
            .collect();
        record(&mut conn, SentimentMarket::Crypto, &many).unwrap();

        let stored = history(&conn, SentimentMarket::Crypto).unwrap();
        assert_eq!(stored.len(), MAX_POINTS_PER_MARKET);
        assert_eq!(
            stored.last().unwrap().time,
            (MAX_POINTS_PER_MARKET as i64 + 10) * 86_400,
            "the newest reading survives"
        );
    }

    #[test]
    fn an_empty_batch_touches_nothing() {
        let p = setup();
        let mut conn = p.get().unwrap();
        assert_eq!(record(&mut conn, SentimentMarket::Crypto, &[]).unwrap(), 0);
    }

    #[test]
    fn clearing_empties_both_markets() {
        let p = setup();
        let mut conn = p.get().unwrap();

        record(&mut conn, SentimentMarket::Crypto, &[point(1, 10)]).unwrap();
        record(&mut conn, SentimentMarket::Stocks, &[point(1, 10)]).unwrap();
        clear(&conn).unwrap();

        assert!(history(&conn, SentimentMarket::Crypto).unwrap().is_empty());
        assert!(history(&conn, SentimentMarket::Stocks).unwrap().is_empty());
    }
}
