//! Writing a table the user is looking at to a `.csv` file.
//!
//! The rows are built in the frontend, because that is where the column choices and the
//! formatting already live — the file should hold what the screen holds. This module's only
//! job is putting the text on disk, which the webview cannot do.
//!
//! Deliberately not a general "write this text to that path" command. That would be a
//! filesystem primitive reachable from anything running in the webview; this one takes a
//! payload it has checked and refuses a destination that is not a CSV file.

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// Mirrors `services::profile::ExportResult`, kept separate so the two can diverge — a profile
/// export is encrypted and this one is plain text, and a shared type would invite treating
/// them as interchangeable.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct CsvExportResult {
    pub path: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub bytes: u64,
    /// Data rows, excluding the header — what the UI reports back to the user.
    #[cfg_attr(test, ts(type = "number"))]
    pub rows: u64,
}

/// A ceiling on what one export may write.
///
/// The tables this serves are bounded already (500 notes, 200 screener rows), so anything past
/// this is a bug upstream rather than a legitimate export, and writing gigabytes to the user's
/// disk is not the right way to find out.
const MAX_CSV_BYTES: usize = 25 * 1024 * 1024;

/// Refuses anything that is not a `.csv`.
///
/// The path comes from the native save dialog, so in normal use it already is one. The check
/// is here for the case it is not: writing CSV over a path the user picked for something else
/// is a data-loss bug, and an extension check is the cheapest way to not have it.
fn check_destination(path: &str) -> AppResult<()> {
    let is_csv = std::path::Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("csv"));

    if !is_csv {
        return Err(AppError::Validation {
            field: "path".into(),
            detail: "a table can only be exported to a .csv file".into(),
        });
    }
    Ok(())
}

pub fn write_csv(path: String, csv: String) -> AppResult<CsvExportResult> {
    check_destination(&path)?;

    if csv.len() > MAX_CSV_BYTES {
        return Err(AppError::Validation {
            field: "csv".into(),
            detail: "that table is too large to export".into(),
        });
    }

    // Lines minus the header. `lines()` treats a trailing newline as no extra line, and the
    // encoder does not write one, so this is the row count the user sees on screen.
    let rows = csv.lines().count().saturating_sub(1) as u64;
    let bytes = csv.len() as u64;

    std::fs::write(&path, csv.as_bytes()).map_err(|error| {
        // The path came from the user's own picker, but it still does not belong in an error
        // string that reaches the UI — same rule as the profile export.
        tracing::warn!(?error, "could not write the CSV file");
        AppError::Storage("The table could not be written to that location.".into())
    })?;

    tracing::info!(bytes, rows, "wrote a CSV export");
    Ok(CsvExportResult { path, bytes, rows })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_table_and_reports_what_it_wrote() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("out.csv");

        let result = write_csv(
            path.to_string_lossy().into_owned(),
            "Symbol,Price\r\nBTC,1\r\nETH,2".into(),
        )
        .unwrap();

        assert_eq!(result.rows, 2, "the header is not a row");
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "Symbol,Price\r\nBTC,1\r\nETH,2"
        );
    }

    #[test]
    fn a_header_only_export_reports_no_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.csv");
        let result = write_csv(path.to_string_lossy().into_owned(), "Symbol,Price".into()).unwrap();
        assert_eq!(result.rows, 0);
    }

    /// Writing CSV over a path chosen for something else is a data-loss bug. The extension is
    /// the cheapest way not to have it.
    #[test]
    fn refuses_a_destination_that_is_not_a_csv() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["notes.txt", "profile.brewprofile", "noextension"] {
            let path = dir.path().join(name);
            assert!(
                write_csv(path.to_string_lossy().into_owned(), "a,b".into()).is_err(),
                "{name} should have been refused"
            );
            assert!(!path.exists(), "{name} must not have been written");
        }
    }

    #[test]
    fn the_extension_check_is_case_insensitive() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Table.CSV");
        assert!(write_csv(path.to_string_lossy().into_owned(), "a,b".into()).is_ok());
    }

    #[test]
    fn refuses_an_export_past_the_size_ceiling() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("huge.csv");
        let huge = "x".repeat(MAX_CSV_BYTES + 1);

        assert!(write_csv(path.to_string_lossy().into_owned(), huge).is_err());
        assert!(!path.exists());
    }
}
