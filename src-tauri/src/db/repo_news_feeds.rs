//! Storage for the user's RSS/Atom feed list.
//!
//! Seeding is idempotent and respects deletion: a default the user removed is recorded in
//! `news_feed_removals` and is never re-added. See `0003_news_feeds.sql`.

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;
use crate::models::{now_epoch_secs, NewsCategory, NewsFeed};

fn category_to_str(category: NewsCategory) -> &'static str {
    match category {
        NewsCategory::Crypto => "crypto",
        NewsCategory::Stocks => "stocks",
        NewsCategory::Macro => "macro",
        NewsCategory::Other => "other",
    }
}

fn category_from_str(value: &str) -> NewsCategory {
    match value {
        "crypto" => NewsCategory::Crypto,
        "stocks" => NewsCategory::Stocks,
        "macro" => NewsCategory::Macro,
        _ => NewsCategory::Other,
    }
}

fn row_to_feed(row: &rusqlite::Row<'_>) -> rusqlite::Result<NewsFeed> {
    Ok(NewsFeed {
        id: row.get(0)?,
        title: row.get(1)?,
        url: row.get(2)?,
        category: category_from_str(&row.get::<_, String>(3)?),
        enabled: row.get::<_, i64>(4)? != 0,
        is_default: row.get::<_, i64>(5)? != 0,
        added_at: row.get(6)?,
        last_ok_at: row.get(7)?,
        last_error: row.get(8)?,
    })
}

const SELECT: &str = "SELECT id, title, url, category, enabled, is_default, added_at, \
                      last_ok_at, last_error FROM news_feeds";

pub fn list(conn: &Connection) -> AppResult<Vec<NewsFeed>> {
    let sql = format!("{SELECT} ORDER BY category, title");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_feed)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Every feed that should actually be fetched.
pub fn list_enabled(conn: &Connection) -> AppResult<Vec<NewsFeed>> {
    let sql = format!("{SELECT} WHERE enabled = 1 ORDER BY category, title");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_feed)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<NewsFeed>> {
    let sql = format!("{SELECT} WHERE id = ?1");
    let feed = conn.query_row(&sql, params![id], row_to_feed).optional()?;
    Ok(feed)
}

/// Adds a feed the user supplied.
///
/// The URL is the identity, so adding one that is already present is a no-op rather than a
/// duplicate. Returns the feed as stored, existing or new.
pub fn add(
    conn: &Connection,
    title: &str,
    url: &str,
    category: NewsCategory,
) -> AppResult<NewsFeed> {
    if let Some(existing) = by_url(conn, url)? {
        return Ok(existing);
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = now_epoch_secs();

    conn.execute(
        "INSERT INTO news_feeds (id, title, url, category, enabled, is_default, added_at)
         VALUES (?1, ?2, ?3, ?4, 1, 0, ?5)",
        params![id, title, url, category_to_str(category), now],
    )?;

    // Adding back something previously removed clears the tombstone, so it behaves like any
    // other feed from then on.
    conn.execute(
        "DELETE FROM news_feed_removals WHERE url = ?1",
        params![url],
    )?;

    Ok(get(conn, &id)?.expect("the row was just inserted"))
}

pub fn by_url(conn: &Connection, url: &str) -> AppResult<Option<NewsFeed>> {
    let sql = format!("{SELECT} WHERE url = ?1");
    let feed = conn.query_row(&sql, params![url], row_to_feed).optional()?;
    Ok(feed)
}

/// Removes a feed, remembering the removal so seeding does not bring a default back.
pub fn remove(conn: &Connection, id: &str) -> AppResult<()> {
    let Some(feed) = get(conn, id)? else {
        return Ok(());
    };

    conn.execute("DELETE FROM news_feeds WHERE id = ?1", params![id])?;
    conn.execute(
        "INSERT INTO news_feed_removals (url, removed_at) VALUES (?1, ?2)
         ON CONFLICT(url) DO NOTHING",
        params![feed.url, now_epoch_secs()],
    )?;

    Ok(())
}

pub fn set_enabled(conn: &Connection, id: &str, enabled: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE news_feeds SET enabled = ?2 WHERE id = ?1",
        params![id, enabled as i64],
    )?;
    Ok(())
}

/// Records the outcome of a fetch so the settings panel can show which feeds work.
///
/// `error` is a short reason produced by this app, never a provider string echoed back.
pub fn record_result(conn: &Connection, id: &str, error: Option<&str>) -> AppResult<()> {
    match error {
        None => conn.execute(
            "UPDATE news_feeds SET last_ok_at = ?2, last_error = NULL WHERE id = ?1",
            params![id, now_epoch_secs()],
        )?,
        Some(reason) => conn.execute(
            "UPDATE news_feeds SET last_error = ?2 WHERE id = ?1",
            params![id, reason],
        )?,
    };
    Ok(())
}

/// Fills in a title from the feed's own metadata, but only where the stored one is empty.
///
/// A user's own label is never overwritten by whatever the publisher calls itself.
pub fn fill_missing_title(conn: &Connection, id: &str, title: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE news_feeds SET title = ?2 WHERE id = ?1 AND TRIM(title) = ''",
        params![id, title],
    )?;
    Ok(())
}

