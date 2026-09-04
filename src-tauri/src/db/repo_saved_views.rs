use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::models::{SavedView, SavedViewKind};

/// A ceiling on how many views one screen can hold.
///
/// Not a technical limit — it is a list the user reads, and a list of two hundred is not one.
pub const MAX_VIEWS_PER_KIND: usize = 50;

fn row_to_view(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavedView> {
    let kind: String = row.get(1)?;
    Ok(SavedView {
        id: row.get(0)?,
        // The column is CHECK-constrained to these two, so anything else means the database was
        // edited by hand; falling back to Screener keeps the row readable rather than failing
        // the whole list.
        kind: if kind == "compare" {
            SavedViewKind::Compare
        } else {
            SavedViewKind::Screener
        },
        name: row.get(2)?,
        payload: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

const SELECT: &str = "SELECT id, kind, name, payload, created_at, updated_at FROM saved_views";

pub fn list(conn: &Connection, kind: SavedViewKind) -> AppResult<Vec<SavedView>> {
    let sql = format!("{SELECT} WHERE kind = ?1 ORDER BY updated_at DESC, name ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([kind.as_str()], row_to_view)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Saves a view, replacing one of the same name on the same screen.
///
/// Replacing rather than erroring is the behaviour the UI offers: saving over a name you already
/// used is how you update a view you have just refined, and making that an error would mean
/// deleting the old one first every time. `created_at` survives the replacement — the view is
/// the same one, edited.
pub fn save(
    conn: &mut Connection,
    kind: SavedViewKind,
    name: &str,
    payload: &str,
    now: i64,
) -> AppResult<SavedView> {
    let name = SavedView::validate_name(name).map_err(|detail| AppError::Validation {
        field: "name".into(),
        detail,
    })?;
    SavedView::validate_payload(payload).map_err(|detail| AppError::Validation {
        field: "payload".into(),
        detail,
    })?;

    let tx = conn.transaction()?;

    let existing: Option<String> = tx
        .query_row(
            "SELECT id FROM saved_views WHERE kind = ?1 AND name = ?2",
            params![kind.as_str(), name],
            |row| row.get(0),
        )
        .optional()?;

    let id = match existing {
        Some(id) => {
            tx.execute(
                "UPDATE saved_views SET payload = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, payload, now],
            )?;
            id
        }
        None => {
            let count: i64 = tx.query_row(
                "SELECT COUNT(*) FROM saved_views WHERE kind = ?1",
                [kind.as_str()],
                |row| row.get(0),
            )?;
            if count as usize >= MAX_VIEWS_PER_KIND {
                return Err(AppError::Validation {
                    field: "name".into(),
                    detail: format!(
                        "You already have {MAX_VIEWS_PER_KIND} saved views here. Remove one first."
                    ),
                });
            }

            let id = format!("view-{}", uuid::Uuid::new_v4());
            tx.execute(
                "INSERT INTO saved_views (id, kind, name, payload, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![id, kind.as_str(), name, payload, now],
            )?;
            id
        }
    };

    tx.commit()?;
    get(conn, &id)?.ok_or(AppError::NotFound)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<SavedView>> {
    let sql = format!("{SELECT} WHERE id = ?1");
    Ok(conn.query_row(&sql, [id], row_to_view).optional()?)
}

pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let removed = conn.execute("DELETE FROM saved_views WHERE id = ?1", [id])?;
    if removed == 0 {
        return Err(AppError::NotFound);
    }
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

    #[test]
    fn saves_and_reads_back_a_view() {
        let p = setup();
        let mut conn = p.get().unwrap();

        let view = save(
            &mut conn,
            SavedViewKind::Screener,
            "Large caps",
            r#"{"minMarketCap":1000000000}"#,
            1_000,
        )
        .unwrap();

        assert_eq!(view.name, "Large caps");
        assert_eq!(list(&conn, SavedViewKind::Screener).unwrap().len(), 1);
    }

    /// Saving over a name you already used is how a refined view is updated. Making that an
    /// error would mean deleting the old one first every time.
    #[test]
    fn saving_the_same_name_replaces_rather_than_duplicates() {
        let p = setup();
        let mut conn = p.get().unwrap();

        let first = save(
            &mut conn,
            SavedViewKind::Screener,
            "Mine",
            r#"{"a":1}"#,
            1_000,
        )
        .unwrap();
        let second = save(
            &mut conn,
            SavedViewKind::Screener,
            "Mine",
            r#"{"a":2}"#,
            2_000,
        )
        .unwrap();

        assert_eq!(first.id, second.id, "it is the same view, edited");
        assert_eq!(second.payload, r#"{"a":2}"#);
        assert_eq!(
            second.created_at, 1_000,
            "it was created when it was created"
        );
        assert_eq!(second.updated_at, 2_000);
        assert_eq!(list(&conn, SavedViewKind::Screener).unwrap().len(), 1);
    }

    /// "Large caps" is a reasonable name for both a screen and a comparison.
    #[test]
    fn the_two_screens_have_separate_namespaces() {
        let p = setup();
        let mut conn = p.get().unwrap();

        save(
            &mut conn,
            SavedViewKind::Screener,
            "Large caps",
            "{}",
            1_000,
        )
        .unwrap();
        save(&mut conn, SavedViewKind::Compare, "Large caps", "{}", 1_000).unwrap();

        assert_eq!(list(&conn, SavedViewKind::Screener).unwrap().len(), 1);
        assert_eq!(list(&conn, SavedViewKind::Compare).unwrap().len(), 1);
    }

    #[test]
    fn a_screen_only_sees_its_own_views() {
        let p = setup();
        let mut conn = p.get().unwrap();
        save(
            &mut conn,
            SavedViewKind::Compare,
            "Only compare",
            "{}",
            1_000,
        )
        .unwrap();

        assert!(list(&conn, SavedViewKind::Screener).unwrap().is_empty());
    }

    #[test]
    fn the_most_recently_updated_view_is_listed_first() {
        let p = setup();
        let mut conn = p.get().unwrap();

        save(&mut conn, SavedViewKind::Screener, "Older", "{}", 1_000).unwrap();
        save(&mut conn, SavedViewKind::Screener, "Newer", "{}", 2_000).unwrap();

        let names: Vec<String> = list(&conn, SavedViewKind::Screener)
            .unwrap()
            .into_iter()
            .map(|v| v.name)
            .collect();
        assert_eq!(names, vec!["Newer", "Older"]);
    }

    #[test]
    fn a_view_that_will_not_read_back_as_json_is_never_stored() {
        let p = setup();
        let mut conn = p.get().unwrap();

        assert!(save(&mut conn, SavedViewKind::Screener, "Bad", "not json", 1).is_err());
        assert!(list(&conn, SavedViewKind::Screener).unwrap().is_empty());
    }

    #[test]
    fn an_unnamed_view_is_refused() {
        let p = setup();
        let mut conn = p.get().unwrap();
        assert!(save(&mut conn, SavedViewKind::Screener, "   ", "{}", 1).is_err());
    }

    #[test]
    fn deleting_removes_it_and_deleting_again_says_so() {
        let p = setup();
        let mut conn = p.get().unwrap();

        let view = save(&mut conn, SavedViewKind::Screener, "Temp", "{}", 1_000).unwrap();
        delete(&conn, &view.id).unwrap();

        assert!(list(&conn, SavedViewKind::Screener).unwrap().is_empty());
        assert!(matches!(delete(&conn, &view.id), Err(AppError::NotFound)));
    }

    /// A list the user reads, not a technical limit. Replacing an existing name is still
    /// allowed once full — otherwise a full list could not be edited.
    #[test]
    fn the_list_is_bounded_but_an_existing_view_can_still_be_updated() {
        let p = setup();
        let mut conn = p.get().unwrap();

        for i in 0..MAX_VIEWS_PER_KIND {
            save(
                &mut conn,
                SavedViewKind::Screener,
                &format!("View {i}"),
                "{}",
                1_000,
            )
            .unwrap();
        }

        assert!(save(&mut conn, SavedViewKind::Screener, "One too many", "{}", 1).is_err());
        assert!(save(
            &mut conn,
            SavedViewKind::Screener,
            "View 0",
            r#"{"b":1}"#,
            2_000
        )
        .is_ok());
    }
}
