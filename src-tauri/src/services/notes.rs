use crate::db::repo_notes;
use crate::error::{AppError, AppResult};
use crate::models::{now_epoch_secs, Note};
use crate::services::csv_export::{check_destination, CsvExportResult};
use crate::state::{with_db, AppState};

/// The most notes the workspace will load at once.
pub const MAX_NOTES: usize = 500;

/// Every note, for the notes workspace.
///
/// Distinct from `list_notes`, which is the per-asset view in the research panel. A note with
/// no asset attached is invisible to that query by construction, so without this one there is
/// no way to reach a general note after writing it.
pub async fn list_all_notes(state: &AppState) -> AppResult<Vec<Note>> {
    with_db(state.pool.clone(), move |conn| {
        repo_notes::list_all(conn, MAX_NOTES)
    })
    .await
}

pub async fn list_notes(state: &AppState, asset_id: String) -> AppResult<Vec<Note>> {
    with_db(state.pool.clone(), move |conn| {
        repo_notes::list_for_asset(conn, &asset_id)
    })
    .await
}

pub async fn upsert_note(
    state: &AppState,
    note_id: Option<String>,
    asset_id: Option<String>,
    title: String,
    body_md: String,
    pinned_at: Option<i64>,
) -> AppResult<Note> {
    let now = now_epoch_secs();
    with_db(state.pool.clone(), move |conn| {
        repo_notes::upsert(conn, note_id, asset_id, &title, &body_md, pinned_at, now)
    })
    .await
}

pub async fn delete_note(state: &AppState, note_id: String) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_notes::delete(conn, &note_id)
    })
    .await
}

/// Puts a deleted note back, for the Undo on the delete toast.
///
/// The whole note travels from the frontend rather than an id, because by the time Undo is
/// pressed the row is gone and there is nothing left to look up. That makes this the one write
/// path that trusts a client-supplied `created_at`; `repo_notes::restore` still validates the
/// text, and the worst a malformed call can do is create a note with an odd timestamp in a
/// local database the user already owns.
pub async fn restore_note(state: &AppState, note: Note) -> AppResult<Note> {
    with_db(state.pool.clone(), move |conn| {
        repo_notes::restore(conn, &note)
    })
    .await
}

pub async fn search_notes(state: &AppState, query: String, limit: usize) -> AppResult<Vec<Note>> {
    let limit = limit.clamp(1, 100);
    with_db(state.pool.clone(), move |conn| {
        repo_notes::search(conn, &query, limit)
    })
    .await
}

fn day(epoch_secs: i64) -> String {
    chrono::DateTime::from_timestamp(epoch_secs, 0)
        .map(|at| at.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "unknown date".into())
}

/// Every note as one Markdown document, in the workspace's order (newest first).
///
/// Bodies are written verbatim — they are already Markdown, and this file is for the user to
/// keep, not for the app to read back. Titles are flattened to one line, because a newline in
/// a heading would silently turn the rest of the title into body text.
pub fn render_markdown(notes: &[Note], exported_at: i64) -> String {
    let count = match notes.len() {
        1 => "1 note".to_string(),
        n => format!("{n} notes"),
    };
    let mut out = format!(
        "# Brew Terminal notes\n\nExported {} · {count}\n",
        day(exported_at)
    );

    for note in notes {
        let title = note.title.split_whitespace().collect::<Vec<_>>().join(" ");
        let title = if title.is_empty() { "Untitled" } else { &title };
        out.push_str(&format!("\n---\n\n## {title}\n\n"));
        if let Some(asset) = &note.asset_id {
            out.push_str(&format!("- Asset: `{asset}`\n"));
        }
        if let Some(pinned) = note.pinned_at {
            out.push_str(&format!("- About: {}\n", day(pinned)));
        }
        out.push_str(&format!(
            "- Written: {} · Updated: {}\n\n",
            day(note.created_at),
            day(note.updated_at)
        ));
        out.push_str(note.body_md.trim_end());
        out.push('\n');
    }
    out
}

/// Writes every note to a `.md` file the user chose.
///
/// Reads the notes itself rather than taking text from the webview — same reason `write_csv`
/// is not a general "write this string" command. Unlike the workspace list it is not capped at
/// `MAX_NOTES`: an export that quietly stops at 500 is an export that loses notes.
pub async fn export_markdown(state: &AppState, path: String) -> AppResult<CsvExportResult> {
    check_destination(&path, "md", "notes can only be exported to a .md file")?;

    let notes = with_db(state.pool.clone(), |conn| {
        repo_notes::list_all(conn, i64::MAX as usize)
    })
    .await?;
    let text = render_markdown(&notes, now_epoch_secs());
    let (bytes, rows) = (text.len() as u64, notes.len() as u64);

    tokio::task::spawn_blocking(move || {
        std::fs::write(&path, text).map_err(|error| {
            tracing::warn!(?error, "could not write the notes export");
            AppError::Storage("The notes could not be written to that location.".into())
        })?;
        Ok(CsvExportResult { path, bytes, rows })
    })
    .await
    .map_err(|error| AppError::Storage(format!("export task failed: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(title: &str, asset: Option<&str>, pinned: Option<i64>, body: &str) -> Note {
        Note {
            id: "n".into(),
            asset_id: asset.map(Into::into),
            title: title.into(),
            body_md: body.into(),
            pinned_at: pinned,
            created_at: 0,
            updated_at: 86_400,
        }
    }

    #[test]
    fn markdown_export_keeps_what_the_note_says() {
        let md = render_markdown(
            &[
                note(
                    "Why\nI sold",
                    Some("stock:us:AAPL"),
                    Some(172_800),
                    "Body **kept**.\n\n",
                ),
                note("  ", None, None, "general"),
            ],
            0,
        );

        assert!(md.starts_with("# Brew Terminal notes\n\nExported 1970-01-01 · 2 notes\n"));
        assert!(
            md.contains("## Why I sold\n"),
            "newline in a title must not split the heading"
        );
        assert!(md.contains("- Asset: `stock:us:AAPL`\n- About: 1970-01-03\n"));
        assert!(md.contains("- Written: 1970-01-01 · Updated: 1970-01-02\n\nBody **kept**.\n"));
        assert!(
            md.contains("## Untitled\n\n- Written:"),
            "blank title, and no asset line"
        );
        assert_eq!(
            render_markdown(&[], 0).lines().nth(2),
            Some("Exported 1970-01-01 · 0 notes")
        );
    }

    #[test]
    fn markdown_export_refuses_a_destination_that_is_not_markdown() {
        assert!(check_destination("/tmp/notes.txt", "md", "x").is_err());
        assert!(check_destination("/tmp/NOTES.MD", "md", "x").is_ok());
    }
}
