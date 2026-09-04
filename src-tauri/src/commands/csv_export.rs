use tauri::State;

use crate::error::AppResult;
use crate::services::{self, csv_export::CsvExportResult};
use crate::state::AppState;

/// Writes a table the user is looking at to a `.csv` file they chose.
///
/// `state` is unused — nothing here touches the database — but the parameter stays so the
/// command has the same shape as every other one and can reach app state if a future export
/// needs it.
#[tauri::command]
pub async fn export_csv(
    _state: State<'_, AppState>,
    path: String,
    csv: String,
) -> AppResult<CsvExportResult> {
    // Blocking file I/O, off the async runtime.
    tokio::task::spawn_blocking(move || services::csv_export::write_csv(path, csv))
        .await
        .map_err(|error| crate::error::AppError::Storage(format!("export task failed: {error}")))?
}
