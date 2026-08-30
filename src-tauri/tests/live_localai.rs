//! End-to-end checks for the local model path.
//!
//! **Ignored by default.** These download real files — the engine is about 11 MB and the
//! smallest model about 470 MB — so they are not part of CI: nobody's build should pull half a
//! gigabyte, and a publisher outage is not a reason to fail.
//!
//! They exist because every other test of this feature proves a *part* of it. The catalogue's
//! checksums, the downloader's resume logic, archive traversal defence and the supervisor's
//! refusals are all covered by unit tests over fixtures. Nothing else proves the pinned URL
//! still resolves, the pinned checksum still matches what the publisher serves, the archive
//! still contains a `llama-server` where the code looks for one, or that the thing actually
//! starts and answers.
//!
//! ```bash
//! # The engine only — ~11 MB, quick.
//! cargo test --test live_localai -- --ignored --nocapture engine
//!
//! # Everything, including a ~470 MB model download and a real completion.
//! cargo test --test live_localai -- --ignored --nocapture
//! ```

use std::sync::Arc;

use brew_terminal_lib::localai::{catalogue, download, engine, store};
use brew_terminal_lib::providers::http;

/// The download client, not the general one: the general client caps a whole request at 15
/// seconds, which no multi-hundred-megabyte download can meet. Using the wrong one here is the
/// bug this test found in the first place.
fn client() -> reqwest::Client {
    http::build_download_client().expect("client")
}

/// A scratch directory that is not the user's real app data directory.
fn scratch() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

/// Lets a cached engine directory and model file stand in for a fresh download.
///
/// Re-fetching 470 MB on every run makes this test something nobody runs twice, which defeats
/// the point of having it. Set both to iterate:
///
/// ```bash
/// BREW_TEST_ENGINE_DIR=/path/to/unpacked BREW_TEST_MODEL=/path/to/model.gguf \
///   cargo test --test live_localai -- --ignored --nocapture
/// ```
fn cached(var: &str) -> Option<std::path::PathBuf> {
    let path = std::path::PathBuf::from(std::env::var_os(var)?);
    path.exists().then_some(path)
}

#[tokio::test]
#[ignore = "downloads the real engine (~11 MB)"]
async fn engine_downloads_verifies_and_unpacks_to_a_usable_binary() {
    let asset = catalogue::engine_for_this_platform().expect("no engine pinned for this platform");
    let dir = scratch();
    let target = dir.path().join("engine");

    let archive = target.join(match asset.archive {
        catalogue::ArchiveKind::Zip => "engine.zip",
        catalogue::ArchiveKind::TarGz => "engine.tar.gz",
    });

    println!("downloading {}", asset.url);
    let outcome = download::fetch_verified(
        &client(),
        asset.url,
        &archive,
        asset.sha256,
        Arc::new(download::DownloadHandle::default()),
    )
    .await
    .expect("the engine download failed — the pinned URL or checksum may be stale");

    assert_eq!(outcome, download::Outcome::Complete);

    // The size recorded in the catalogue is what the publisher actually serves.
    let written = std::fs::metadata(&archive).expect("archive").len();
    assert_eq!(
        written, asset.size_bytes,
        "the catalogue records {} bytes but the publisher served {written}",
        asset.size_bytes
    );

    match asset.archive {
        catalogue::ArchiveKind::TarGz => {
            brew_terminal_lib::localai::archive::extract_tar_gz(&archive, &target)
        }
        catalogue::ArchiveKind::Zip => {
            brew_terminal_lib::localai::archive::extract_zip(&archive, &target)
        }
    }
    .expect("the engine archive did not unpack");

    let binary = store::server_binary(&target)
        .expect("no llama-server found in the archive — the layout may have moved upstream");
    println!("found the server at {}", binary.display());

    assert!(binary.exists());
}

#[tokio::test]
#[ignore = "downloads real model weights (~470 MB)"]
async fn the_smallest_model_downloads_and_matches_its_published_checksum() {
    let model = &catalogue::MODELS[0];
    let dir = scratch();
    let dest = dir.path().join(model.file_name);

    println!(
        "downloading {} ({} MB)",
        model.name,
        model.size_bytes / 1_000_000
    );
    download::fetch_verified(
        &client(),
        model.url,
        &dest,
        model.sha256,
        Arc::new(download::DownloadHandle::default()),
    )
    .await
    .expect("the model download failed — the pinned URL or checksum may be stale");

    let written = std::fs::metadata(&dest).expect("model").len();
    assert_eq!(
        written, model.size_bytes,
        "size does not match the catalogue"
    );

    // `fetch_verified` already checked this, but recomputing here proves the file on disk is
    // the verified one rather than something written afterwards.
    assert_eq!(
        download::hash_file(&dest).expect("hash"),
        model.sha256,
        "the file on disk does not match its published checksum"
    );
}

