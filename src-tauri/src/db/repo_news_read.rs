use rusqlite::{Connection, OptionalExtension};

use crate::error::AppResult;
use crate::models::MAX_FEED_URL_LEN;

/// How many read marks to keep.
///
/// Read state is a convenience, not a record: the value of knowing you read something is almost
/// entirely in the recent past, and an unbounded table would grow for the life of the install
/// with no one ever looking at the old rows. Pruning by recency keeps the working set the size
/// of what a panel can actually show.
pub const MAX_READ_MARKS: usize = 5_000;

/// Marks headlines read. Already-read URLs keep their original timestamp.
///
/// Keeping the first timestamp rather than refreshing it is what makes "read three days ago"
/// true. Re-marking happens constantly — the panel marks what scrolled past — and bumping the
/// time on every pass would make every mark look like it happened just now, which is exactly
/// the information pruning needs to be correct.
pub fn mark_read(conn: &mut Connection, urls: &[String], now: i64) -> AppResult<usize> {
    if urls.is_empty() {
        return Ok(0);
    }

    let tx = conn.transaction()?;
    let mut inserted = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO news_read (url, read_at) VALUES (?1, ?2)
             ON CONFLICT(url) DO NOTHING",
        )?;
        for url in urls {
            // The same ceiling the feed URLs use. A row this table cannot match against
            // anything is a row worth not writing.
            if url.is_empty() || url.len() > MAX_FEED_URL_LEN {
                continue;
            }
            inserted += stmt.execute((url, now))?;
        }
    }

    // Prune inside the same transaction, so the table cannot be left over its ceiling by a
    // crash between the two writes.
    tx.execute(
        "DELETE FROM news_read WHERE url IN (
             SELECT url FROM news_read ORDER BY read_at DESC, url ASC LIMIT -1 OFFSET ?1
         )",
        [MAX_READ_MARKS as i64],
    )?;

    tx.commit()?;
    Ok(inserted)
}

pub fn mark_unread(conn: &Connection, url: &str) -> AppResult<()> {
    conn.execute("DELETE FROM news_read WHERE url = ?1", [url])?;
    Ok(())
}

/// Every read URL, newest first.
///
/// Returned whole rather than filtered against a list of articles. The table is bounded at
/// `MAX_READ_MARKS`, the frontend already holds the articles, and one cached call it can
/// intersect beats a round trip per panel refresh with the URLs pushed up and back.
pub fn list_read(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT url FROM news_read ORDER BY read_at DESC")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn clear(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM news_read", [])?;
    Ok(())
}

/// Whether one URL is marked, for tests and for a targeted check.
pub fn is_read(conn: &Connection, url: &str) -> AppResult<bool> {
    let found: Option<i64> = conn
        .query_row("SELECT 1 FROM news_read WHERE url = ?1", [url], |row| {
            row.get(0)
        })
        .optional()?;
    Ok(found.is_some())
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

    fn url(n: usize) -> String {
        format!("https://example.org/article-{n}")
    }

    #[test]
    fn marks_and_reads_back() {
        let p = setup();
        let mut conn = p.get().unwrap();

        mark_read(&mut conn, &[url(1), url(2)], 1_000).unwrap();

        assert!(is_read(&conn, &url(1)).unwrap());
        assert!(!is_read(&conn, &url(3)).unwrap());
        assert_eq!(list_read(&conn).unwrap().len(), 2);
    }

    #[test]
    fn marking_the_same_url_twice_is_not_two_rows() {
        let p = setup();
        let mut conn = p.get().unwrap();

        mark_read(&mut conn, &[url(1)], 1_000).unwrap();
        let second = mark_read(&mut conn, &[url(1)], 2_000).unwrap();

        assert_eq!(second, 0, "nothing new was inserted");
        assert_eq!(list_read(&conn).unwrap().len(), 1);
    }

    /// The panel re-marks what scrolls past constantly. Bumping the timestamp every pass would
    /// make every mark look like it happened just now, which is the one thing pruning needs to
    /// be right about.
    #[test]
    fn a_repeat_does_not_move_the_original_timestamp() {
        let p = setup();
        let mut conn = p.get().unwrap();

        mark_read(&mut conn, &[url(1)], 1_000).unwrap();
        mark_read(&mut conn, &[url(1)], 9_000).unwrap();

        let stored: i64 = conn
            .query_row(
                "SELECT read_at FROM news_read WHERE url = ?1",
                [url(1)],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, 1_000);
    }

    #[test]
    fn unmarking_puts_it_back_to_unread() {
        let p = setup();
        let mut conn = p.get().unwrap();

        mark_read(&mut conn, &[url(1)], 1_000).unwrap();
        mark_unread(&conn, &url(1)).unwrap();

        assert!(!is_read(&conn, &url(1)).unwrap());
    }

    #[test]
    fn unmarking_something_that_was_never_read_is_harmless() {
        let p = setup();
        let conn = p.get().unwrap();
        assert!(mark_unread(&conn, &url(99)).is_ok());
    }

    #[test]
    fn the_table_is_pruned_to_its_ceiling_keeping_the_newest() {
        let p = setup();
        let mut conn = p.get().unwrap();

        // Older batch first, then enough newer ones to push past the ceiling.
        mark_read(&mut conn, &[url(0)], 1).unwrap();
        let newer: Vec<String> = (1..=MAX_READ_MARKS).map(url).collect();
        mark_read(&mut conn, &newer, 5_000).unwrap();

        assert_eq!(list_read(&conn).unwrap().len(), MAX_READ_MARKS);
        assert!(
            !is_read(&conn, &url(0)).unwrap(),
            "the oldest mark should have been pruned"
        );
        assert!(is_read(&conn, &url(1)).unwrap());
    }

    #[test]
    fn an_empty_batch_touches_nothing() {
        let p = setup();
        let mut conn = p.get().unwrap();
        assert_eq!(mark_read(&mut conn, &[], 1_000).unwrap(), 0);
    }

    #[test]
    fn an_unusable_url_is_skipped_rather_than_stored() {
        let p = setup();
        let mut conn = p.get().unwrap();

        mark_read(
            &mut conn,
            &[String::new(), "h".repeat(MAX_FEED_URL_LEN + 1), url(1)],
            1_000,
        )
        .unwrap();

        assert_eq!(list_read(&conn).unwrap(), vec![url(1)]);
    }

    #[test]
    fn clearing_empties_it() {
        let p = setup();
        let mut conn = p.get().unwrap();

        mark_read(&mut conn, &[url(1), url(2)], 1_000).unwrap();
        clear(&conn).unwrap();

        assert!(list_read(&conn).unwrap().is_empty());
    }
}
