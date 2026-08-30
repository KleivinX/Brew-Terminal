//! The Model Desk's local-model workflow.
//!
//! Order matters in `download_model` and `start`: nothing becomes usable until it has been
//! verified, and nothing is started until both halves are present. See `localai`.

use std::sync::Arc;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::localai::{catalogue, download, engine, store};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelOverview {
    pub models: Vec<store::ModelStatus>,
    pub engine: engine::EngineStatus,
    #[cfg_attr(test, ts(type = "number"))]
    pub disk_used_bytes: u64,
    /// `false` on a platform with no pinned engine build, so the UI can say so rather than
    /// offering a download that cannot work.
    pub supported: bool,
}

/// Progress for whatever is downloading, if anything.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub item_id: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub downloaded_bytes: u64,
    #[cfg_attr(test, ts(type = "number"))]
    pub total_bytes: u64,
}

pub fn overview(state: &AppState) -> LocalModelOverview {
    let engine_dir = store::engine_dir(&state.data_dir);
    let binary = store::server_binary(&engine_dir);

    LocalModelOverview {
        models: store::model_statuses(&state.data_dir),
        engine: engine::EngineStatus {
            installed: binary.is_some(),
            running: state.engine.is_running(),
            loaded_model: state.engine.loaded_model(),
            endpoint: engine::endpoint(),
            build: catalogue::ENGINE_BUILD,
            project: catalogue::ENGINE_PROJECT,
            licence: catalogue::ENGINE_LICENCE,
            source_url: catalogue::ENGINE_SOURCE_URL,
        },
        disk_used_bytes: store::disk_usage(&state.data_dir),
        supported: catalogue::engine_for_this_platform().is_some(),
    }
}

pub fn progress(state: &AppState) -> Option<DownloadProgress> {
    let guard = state.downloads.lock().ok()?;
    let (id, handle) = guard.as_ref()?;
    Some(DownloadProgress {
        item_id: id.clone(),
        downloaded_bytes: handle.downloaded.load(std::sync::atomic::Ordering::Relaxed),
        total_bytes: handle.total.load(std::sync::atomic::Ordering::Relaxed),
    })
}

pub fn cancel_download(state: &AppState) {
    if let Ok(guard) = state.downloads.lock() {
        if let Some((_, handle)) = guard.as_ref() {
            handle.cancel();
        }
    }
}

/// Registers a download, refusing if one is already running.
fn begin(state: &AppState, id: &str) -> AppResult<Arc<download::DownloadHandle>> {
    let mut guard = state
        .downloads
        .lock()
        .map_err(|_| AppError::Storage("The download state is unavailable.".into()))?;

    if let Some((existing, handle)) = guard.as_ref() {
        // A finished download leaves its entry behind; only a live one blocks a new start.
        if !handle.is_cancelled()
            && handle.downloaded.load(std::sync::atomic::Ordering::Relaxed)
                < handle.total.load(std::sync::atomic::Ordering::Relaxed)
        {
            return Err(AppError::Validation {
                field: "download".into(),
                detail: format!("{existing} is already downloading. Wait for it to finish."),
            });
        }
    }

    let handle = Arc::new(download::DownloadHandle::default());
    *guard = Some((id.to_string(), handle.clone()));
    Ok(handle)
}

fn finish(state: &AppState) {
    if let Ok(mut guard) = state.downloads.lock() {
        *guard = None;
    }
}

/// Downloads and unpacks the inference engine for this platform.
pub async fn install_engine(state: &AppState) -> AppResult<LocalModelOverview> {
    let Some(asset) = catalogue::engine_for_this_platform() else {
        return Err(AppError::Validation {
            field: "platform".into(),
            detail: "No engine build is available for this kind of machine.".into(),
        });
    };

    let dir = store::engine_dir(&state.data_dir);
    if store::server_binary(&dir).is_some() {
        return Ok(overview(state));
    }

    let handle = begin(state, "engine")?;
    let archive_path = dir.join(if asset.archive == catalogue::ArchiveKind::Zip {
        "engine.zip"
    } else {
        "engine.tar.gz"
    });

    let result = download::fetch_verified(
        &state.registry.download_client(),
        asset.url,
        &archive_path,
        asset.sha256,
        handle,
    )
    .await;

    finish(state);

    match result? {
        download::Outcome::Cancelled => return Ok(overview(state)),
        download::Outcome::Complete => {}
    }

    // Unpacking is CPU- and disk-bound, so off the async runtime.
    let kind = asset.archive;
    let unpack_dir = dir.clone();
    let unpack_archive = archive_path.clone();
    tokio::task::spawn_blocking(move || match kind {
        catalogue::ArchiveKind::TarGz => {
            crate::localai::archive::extract_tar_gz(&unpack_archive, &unpack_dir)
        }
        catalogue::ArchiveKind::Zip => {
            crate::localai::archive::extract_zip(&unpack_archive, &unpack_dir)
        }
    })
    .await
    .map_err(|error| AppError::Storage(format!("unpacking failed: {error}")))??;

    // The archive is no longer needed once unpacked, and it is tens of megabytes.
    let _ = std::fs::remove_file(&archive_path);

    // Unix needs the executable bit; the tar crate preserves it, but a zip on a Unix host
    // would not, so this is set explicitly rather than assumed.
    #[cfg(unix)]
    if let Some(binary) = store::server_binary(&dir) {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755));
    }

    if store::server_binary(&dir).is_none() {
        return Err(AppError::Storage(
            "The engine unpacked but no server executable was found inside it.".into(),
        ));
    }

    Ok(overview(state))
}

