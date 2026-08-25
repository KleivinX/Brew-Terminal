use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{LearningProgress, ProgressStatus};

pub fn list(conn: &Connection) -> AppResult<Vec<LearningProgress>> {
    let mut stmt = conn.prepare(
        "SELECT item_id, path_id, status, completed_at, updated_at FROM learning_progress",
    )?;
    let rows = stmt.query_map([], |row| {
        let status: String = row.get(2)?;
        Ok(LearningProgress {
            item_id: row.get(0)?,
            path_id: row.get(1)?,
            status: ProgressStatus::parse(&status).unwrap_or(ProgressStatus::NotStarted),
            completed_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn set(
    conn: &Connection,
    item_id: &str,
    path_id: &str,
    status: ProgressStatus,
    now: i64,
) -> AppResult<()> {
    if item_id.trim().is_empty() || path_id.trim().is_empty() {
        return Err(AppError::Validation {
            field: "itemId".into(),
            detail: "a progress record needs an item and a path".into(),
        });
    }

    // `completed_at` is set only on the transition into `completed`, and cleared on the way
    // out, so a re-read never reports a completion date for something not completed.
    let completed_at = match status {
        ProgressStatus::Completed => Some(now),
        _ => None,
    };

    conn.execute(
        "INSERT INTO learning_progress (item_id, path_id, status, completed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(item_id) DO UPDATE SET
           path_id = excluded.path_id,
           status = excluded.status,
           completed_at = excluded.completed_at,
           updated_at = excluded.updated_at",
        params![item_id, path_id, status.as_str(), completed_at, now],
    )?;

    Ok(())
}

/// Clears all progress. Offered because tracked progress is only useful if it can be reset —
/// otherwise a stale "completed" is permanent.
pub fn reset_all(conn: &Connection) -> AppResult<usize> {
    Ok(conn.execute("DELETE FROM learning_progress", [])?)
}

pub fn reset_path(conn: &Connection, path_id: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "DELETE FROM learning_progress WHERE path_id = ?1",
        [path_id],
    )?)
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
    fn records_and_reads_back_progress() {
        let p = setup();
        let conn = p.get().unwrap();

        set(&conn, "lesson-a", "path-1", ProgressStatus::Completed, 1000).unwrap();
        let all = list(&conn).unwrap();

        assert_eq!(all.len(), 1);
        assert_eq!(all[0].status, ProgressStatus::Completed);
        assert_eq!(all[0].completed_at, Some(1000));
    }

    #[test]
    fn updates_without_duplicating() {
        let p = setup();
        let conn = p.get().unwrap();

        set(
            &conn,
            "lesson-a",
            "path-1",
            ProgressStatus::InProgress,
            1000,
        )
        .unwrap();
        set(&conn, "lesson-a", "path-1", ProgressStatus::Completed, 2000).unwrap();

        let all = list(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].status, ProgressStatus::Completed);
    }

    #[test]
    fn clears_the_completion_date_when_a_lesson_is_reopened() {
        // A stale completion date on a not-completed lesson would render as nonsense.
        let p = setup();
        let conn = p.get().unwrap();

        set(&conn, "lesson-a", "path-1", ProgressStatus::Completed, 1000).unwrap();
        set(
            &conn,
            "lesson-a",
            "path-1",
            ProgressStatus::InProgress,
            2000,
        )
        .unwrap();

        assert_eq!(list(&conn).unwrap()[0].completed_at, None);
    }

    #[test]
    fn resets_a_single_path_without_touching_others() {
        let p = setup();
        let conn = p.get().unwrap();

        set(&conn, "a", "path-1", ProgressStatus::Completed, 1000).unwrap();
        set(&conn, "b", "path-2", ProgressStatus::Completed, 1000).unwrap();

        reset_path(&conn, "path-1").unwrap();
        let remaining = list(&conn).unwrap();

        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].path_id, "path-2");
    }

    #[test]
    fn resets_everything() {
        let p = setup();
        let conn = p.get().unwrap();

        set(&conn, "a", "path-1", ProgressStatus::Completed, 1000).unwrap();
        set(&conn, "b", "path-2", ProgressStatus::InProgress, 1000).unwrap();

        assert_eq!(reset_all(&conn).unwrap(), 2);
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn rejects_an_empty_identifier() {
        let p = setup();
        let conn = p.get().unwrap();
        assert!(set(&conn, "  ", "path-1", ProgressStatus::Completed, 1000).is_err());
    }
}
