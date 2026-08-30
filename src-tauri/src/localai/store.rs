//! Where downloaded engines and models live.
//!
//! Everything sits under the app data directory, beside the database, so "delete Brew Terminal's
//! data" removes it all and nothing is written anywhere the user did not expect. Weights are
//! large, so the UI shows what is on disk and can delete any of it.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::localai::catalogue::{self, ModelEntry};

pub fn models_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("models")
}

pub fn engine_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("engine").join(catalogue::ENGINE_BUILD)
}

/// Where the running server's own output is written, so a failed start can be explained.
pub fn engine_log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("engine").join("llama-server.log")
}

pub fn model_path(data_dir: &Path, model: &ModelEntry) -> PathBuf {
    models_dir(data_dir).join(model.file_name)
}

/// The `llama-server` executable inside an unpacked engine, wherever the archive put it.
///
/// The layout has moved between llama.cpp builds — sometimes `build/bin/`, sometimes the
/// archive root — so this searches rather than assuming. Bounded to a shallow walk so a
/// surprising archive cannot turn this into a full disk scan.
pub fn server_binary(engine_dir: &Path) -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };

    fn find(dir: &Path, name: &str, depth: usize) -> Option<PathBuf> {
        if depth > 4 {
            return None;
        }
        let entries = std::fs::read_dir(dir).ok()?;
        let mut dirs = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.file_name().is_some_and(|f| f == name) {
                return Some(path);
            }
            if path.is_dir() {
                dirs.push(path);
            }
        }

        dirs.into_iter().find_map(|d| find(&d, name, depth + 1))
    }

    find(engine_dir, name, 0)
}

/// One model as the UI sees it: catalogue metadata plus what is actually on disk.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    #[serde(flatten)]
    pub entry: &'static ModelEntry,
    pub installed: bool,
    /// Bytes already fetched into a `.part` file, so a half-finished download is visible
    /// rather than looking like nothing happened.
    #[cfg_attr(test, ts(type = "number"))]
    pub partial_bytes: u64,
}

pub fn model_statuses(data_dir: &Path) -> Vec<ModelStatus> {
    catalogue::MODELS
        .iter()
        .map(|entry| {
            let path = model_path(data_dir, entry);
            let partial = path.with_extension("part");
            ModelStatus {
                entry,
                installed: path.exists(),
                partial_bytes: std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0),
            }
        })
        .collect()
}

/// Total bytes used by downloaded models and engines.
pub fn disk_usage(data_dir: &Path) -> u64 {
    fn size_of(dir: &Path) -> u64 {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return 0;
        };
        entries
            .flatten()
            .map(|entry| {
                let path = entry.path();
                if path.is_dir() {
                    size_of(&path)
                } else {
                    entry.metadata().map(|m| m.len()).unwrap_or(0)
                }
            })
            .sum()
    }

    size_of(&models_dir(data_dir)) + size_of(&data_dir.join("engine"))
}

/// Deletes a downloaded model, and any partial download of it.
pub fn delete_model(data_dir: &Path, model_id: &str) -> AppResult<()> {
    let Some(entry) = catalogue::model_by_id(model_id) else {
        return Err(AppError::NotFound);
    };

    let path = model_path(data_dir, entry);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|error| AppError::Storage(format!("could not delete the model: {error}")))?;
    }

    let partial = path.with_extension("part");
    if partial.exists() {
        let _ = std::fs::remove_file(&partial);
    }

    tracing::info!(model = model_id, "deleted a local model");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn everything_lives_under_the_app_data_directory() {
        let data = Path::new("/tmp/appdata");
        assert!(models_dir(data).starts_with(data));
        assert!(engine_dir(data).starts_with(data));
        assert!(model_path(data, &catalogue::MODELS[0]).starts_with(data));
    }

    #[test]
    fn the_engine_path_is_scoped_to_the_pinned_build() {
        // Two builds must not share a directory, or upgrading would run a mix of both.
        let data = Path::new("/tmp/appdata");
        assert!(engine_dir(data)
            .to_string_lossy()
            .contains(catalogue::ENGINE_BUILD));
    }

    #[test]
    fn nothing_reads_as_installed_on_a_fresh_machine() {
        let dir = tempfile::tempdir().unwrap();
        let statuses = model_statuses(dir.path());

        assert_eq!(statuses.len(), catalogue::MODELS.len());
        assert!(statuses.iter().all(|s| !s.installed));
        assert!(statuses.iter().all(|s| s.partial_bytes == 0));
        assert_eq!(disk_usage(dir.path()), 0);
    }

    #[test]
    fn a_partial_download_is_reported_rather_than_hidden() {
        let dir = tempfile::tempdir().unwrap();
        let entry = &catalogue::MODELS[0];
        let path = model_path(dir.path(), entry);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path.with_extension("part"), vec![0u8; 2048]).unwrap();

        let status = model_statuses(dir.path())
            .into_iter()
            .find(|s| s.entry.id == entry.id)
            .unwrap();

        assert!(!status.installed);
        assert_eq!(status.partial_bytes, 2048);
    }

    #[test]
    fn deleting_removes_both_the_model_and_any_partial() {
        let dir = tempfile::tempdir().unwrap();
        let entry = &catalogue::MODELS[0];
        let path = model_path(dir.path(), entry);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"weights").unwrap();
        std::fs::write(path.with_extension("part"), b"half").unwrap();

        delete_model(dir.path(), entry.id).unwrap();

        assert!(!path.exists());
        assert!(!path.with_extension("part").exists());
    }

    #[test]
    fn deleting_an_unknown_model_is_an_error_not_a_silent_success() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            delete_model(dir.path(), "not-a-model"),
            Err(AppError::NotFound)
        ));
    }

    #[test]
    fn finds_the_server_binary_wherever_the_archive_put_it() {
        let dir = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) {
            "llama-server.exe"
        } else {
            "llama-server"
        };

        let nested = dir.path().join("build").join("bin");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join(name), b"#!/bin/sh\n").unwrap();

        assert_eq!(server_binary(dir.path()), Some(nested.join(name)));
    }

    #[test]
    fn reports_no_binary_when_the_engine_is_not_unpacked() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(server_binary(dir.path()), None);
    }
}