/// Downloads one model's weights.
pub async fn download_model(state: &AppState, model_id: String) -> AppResult<LocalModelOverview> {
    let Some(entry) = catalogue::model_by_id(&model_id) else {
        return Err(AppError::NotFound);
    };

    let dest = store::model_path(&state.data_dir, entry);
    let handle = begin(state, &model_id)?;

    let result = download::fetch_verified(
        &state.registry.download_client(),
        entry.url,
        &dest,
        entry.sha256,
        handle,
    )
    .await;

    finish(state);
    result?;

    Ok(overview(state))
}

pub fn delete_model(state: &AppState, model_id: String) -> AppResult<LocalModelOverview> {
    // Deleting the weights out from under a running server would leave it serving a model
    // that no longer exists.
    if state.engine.loaded_model().as_deref() == Some(model_id.as_str()) {
        state.engine.stop();
    }

    store::delete_model(&state.data_dir, &model_id)?;
    Ok(overview(state))
}

pub async fn start(state: &AppState, model_id: String) -> AppResult<LocalModelOverview> {
    let Some(entry) = catalogue::model_by_id(&model_id) else {
        return Err(AppError::NotFound);
    };

    let dir = store::engine_dir(&state.data_dir);
    let Some(binary) = store::server_binary(&dir) else {
        return Err(AppError::Storage(
            "The engine is not installed. Download it first.".into(),
        ));
    };

    let log_path = store::engine_log_path(&state.data_dir);
    state.engine.start(
        &binary,
        &store::model_path(&state.data_dir, entry),
        &model_id,
        &log_path,
    )?;

    // Spawning is not the same as being able to answer: `llama-server` binds only after the
    // weights are loaded, which takes seconds. Waiting for its own `/health` means the
    // "Running" the UI shows is true rather than merely usually true.
    if !engine::wait_until_ready(&state.engine).await {
        let detail = state
            .engine
            .last_error_output(&log_path)
            .unwrap_or_else(|| "It gave no reason.".into());
        state.engine.stop();
        tracing::warn!(model = %model_id, "the model server never became ready");
        return Err(AppError::Storage(format!(
            "The model server started but never became ready.\n\n{detail}"
        )));
    }

    Ok(overview(state))
}

pub fn stop(state: &AppState) -> LocalModelOverview {
    state.engine.stop();
    overview(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    #[test]
    fn a_fresh_machine_has_nothing_installed_and_nothing_running() {
        let (state, _dir) = state();
        let view = overview(&state);

        assert!(!view.engine.installed);
        assert!(!view.engine.running);
        assert_eq!(view.engine.loaded_model, None);
        assert_eq!(view.disk_used_bytes, 0);
        assert!(view.models.iter().all(|m| !m.installed));
        assert!(view.supported, "the test platform should have an engine");
    }

    #[test]
    fn the_advertised_endpoint_is_loopback() {
        let (state, _dir) = state();
        assert!(overview(&state)
            .engine
            .endpoint
            .starts_with("http://127.0.0.1:"));
    }

    #[tokio::test]
    async fn starting_without_an_engine_says_so_rather_than_failing_obscurely() {
        let (state, _dir) = state();
        let result = start(&state, catalogue::MODELS[0].id.to_string()).await;

        match result {
            Err(AppError::Storage(message)) => {
                assert!(message.contains("engine"), "unhelpful message: {message}");
            }
            other => panic!("expected a storage error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn an_unknown_model_id_is_not_found() {
        let (state, _dir) = state();
        assert!(matches!(
            download_model(&state, "nope".into()).await,
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            delete_model(&state, "nope".into()),
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            start(&state, "nope".into()).await,
            Err(AppError::NotFound)
        ));
    }

    #[test]
    fn nothing_is_downloading_on_a_fresh_state() {
        let (state, _dir) = state();
        assert!(progress(&state).is_none());
        // Cancelling nothing must not panic.
        cancel_download(&state);
    }

    #[test]
    fn a_second_download_is_refused_while_one_is_in_flight() {
        let (state, _dir) = state();

        let handle = begin(&state, "first").unwrap();
        handle
            .total
            .store(1000, std::sync::atomic::Ordering::Relaxed);
        handle
            .downloaded
            .store(10, std::sync::atomic::Ordering::Relaxed);

        let second = begin(&state, "second");
        assert!(
            matches!(second, Err(AppError::Validation { .. })),
            "a concurrent download should be refused"
        );
    }

    #[test]
    fn progress_reports_the_item_actually_downloading() {
        let (state, _dir) = state();
        let handle = begin(&state, "engine").unwrap();
        handle
            .total
            .store(2048, std::sync::atomic::Ordering::Relaxed);
        handle
            .downloaded
            .store(512, std::sync::atomic::Ordering::Relaxed);

        let progress = progress(&state).unwrap();
        assert_eq!(progress.item_id, "engine");
        assert_eq!(progress.downloaded_bytes, 512);
        assert_eq!(progress.total_bytes, 2048);
    }

    #[test]
    fn deleting_a_model_reports_the_updated_view() {
        let (state, _dir) = state();
        let entry = &catalogue::MODELS[0];
        let path = store::model_path(&state.data_dir, entry);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"weights").unwrap();

        assert!(overview(&state).models.iter().any(|m| m.installed));

        let view = delete_model(&state, entry.id.to_string()).unwrap();
        assert!(view.models.iter().all(|m| !m.installed));
    }
}