/// The whole path: engine, weights, a running server, and an answer.
#[tokio::test]
#[ignore = "downloads ~480 MB and runs a model"]
async fn a_downloaded_model_serves_a_completion_on_loopback() {
    let asset = catalogue::engine_for_this_platform().expect("no engine for this platform");
    let model = &catalogue::MODELS[0];
    let dir = scratch();

    // --- engine ---
    let engine_dir = match cached("BREW_TEST_ENGINE_DIR") {
        Some(dir) => {
            println!("using the cached engine at {}", dir.display());
            dir
        }
        None => {
            let engine_dir = dir.path().join("engine");
            let archive = engine_dir.join(match asset.archive {
                catalogue::ArchiveKind::Zip => "engine.zip",
                catalogue::ArchiveKind::TarGz => "engine.tar.gz",
            });
            download::fetch_verified(
                &client(),
                asset.url,
                &archive,
                asset.sha256,
                Arc::new(download::DownloadHandle::default()),
            )
            .await
            .expect("engine download");

            match asset.archive {
                catalogue::ArchiveKind::TarGz => {
                    brew_terminal_lib::localai::archive::extract_tar_gz(&archive, &engine_dir)
                }
                catalogue::ArchiveKind::Zip => {
                    brew_terminal_lib::localai::archive::extract_zip(&archive, &engine_dir)
                }
            }
            .expect("engine unpack");
            engine_dir
        }
    };

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let binary = store::server_binary(&engine_dir).expect("server binary");
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }

    let binary = store::server_binary(&engine_dir).expect("server binary");

    // --- weights ---
    let model_path = match cached("BREW_TEST_MODEL") {
        Some(path) => {
            println!("using the cached model at {}", path.display());
            path
        }
        None => {
            let model_path = dir.path().join(model.file_name);
            download::fetch_verified(
                &client(),
                model.url,
                &model_path,
                model.sha256,
                Arc::new(download::DownloadHandle::default()),
            )
            .await
            .expect("model download");
            model_path
        }
    };

    // --- run ---
    // The log lives outside the temp dir's cleanup path so a failure can be explained.
    let log_path = dir.path().join("llama-server.log");
    let process = engine::EngineProcess::default();
    process
        .start(&binary, &model_path, model.id, &log_path)
        .expect("the server did not start");

    // A plain client, not `client()`: that one is https_only, and the local server speaks
    // plain HTTP on loopback. Using the wrong one here is what made this test report the
    // server as dead while its own log said "listening".
    let local = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("client");

    // Loading weights takes a while on a cold cache; poll rather than guessing a sleep.
    let client = local;
    let health = format!("http://127.0.0.1:{}/health", engine::ENGINE_PORT);
    let mut ready = false;
    for attempt in 0..60 {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        if matches!(client.get(&health).send().await, Ok(r) if r.status().is_success()) {
            println!("server ready after {}s", attempt * 2);
            ready = true;
            break;
        }
        if !process.is_running() {
            panic!(
                "the server exited before becoming ready.
--- server output ---
{}",
                std::fs::read_to_string(&log_path).unwrap_or_default()
            );
        }
    }
    if !ready {
        panic!(
            "the server never became ready.\n--- server output ---\n{}",
            std::fs::read_to_string(&log_path).unwrap_or_default()
        );
    }

    // --- ask it something ---
    let body = serde_json::json!({
        "model": model.id,
        "messages": [{ "role": "user", "content": "Reply with the single word: ready" }],
        "max_tokens": 16,
        "stream": false,
    });

    let response: serde_json::Value = client
        .post(format!(
            "http://127.0.0.1:{}/v1/chat/completions",
            engine::ENGINE_PORT
        ))
        .json(&body)
        .send()
        .await
        .expect("completion request failed")
        .json()
        .await
        .expect("completion response was not JSON");

    let content = response["choices"][0]["message"]["content"]
        .as_str()
        .expect("no assistant message in the response");

    println!("model replied: {content:?}");
    assert!(!content.trim().is_empty(), "the model returned nothing");

    process.stop();
    assert!(!process.is_running(), "the server should stop on request");
}