/// Seeds the shipped defaults, skipping any the user has removed.
pub fn seed_defaults(conn: &Connection, defaults: &[(&str, &str, NewsCategory)]) -> AppResult<()> {
    let now = now_epoch_secs();

    for (title, url, category) in defaults {
        let removed: bool = conn
            .query_row(
                "SELECT 1 FROM news_feed_removals WHERE url = ?1",
                params![url],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);

        if removed {
            continue;
        }

        conn.execute(
            "INSERT INTO news_feeds (id, title, url, category, enabled, is_default, added_at)
             VALUES (?1, ?2, ?3, ?4, 1, 1, ?5)
             ON CONFLICT(url) DO NOTHING",
            params![
                uuid::Uuid::new_v4().to_string(),
                title,
                url,
                category_to_str(*category),
                now
            ],
        )?;
    }

    Ok(())
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

    const DEFAULTS: &[(&str, &str, NewsCategory)] = &[
        ("One", "https://one.example/feed.xml", NewsCategory::Crypto),
        ("Two", "https://two.example/feed.xml", NewsCategory::Macro),
    ];

    #[test]
    fn seeds_defaults_once_and_is_idempotent() {
        let conn = db();
        seed_defaults(&conn, DEFAULTS).unwrap();
        seed_defaults(&conn, DEFAULTS).unwrap();
        seed_defaults(&conn, DEFAULTS).unwrap();

        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn a_removed_default_is_not_resurrected_by_seeding() {
        let conn = db();
        seed_defaults(&conn, DEFAULTS).unwrap();

        let feed = by_url(&conn, "https://one.example/feed.xml")
            .unwrap()
            .unwrap();
        remove(&conn, &feed.id).unwrap();

        // This is the whole point of the tombstone table: the next launch must not undo a
        // deliberate deletion.
        seed_defaults(&conn, DEFAULTS).unwrap();

        assert!(by_url(&conn, "https://one.example/feed.xml")
            .unwrap()
            .is_none());
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn re_adding_a_removed_feed_clears_the_tombstone() {
        let conn = db();
        seed_defaults(&conn, DEFAULTS).unwrap();
        let feed = by_url(&conn, "https://one.example/feed.xml")
            .unwrap()
            .unwrap();
        remove(&conn, &feed.id).unwrap();

        add(
            &conn,
            "One again",
            "https://one.example/feed.xml",
            NewsCategory::Crypto,
        )
        .unwrap();

        seed_defaults(&conn, DEFAULTS).unwrap();
        assert!(by_url(&conn, "https://one.example/feed.xml")
            .unwrap()
            .is_some());
        assert_eq!(list(&conn).unwrap().len(), 2, "no duplicate was created");
    }

    #[test]
    fn adding_the_same_url_twice_does_not_duplicate() {
        let conn = db();
        let first = add(
            &conn,
            "A",
            "https://a.example/feed.xml",
            NewsCategory::Stocks,
        )
        .unwrap();
        let second = add(
            &conn,
            "A again",
            "https://a.example/feed.xml",
            NewsCategory::Crypto,
        )
        .unwrap();

        assert_eq!(first.id, second.id);
        assert_eq!(list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn only_enabled_feeds_are_listed_for_fetching() {
        let conn = db();
        seed_defaults(&conn, DEFAULTS).unwrap();
        let feed = by_url(&conn, "https://one.example/feed.xml")
            .unwrap()
            .unwrap();

        set_enabled(&conn, &feed.id, false).unwrap();

        let enabled = list_enabled(&conn).unwrap();
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].url, "https://two.example/feed.xml");
    }

    #[test]
    fn recording_success_clears_a_previous_error() {
        let conn = db();
        let feed = add(
            &conn,
            "A",
            "https://a.example/feed.xml",
            NewsCategory::Stocks,
        )
        .unwrap();

        record_result(&conn, &feed.id, Some("could not be reached")).unwrap();
        assert!(get(&conn, &feed.id).unwrap().unwrap().last_error.is_some());

        record_result(&conn, &feed.id, None).unwrap();
        let after = get(&conn, &feed.id).unwrap().unwrap();
        assert!(after.last_error.is_none());
        assert!(after.last_ok_at.is_some());
    }

    #[test]
    fn a_user_supplied_title_is_never_overwritten_by_the_publisher() {
        let conn = db();
        let feed = add(
            &conn,
            "My name for it",
            "https://a.example/feed.xml",
            NewsCategory::Stocks,
        )
        .unwrap();

        fill_missing_title(&conn, &feed.id, "The Publisher's Name").unwrap();

        assert_eq!(
            get(&conn, &feed.id).unwrap().unwrap().title,
            "My name for it"
        );
    }

    #[test]
    fn an_empty_title_is_filled_from_the_feed() {
        let conn = db();
        let feed = add(
            &conn,
            "",
            "https://a.example/feed.xml",
            NewsCategory::Stocks,
        )
        .unwrap();

        fill_missing_title(&conn, &feed.id, "The Publisher's Name").unwrap();

        assert_eq!(
            get(&conn, &feed.id).unwrap().unwrap().title,
            "The Publisher's Name"
        );
    }
}
