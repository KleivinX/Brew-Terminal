use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::models::Note;

/// Generous, but bounded: a note is research shorthand, not a document store, and an
/// unbounded field is a way to put a hundred megabytes into a row by accident.
pub const MAX_NOTE_BODY: usize = 20_000;
pub const MAX_NOTE_TITLE: usize = 200;

pub fn validate(title: &str, body: &str) -> AppResult<()> {
    if title.chars().count() > MAX_NOTE_TITLE {
        return Err(AppError::Validation {
            field: "title".into(),
            detail: format!("titles are limited to {MAX_NOTE_TITLE} characters"),
        });
    }
    if body.len() > MAX_NOTE_BODY {
        return Err(AppError::Validation {
            field: "body".into(),
            detail: "that note is too long to store".into(),
        });
    }
    if title.trim().is_empty() && body.trim().is_empty() {
        return Err(AppError::Validation {
            field: "body".into(),
            detail: "an empty note has nothing to save".into(),
        });
    }
    Ok(())
}

fn row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        asset_id: row.get(1)?,
        title: row.get(2)?,
        body_md: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

const SELECT: &str = "SELECT id, asset_id, title, body_md, created_at, updated_at FROM notes";

pub fn list_for_asset(conn: &Connection, asset_id: &str) -> AppResult<Vec<Note>> {
    let sql = format!("{SELECT} WHERE asset_id = ?1 ORDER BY updated_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([asset_id], row_to_note)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, note_id: &str) -> AppResult<Option<Note>> {
    let sql = format!("{SELECT} WHERE id = ?1");
    let note = conn.query_row(&sql, [note_id], row_to_note).optional()?;
    Ok(note)
}

/// Creates or updates a note, keeping the FTS index in step.
///
/// `notes_fts` is an external-content FTS5 table, so SQLite does not maintain it: rows have to
/// be pushed in explicitly, and a stale index shows up as a note that exists but cannot be
/// found. Doing it in the same transaction as the write is what stops the two diverging.
pub fn upsert(
    conn: &mut Connection,
    id: Option<String>,
    asset_id: Option<String>,
    title: &str,
    body: &str,
    now: i64,
) -> AppResult<Note> {
    validate(title, body)?;

    let tx = conn.transaction()?;
    let note_id = id.unwrap_or_else(|| format!("note-{}", uuid::Uuid::new_v4()));

    let existing_rowid: Option<i64> = tx
        .query_row("SELECT rowid FROM notes WHERE id = ?1", [&note_id], |row| {
            row.get(0)
        })
        .optional()?;

    if let Some(rowid) = existing_rowid {
        // FTS5 external-content tables need the old row removed before the new one is added.
        tx.execute(
            "INSERT INTO notes_fts (notes_fts, rowid, title, body_md)
             SELECT 'delete', rowid, title, body_md FROM notes WHERE rowid = ?1",
            [rowid],
        )?;
        tx.execute(
            "UPDATE notes SET title = ?2, body_md = ?3, updated_at = ?4 WHERE id = ?1",
            params![note_id, title, body, now],
        )?;
        tx.execute(
            "INSERT INTO notes_fts (rowid, title, body_md) VALUES (?1, ?2, ?3)",
            params![rowid, title, body],
        )?;
    } else {
        tx.execute(
            "INSERT INTO notes (id, asset_id, title, body_md, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![note_id, asset_id, title, body, now],
        )?;
        let rowid = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO notes_fts (rowid, title, body_md) VALUES (?1, ?2, ?3)",
            params![rowid, title, body],
        )?;
    }

    tx.commit()?;

    get(conn, &note_id)?.ok_or(AppError::NotFound)
}

pub fn delete(conn: &mut Connection, note_id: &str) -> AppResult<()> {
    let tx = conn.transaction()?;

    let rowid: Option<i64> = tx
        .query_row("SELECT rowid FROM notes WHERE id = ?1", [note_id], |row| {
            row.get(0)
        })
        .optional()?;

    let Some(rowid) = rowid else {
        return Err(AppError::NotFound);
    };

    tx.execute(
        "INSERT INTO notes_fts (notes_fts, rowid, title, body_md)
         SELECT 'delete', rowid, title, body_md FROM notes WHERE rowid = ?1",
        [rowid],
    )?;
    tx.execute("DELETE FROM notes WHERE id = ?1", [note_id])?;
    tx.commit()?;

    Ok(())
}

