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
        pinned_at: row.get(6)?,
    })
}

const SELECT: &str =
    "SELECT id, asset_id, title, body_md, created_at, updated_at, pinned_at FROM notes";

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

/// Every note, newest first.
///
/// Bounded rather than unbounded. Notes are local and user-authored, so the realistic ceiling
/// is low — but "select everything" in a list view is the kind of query that is fine until the
/// one user who pasted a thousand rows in finds out it is not.
pub fn list_all(conn: &Connection, limit: usize) -> AppResult<Vec<Note>> {
    let sql = format!("{SELECT} ORDER BY updated_at DESC, created_at DESC LIMIT ?1");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([limit as i64], row_to_note)?;

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
    pinned_at: Option<i64>,
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
            "UPDATE notes SET title = ?2, body_md = ?3, updated_at = ?4, pinned_at = ?5
             WHERE id = ?1",
            params![note_id, title, body, now, pinned_at],
        )?;
        tx.execute(
            "INSERT INTO notes_fts (rowid, title, body_md) VALUES (?1, ?2, ?3)",
            params![rowid, title, body],
        )?;
    } else {
        tx.execute(
            "INSERT INTO notes (id, asset_id, title, body_md, created_at, updated_at, pinned_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
            params![note_id, asset_id, title, body, now, pinned_at],
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

/// Puts a deleted note back exactly as it was.
///
/// Deliberately not `upsert` with the old id. That path would bring the note back with a fresh
/// `created_at` and with whatever `asset_id` the calling screen happened to know about — which
/// for the notes workspace is `None`, so undoing a delete there would silently detach a note
/// from the asset it was written against. An undo that loses part of what it restores is worse
/// than no undo, because the user believes they recovered.
///
/// Idempotent: restoring a note that is already present returns it untouched rather than
/// failing, so a double-click on Undo does not produce an error the user cannot act on.
///
/// `asset_id` is dropped when the asset it points at is gone. The column is
/// `REFERENCES assets(id) ON DELETE CASCADE`, so keeping it would fail the whole restore on a
/// foreign-key violation and the user would lose the text as well as the link. Coming back as
/// a general note is the lesser loss, and it is visible — the note simply appears unattached.
pub fn restore(conn: &mut Connection, note: &Note) -> AppResult<Note> {
    validate(&note.title, &note.body_md)?;

    let tx = conn.transaction()?;

    if let Some(existing) = {
        let sql = format!("{SELECT} WHERE id = ?1");
        tx.query_row(&sql, [&note.id], row_to_note).optional()?
    } {
        tx.commit()?;
        return Ok(existing);
    }

    let asset_id = match note.asset_id.as_deref() {
        Some(id) => tx
            .query_row("SELECT id FROM assets WHERE id = ?1", [id], |row| {
                row.get::<_, String>(0)
            })
            .optional()?,
        None => None,
    };

    tx.execute(
        "INSERT INTO notes (id, asset_id, title, body_md, created_at, updated_at, pinned_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            note.id,
            asset_id,
            note.title,
            note.body_md,
            note.created_at,
            note.updated_at,
            note.pinned_at
        ],
    )?;

    // External-content FTS5 again: the index is not maintained for us, and a note that exists
    // but cannot be searched is the exact failure this app would not notice on its own.
    let rowid = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO notes_fts (rowid, title, body_md) VALUES (?1, ?2, ?3)",
        params![rowid, note.title, note.body_md],
    )?;

    tx.commit()?;
    get(conn, &note.id)?.ok_or(AppError::NotFound)
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
        // Column order has to match `row_to_note`, which reads by index — this is the one
        // query that spells the columns out separately from `SELECT`, so a column added there
        // has to be added here too.
        "SELECT n.id, n.asset_id, n.title, n.body_md, n.created_at, n.updated_at, n.pinned_at
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

    /// The existing tests predate pinning and none of them are about it, so this shadows the
    /// real `upsert` with the unpinned form rather than threading a `None` through forty call
    /// sites. The pin has its own tests below.
    fn upsert(
        conn: &mut Connection,
        id: Option<String>,
        asset_id: Option<String>,
        title: &str,
        body: &str,
        now: i64,
    ) -> AppResult<Note> {
        super::upsert(conn, id, asset_id, title, body, None, now)
    }

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
    fn lists_every_note_regardless_of_what_it_is_attached_to() {
        // The gap this closes: `list_for_asset` can never return a note with a null asset_id,
        // so before this a general note could be written and then never found again.
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
            "Attached",
            "a",
            1000,
        )
        .unwrap();
        upsert(&mut conn, None, None, "Free standing", "b", 2000).unwrap();

        let all = list_all(&conn, 100).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].title, "Free standing", "most recently updated first");
        assert!(all.iter().any(|n| n.asset_id.is_none()));
        assert!(all.iter().any(|n| n.asset_id.is_some()));
    }

    #[test]
    fn the_full_list_is_bounded() {
        let p = setup();
        let mut conn = p.get().unwrap();
        for i in 0..10 {
            upsert(&mut conn, None, None, &format!("n{i}"), "body", 1000 + i).unwrap();
        }
        assert_eq!(list_all(&conn, 3).unwrap().len(), 3);
    }

    #[test]
    fn the_newest_note_survives_a_tie_on_update_time() {
        // Two notes saved in the same second is entirely normal — the clock is whole seconds.
        // Without the secondary sort the order would be whatever SQLite felt like, and the
        // list would reshuffle between renders.
        let p = setup();
        let mut conn = p.get().unwrap();
        upsert(&mut conn, None, None, "Older", "a", 5000).unwrap();
        upsert(&mut conn, None, None, "Newer", "b", 5000).unwrap();

        let all = list_all(&conn, 10).unwrap();
        assert_eq!(all.len(), 2);
        // Same updated_at, so created_at decides; both were created at 5000 too, leaving
        // insertion order. The guarantee asserted here is only that it is stable.
        let again = list_all(&conn, 10).unwrap();
        assert_eq!(
            all.iter().map(|n| &n.id).collect::<Vec<_>>(),
            again.iter().map(|n| &n.id).collect::<Vec<_>>(),
            "the list order must not change between identical queries"
        );
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

    fn seed_bitcoin(conn: &Connection) {
        conn.execute(
            "INSERT INTO assets (id, asset_type, symbol, name, currency, created_at, updated_at)
             VALUES ('crypto:cg:bitcoin','crypto','BTC','Bitcoin','USD',1,1)",
            [],
        )
        .unwrap();
    }

    #[test]
    fn a_restored_note_comes_back_with_its_own_id_and_timestamps() {
        // The point of a separate restore path. `upsert` would stamp a new `created_at`, so
        // undoing a delete would quietly rewrite when the note was written.
        let p = setup();
        let mut conn = p.get().unwrap();

        let note = upsert(&mut conn, None, None, "Thesis", "body", 1_000).unwrap();
        delete(&mut conn, &note.id).unwrap();

        let restored = restore(&mut conn, &note).unwrap();
        assert_eq!(restored.id, note.id);
        assert_eq!(restored.created_at, 1_000);
        assert_eq!(restored.updated_at, note.updated_at);
        assert_eq!(restored.body_md, "body");
    }

    #[test]
    fn a_restored_note_keeps_the_asset_it_was_written_against() {
        // The failure this closes: the notes workspace deletes with no asset in hand, so an
        // undo routed through `upsert` would detach the note from its asset without saying so.
        let p = setup();
        let mut conn = p.get().unwrap();
        seed_bitcoin(&conn);

        let note = upsert(
            &mut conn,
            None,
            Some("crypto:cg:bitcoin".into()),
            "Attached",
            "a",
            1_000,
        )
        .unwrap();
        delete(&mut conn, &note.id).unwrap();

        let restored = restore(&mut conn, &note).unwrap();
        assert_eq!(restored.asset_id.as_deref(), Some("crypto:cg:bitcoin"));
        assert_eq!(list_for_asset(&conn, "crypto:cg:bitcoin").unwrap().len(), 1);
    }

    #[test]
    fn a_restored_note_is_searchable_again() {
        // External-content FTS5 is not maintained by SQLite. A restore that skipped the index
        // would produce a note that exists, renders, and cannot be found.
        let p = setup();
        let mut conn = p.get().unwrap();

        let note = upsert(&mut conn, None, None, "Liquidity", "spreads widened", 1_000).unwrap();
        delete(&mut conn, &note.id).unwrap();
        restore(&mut conn, &note).unwrap();

        let hits = search(&conn, "spreads", 10).unwrap();
        assert_eq!(hits.len(), 1, "the restored note must be back in the index");
        assert_eq!(hits[0].id, note.id);
    }

    #[test]
    fn restoring_twice_is_harmless() {
        // Undo is a button someone will double-click. The second press must not error.
        let p = setup();
        let mut conn = p.get().unwrap();

        let note = upsert(&mut conn, None, None, "Thesis", "body", 1_000).unwrap();
        delete(&mut conn, &note.id).unwrap();

        restore(&mut conn, &note).unwrap();
        let again = restore(&mut conn, &note).unwrap();

        assert_eq!(again.id, note.id);
        assert_eq!(list_all(&conn, 10).unwrap().len(), 1, "no duplicate row");
    }

    #[test]
    fn restoring_does_not_overwrite_a_note_that_is_already_there() {
        // Undo pressed long after the id was reused, or after the user rewrote the note. The
        // living copy wins; a recovery must not become a destructive write.
        let p = setup();
        let mut conn = p.get().unwrap();

        let original = upsert(&mut conn, None, None, "Old", "old body", 1_000).unwrap();
        let rewritten = upsert(
            &mut conn,
            Some(original.id.clone()),
            None,
            "New",
            "new body",
            2_000,
        )
        .unwrap();

        let result = restore(&mut conn, &original).unwrap();
        assert_eq!(result.body_md, "new body");
        assert_eq!(result.title, rewritten.title);
    }

    #[test]
    fn a_note_whose_asset_is_gone_comes_back_detached_rather_than_not_at_all() {
        // asset_id is REFERENCES assets(id), so keeping it would fail the whole insert on a
        // foreign-key violation and the user would lose the text too. Detached is the lesser
        // loss and it is visible on screen.
        let p = setup();
        let mut conn = p.get().unwrap();
        seed_bitcoin(&conn);

        let note = upsert(
            &mut conn,
            None,
            Some("crypto:cg:bitcoin".into()),
            "Attached",
            "a",
            1_000,
        )
        .unwrap();
        delete(&mut conn, &note.id).unwrap();
        conn.execute("DELETE FROM assets WHERE id = 'crypto:cg:bitcoin'", [])
            .unwrap();

        let restored = restore(&mut conn, &note).unwrap();
        assert_eq!(restored.asset_id, None);
        assert_eq!(restored.body_md, "a");
    }

    #[test]
    fn a_note_can_name_the_day_it_is_about() {
        let p = setup();
        let mut conn = p.get().unwrap();

        // Written now, about last March. The pin is not the creation time.
        let note = super::upsert(
            &mut conn,
            None,
            None,
            "Why I bought",
            "spreads had blown out",
            Some(1_700_000_000),
            1_800_000_000,
        )
        .unwrap();

        assert_eq!(note.pinned_at, Some(1_700_000_000));
        assert_eq!(note.created_at, 1_800_000_000);
    }

    #[test]
    fn a_note_with_no_pin_reads_back_unpinned() {
        let p = setup();
        let mut conn = p.get().unwrap();

        let note = upsert(&mut conn, None, None, "General", "thoughts", 1_000).unwrap();
        assert_eq!(note.pinned_at, None);
    }

    #[test]
    fn a_pin_can_be_added_moved_and_taken_off_again() {
        let p = setup();
        let mut conn = p.get().unwrap();

        let note = upsert(&mut conn, None, None, "Thesis", "body", 1_000).unwrap();

        let pinned = super::upsert(
            &mut conn,
            Some(note.id.clone()),
            None,
            "Thesis",
            "body",
            Some(1_700_000_000),
            2_000,
        )
        .unwrap();
        assert_eq!(pinned.pinned_at, Some(1_700_000_000));

        let moved = super::upsert(
            &mut conn,
            Some(note.id.clone()),
            None,
            "Thesis",
            "body",
            Some(1_710_000_000),
            3_000,
        )
        .unwrap();
        assert_eq!(moved.pinned_at, Some(1_710_000_000));

        let unpinned = super::upsert(
            &mut conn,
            Some(note.id.clone()),
            None,
            "Thesis",
            "body",
            None,
            4_000,
        )
        .unwrap();
        assert_eq!(
            unpinned.pinned_at, None,
            "clearing a pin has to be possible"
        );
    }

    /// Undo has to bring the pin back with everything else, or restoring a note about a
    /// specific day returns it to the wrong place on the chart.
    #[test]
    fn a_restored_note_keeps_its_pin() {
        let p = setup();
        let mut conn = p.get().unwrap();

        let note = super::upsert(
            &mut conn,
            None,
            None,
            "Pinned",
            "body",
            Some(1_700_000_000),
            1_000,
        )
        .unwrap();
        delete(&mut conn, &note.id).unwrap();

        let restored = restore(&mut conn, &note).unwrap();
        assert_eq!(restored.pinned_at, Some(1_700_000_000));
    }

    #[test]
    fn a_restore_still_has_to_pass_validation() {
        // The one write path that takes a whole record from the frontend. It is not a reason
        // to skip the length checks every other path runs.
        let p = setup();
        let mut conn = p.get().unwrap();

        let oversized = Note {
            pinned_at: None,
            id: "note-x".into(),
            asset_id: None,
            title: "t".into(),
            body_md: "x".repeat(MAX_NOTE_BODY + 1),
            created_at: 1,
            updated_at: 1,
        };
        assert!(restore(&mut conn, &oversized).is_err());
    }
}
