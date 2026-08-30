//! Downloading large files with progress, resume and verification.
//!
//! Models are hundreds of megabytes and engines are tens. That size drives every decision here:
//!
//! * **Streamed to disk, never buffered in memory.** The shared `http::get_bytes` caps bodies at
//!   2 MB, which is right for an API response and useless for a 1 GB file, so this path writes
//!   chunks straight to a `.part` file.
//! * **Resumable.** A dropped connection halfway through a gigabyte must not mean starting
//!   again. Progress is kept in the `.part` file and continued with a `Range` header.
//! * **Verified before use.** The SHA-256 is computed while writing and checked against the
//!   catalogue. A mismatch deletes the file — a partial or substituted model is not something
//!   to leave lying around for a later run to pick up.
//! * **Cancellable.** A user who started a 1 GB download by mistake can stop it, and the
//!   partial file is kept so resuming is cheap.

use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

/// Shared handle to one download in flight.
#[derive(Debug, Default)]
pub struct DownloadHandle {
    pub downloaded: AtomicU64,
    pub total: AtomicU64,
    cancelled: AtomicBool,
}

impl DownloadHandle {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }
}

/// Why a download stopped.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome {
    Complete,
    Cancelled,
}

/// Streams `url` into `dest`, resuming if a `.part` file is already there.
///
/// `expected_sha256` is checked over the whole file before `dest` appears, so a file at `dest`
/// is always a verified one.
pub async fn fetch_verified(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_sha256: &str,
    handle: Arc<DownloadHandle>,
) -> AppResult<Outcome> {
    if dest.exists() {
        return Ok(Outcome::Complete);
    }

    let part = dest.with_extension("part");

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| AppError::Storage(format!("could not create the folder: {error}")))?;
    }

    // Resume from whatever is already on disk. The hash has to be recomputed over the existing
    // bytes as well, since it is only meaningful across the whole file.
    let existing = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    let mut hasher = Sha256::new();

    if existing > 0 {
        let mut file = std::fs::File::open(&part).map_err(|error| {
            AppError::Storage(format!("could not reopen the download: {error}"))
        })?;
        std::io::copy(&mut file, &mut hasher).map_err(|error| {
            AppError::Storage(format!("could not reread the download: {error}"))
        })?;
        tracing::info!(bytes = existing, "resuming a download");
    }

    let mut request = client.get(url);
    if existing > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing}-"));
    }

    let response = request.send().await.map_err(|error| {
        tracing::warn!(?error, "download request failed");
        AppError::Network {
            provider_id: "download".into(),
        }
    })?;

    let status = response.status();

    // A server that ignores the Range header replies 200 with the whole file. Starting over is
    // correct then — appending would corrupt it.
    let restart = existing > 0 && status != reqwest::StatusCode::PARTIAL_CONTENT;
    if restart {
        tracing::info!("the server ignored the range request; starting again");
        hasher = Sha256::new();
    }

    if !status.is_success() {
        return Err(AppError::ProviderError {
            provider_id: "download".into(),
            status: Some(status.as_u16()),
        });
    }

    let already = if restart { 0 } else { existing };
    let total = response.content_length().unwrap_or(0) + already;
    handle.total.store(total, Ordering::Relaxed);
    handle.downloaded.store(already, Ordering::Relaxed);

    let mut file = if already > 0 {
        std::fs::OpenOptions::new()
            .append(true)
            .open(&part)
            .map_err(|error| AppError::Storage(format!("could not append: {error}")))?
    } else {
        std::fs::File::create(&part)
            .map_err(|error| AppError::Storage(format!("could not create: {error}")))?
    };

    let mut response = response;
    let mut written = already;

    // `chunk()` rather than a stream: it needs no extra dependency and gives the same
    // back-pressure, one buffer at a time.
    loop {
        if handle.is_cancelled() {
            file.flush().ok();
            tracing::info!(
                bytes = written,
                "download cancelled; keeping the partial file"
            );
            return Ok(Outcome::Cancelled);
        }

        let chunk = response.chunk().await.map_err(|error| {
            tracing::warn!(?error, "download interrupted");
            AppError::Network {
                provider_id: "download".into(),
            }
        })?;

        let Some(chunk) = chunk else { break };

        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|error| AppError::Storage(format!("could not write: {error}")))?;

        written += chunk.len() as u64;
        handle.downloaded.store(written, Ordering::Relaxed);
    }

    file.flush()
        .map_err(|error| AppError::Storage(format!("could not flush: {error}")))?;
    drop(file);

    let actual = format!("{:x}", hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        // Deleted, not kept. A file that failed verification must not be resumable into
        // something that looks finished.
        let _ = std::fs::remove_file(&part);
        tracing::warn!(
            expected = expected_sha256,
            actual = %actual,
            "checksum mismatch; the download was discarded"
        );
        return Err(AppError::Storage(
            "The download did not match its published checksum and was discarded. \
             Try again — if it keeps happening, do not use the file."
                .into(),
        ));
    }

    // Rename last: `dest` existing means verified and complete, with no separate flag to
    // disagree with.
    std::fs::rename(&part, dest)
        .map_err(|error| AppError::Storage(format!("could not finish the download: {error}")))?;

    tracing::info!(bytes = written, "download complete and verified");
    Ok(Outcome::Complete)
}

/// SHA-256 of a file already on disk, as lowercase hex.
pub fn hash_file(path: &Path) -> AppResult<String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| AppError::Storage(format!("could not open the file: {error}")))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)
        .map_err(|error| AppError::Storage(format!("could not read the file: {error}")))?;
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_a_file_the_same_way_the_catalogue_records_them() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("f.bin");
        std::fs::write(&path, b"abc").unwrap();

        // The published SHA-256 of "abc".
        assert_eq!(
            hash_file(&path).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_handle_reports_cancellation() {
        let handle = DownloadHandle::default();
        assert!(!handle.is_cancelled());
        handle.cancel();
        assert!(handle.is_cancelled());
    }

    #[tokio::test]
    async fn an_existing_verified_file_is_not_downloaded_again() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("model.gguf");
        std::fs::write(&dest, b"already here").unwrap();

        // The URL is never reached: the early return fires before any request is built.
        let outcome = fetch_verified(
            &reqwest::Client::new(),
            "https://example.invalid/model.gguf",
            &dest,
            "irrelevant",
            Arc::new(DownloadHandle::default()),
        )
        .await
        .unwrap();

        assert_eq!(outcome, Outcome::Complete);
    }
}