/// Full-text search across every note.
pub fn search(conn: &Connection, query: &str, limit: usize) -> AppResult<Vec<Note>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = conn.prepare(
        "SELECT n.id, n.asset_id, n.title, n.body_md, n.created_at, n.updated_at
         FROM notes_fts f JOIN notes n ON n.rowid = f.rowid
         WHERE notes_fts MATCH ?1
         ORDER BY rank
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![fts_query(trimmed), limit as i64], row_to_note)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Turns user input into an FTS5 query.
///
/// FTS5's syntax treats `"`, `*`, `:`, `^`, `-` and `NEAR` as operators, so raw input can
/// produce a syntax error — a search box that throws on an apostrophe. Each word is quoted
/// and the terms are ANDed, which makes any input safe and behaves the way a search box is
/// expected to.
fn fts_query(input: &str) -> String {
    input
        .split_whitespace()
        .map(|word| format!("\"{}\"", word.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" AND ")
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
    fn creates_and_reads_back_a_note() {
        let p = setup();
        let mut conn = p.get().unwrap();

        let note = upsert(&mut conn, None, None, "Thesis", "Looks interesting", 1000).unwrap();
        assert_eq!(note.title, "Thesis");
        assert_eq!(
            get(&conn, &note.id).unwrap().unwrap().body_md,
            "Looks interesting"
        );
    }

    #[test]
    fn updates_without_creating_a_duplicate() {
        let p = setup();
        let mut conn = p.get().unwrap();

        let note = upsert(&mut conn, None, None, "First", "body", 1000).unwrap();
        let updated = upsert(
            &mut conn,
            Some(note.id.clone()),
            None,
            "Second",
            "new body",
            2000,
        )
        .unwrap();

        assert_eq!(updated.id, note.id);
        assert_eq!(updated.title, "Second");
        assert_eq!(updated.created_at, 1000, "creation time is preserved");
        assert_eq!(updated.updated_at, 2000);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn finds_a_note_by_full_text() {
        let p = setup();
        let mut conn = p.get().unwrap();

        upsert(
            &mut conn,
            None,
            None,
            "Bitcoin thesis",
            "supply halving",
            1000,
        )
        .unwrap();
        upsert(&mut conn, None, None, "Apple", "services revenue", 1000).unwrap();

        let hits = search(&conn, "halving", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Bitcoin thesis");
    }

    #[test]
    fn search_index_follows_an_edit() {
        // notes_fts is external-content, so a missed index update means a note that exists
        // but cannot be found — or worse, is found by text it no longer contains.
        let p = setup();
        let mut conn = p.get().unwrap();

        let note = upsert(&mut conn, None, None, "Original", "aardvark", 1000).unwrap();
        upsert(&mut conn, Some(note.id), None, "Changed", "buffalo", 2000).unwrap();

        assert!(
            search(&conn, "aardvark", 10).unwrap().is_empty(),
            "stale term still matches"
        );
        assert_eq!(search(&conn, "buffalo", 10).unwrap().len(), 1);
    }

    #[test]
    fn search_index_follows_a_delete() {
        let p = setup();
        let mut conn = p.get().unwrap();

        let note = upsert(&mut conn, None, None, "Temp", "capybara", 1000).unwrap();
        delete(&mut conn, &note.id).unwrap();

        assert!(search(&conn, "capybara", 10).unwrap().is_empty());
        assert!(get(&conn, &note.id).unwrap().is_none());
    }

    #[test]
    fn search_survives_punctuation_that_fts_treats_as_syntax() {
        // A raw FTS5 query would throw on these; the search box must not.
        let p = setup();
        let mut conn = p.get().unwrap();
        upsert(
            &mut conn,
            None,
            None,
            "Note",
            "the company's Q3 results",
            1000,
        )
        .unwrap();

        for query in [
            "company's",
            "\"unbalanced",
            "a* b^",
            "NEAR",
            "-minus",
            "x:y",
        ] {
            assert!(search(&conn, query, 10).is_ok(), "query {query:?} errored");
        }
        assert_eq!(search(&conn, "company's", 10).unwrap().len(), 1);
    }

    #[test]
    fn multiple_words_narrow_the_result() {
        let p = setup();
        let mut conn = p.get().unwrap();

        upsert(&mut conn, None, None, "One", "alpha beta", 1000).unwrap();
        upsert(&mut conn, None, None, "Two", "alpha gamma", 1000).unwrap();

        assert_eq!(search(&conn, "alpha", 10).unwrap().len(), 2);
        assert_eq!(search(&conn, "alpha beta", 10).unwrap().len(), 1);
    }

    #[test]
    fn notes_are_scoped_to_an_asset_and_ordered_by_recency() {
        let p = setup();
        let mut conn = p.get().unwrap();
        conn.execute(
            "INSERT INTO assets (id, asset_type, symbol, name, currency, created_at, updated_at)
             VALUES ('crypto:cg:bitcoin','crypto','BTC','Bitcoin','USD',1,1)",
            [],
        )
        .unwrap();

        upsert(
            &mut conn,
            None,
            Some("crypto:cg:bitcoin".into()),
            "Older",
            "a",
            1000,
        )
        .unwrap();
        upsert(
            &mut conn,
            None,
            Some("crypto:cg:bitcoin".into()),
            "Newer",
            "b",
            2000,
        )
        .unwrap();
        upsert(&mut conn, None, None, "Unattached", "c", 3000).unwrap();

        let notes = list_for_asset(&conn, "crypto:cg:bitcoin").unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].title, "Newer", "most recently updated first");
    }

    #[test]
    fn rejects_an_empty_note_and_an_oversized_one() {
        let p = setup();
        let mut conn = p.get().unwrap();

        assert!(upsert(&mut conn, None, None, "   ", "  ", 1000).is_err());
        assert!(upsert(
            &mut conn,
            None,
            None,
            "t",
            &"x".repeat(MAX_NOTE_BODY + 1),
            1000
        )
        .is_err());
    }

    #[test]
    fn deleting_a_missing_note_reports_not_found() {
        let p = setup();
        let mut conn = p.get().unwrap();
        assert!(delete(&mut conn, "note-nope").is_err());
    }
}
