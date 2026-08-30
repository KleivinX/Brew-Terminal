//! Running the downloaded inference server.
//!
//! The server is bound to `127.0.0.1` and nothing else. That is not a default being accepted —
//! it is passed explicitly on every launch, because a model server listening on `0.0.0.0` would
//! quietly expose an unauthenticated endpoint to the whole network. AI_POLICY.md §1 treats
//! "local means local" as a guarantee, and this is where it is kept.
//!
//! Once running it is an ordinary OpenAI-compatible endpoint on loopback, so the existing
//! adapter talks to it unchanged and the "Local · offline" label resolves the same way it does
//! for someone running their own Ollama.

use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;

use crate::error::{AppError, AppResult};

/// The port the local server is asked for.
///
/// Deliberately not 11434 (Ollama) or 8080 (everything else), so starting this does not collide
/// with a server the user is already running.
pub const ENGINE_PORT: u16 = 11821;

pub fn endpoint() -> String {
    format!("http://127.0.0.1:{ENGINE_PORT}/v1")
}

/// How long to wait for a freshly started server to load its weights and answer.
///
/// The 0.5B model loads in about three seconds on the reference machine; a larger one on a cold
/// page cache takes appreciably longer, so this is generous. It is a ceiling, not a delay —
/// `wait_until_ready` returns the moment `/health` answers.
const READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);
const READY_POLL: std::time::Duration = std::time::Duration::from_millis(500);

/// Polls the server's own `/health` until it answers, the process dies, or time runs out.
///
/// The app used to report "Running" as soon as the process existed. That is not the same
/// thing: `llama-server` binds and logs "listening" only after the weights are loaded, so for
/// the first few seconds the Model Desk would have been pointed at an endpoint that refuses
/// connections. Asking the server rather than guessing a sleep is the difference between a
/// status that is true and one that is merely usually true.
///
/// The client here is built without `https_only` on purpose: this address is `127.0.0.1` and
/// no local model server ships a certificate. That is the same reasoning as
/// `providers::ai::build_client`, and it applies for the same reason — the traffic cannot
/// leave the machine.
pub async fn wait_until_ready(process: &EngineProcess) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    else {
        return false;
    };

    let health = format!("http://127.0.0.1:{ENGINE_PORT}/health");
    let deadline = std::time::Instant::now() + READY_TIMEOUT;

    while std::time::Instant::now() < deadline {
        // A server that has died is never going to become ready, so stop waiting for it.
        if !process.is_running() {
            return false;
        }
        if matches!(client.get(&health).send().await, Ok(r) if r.status().is_success()) {
            return true;
        }
        tokio::time::sleep(READY_POLL).await;
    }

    false
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub installed: bool,
    pub running: bool,
    /// The model id currently loaded, if any.
    pub loaded_model: Option<String>,
    pub endpoint: String,
    pub build: &'static str,
    pub project: &'static str,
    pub licence: &'static str,
    pub source_url: &'static str,
}

/// The running server, if there is one.
///
/// A `Mutex<Option<Child>>` rather than anything cleverer: there is at most one, and every
/// transition happens on a user action.
#[derive(Default)]
pub struct EngineProcess {
    child: Mutex<Option<Child>>,
    loaded_model: Mutex<Option<String>>,
}

impl EngineProcess {
    pub fn is_running(&self) -> bool {
        let mut guard = match self.child.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        let Some(child) = guard.as_mut() else {
            return false;
        };

        // `try_wait` reaps a process that has already exited, so a crashed server reports as
        // stopped rather than as running forever.
        match child.try_wait() {
            Ok(Some(_)) => {
                *guard = None;
                false
            }
            Ok(None) => true,
            Err(_) => false,
        }
    }

    pub fn loaded_model(&self) -> Option<String> {
        self.loaded_model
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or(None)
    }

    /// The last few lines the server wrote before exiting, if any.
    ///
    /// This is what turns "it did not start" into something a user can act on.
    pub fn last_error_output(&self, log_path: &Path) -> Option<String> {
        let text = std::fs::read_to_string(log_path).ok()?;
        let tail: Vec<&str> = text
            .lines()
            .filter(|line| !line.trim().is_empty())
            .rev()
            .take(6)
            .collect();
        if tail.is_empty() {
            return None;
        }
        Some(tail.into_iter().rev().collect::<Vec<_>>().join("\n"))
    }

    /// Starts the server against `model_path`, replacing anything already running.
    ///
    /// `log_path` receives the server's own stdout and stderr. Discarding them — which this
    /// did at first — means a server that dies on startup leaves nothing behind but "it did
    /// not start", which is useless to the user and was useless to the person debugging it.
    pub fn start(
        &self,
        binary: &Path,
        model_path: &Path,
        model_id: &str,
        log_path: &Path,
    ) -> AppResult<()> {
        self.stop();

        if !binary.exists() {
            return Err(AppError::Storage(
                "The engine is not installed. Download it first.".into(),
            ));
        }
        if !model_path.exists() {
            return Err(AppError::Storage(
                "That model is not downloaded yet.".into(),
            ));
        }

        let mut command = Command::new(binary);
        command
            .arg("--model")
            .arg(model_path)
            // Explicit, not defaulted. See the module comment.
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(ENGINE_PORT.to_string())
            // A small window keeps memory within reach of the reference machine. The Model
            // Desk's own prompt budget is well inside this.
            .arg("--ctx-size")
            .arg("4096")
            .stdin(Stdio::null());

        // Both streams go to one file, appended, so the ordering between them is preserved.
        match std::fs::File::create(log_path) {
            Ok(file) => {
                let err = file.try_clone().map_err(|error| {
                    AppError::Storage(format!("could not prepare the server log: {error}"))
                })?;
                command.stdout(Stdio::from(file)).stderr(Stdio::from(err));
            }
            Err(error) => {
                // A missing log is not a reason to refuse to start, but it is worth saying.
                tracing::warn!(
                    ?error,
                    "could not open the server log; output will be dropped"
                );
                command.stdout(Stdio::null()).stderr(Stdio::null());
            }
        }

        // Without this the server would inherit the app's console on Windows and flash one up.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let child = command.spawn().map_err(|error| {
            tracing::warn!(?error, "could not start the local model server");
            AppError::Storage("The local model server could not be started.".into())
        })?;

        if let Ok(mut guard) = self.child.lock() {
            *guard = Some(child);
        }
        if let Ok(mut guard) = self.loaded_model.lock() {
            *guard = Some(model_id.to_string());
        }

        tracing::info!(
            model = model_id,
            port = ENGINE_PORT,
            "local model server started"
        );
        Ok(())
    }

    /// Stops the server if one is running. Safe to call when nothing is.
    pub fn stop(&self) {
        let mut guard = match self.child.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            // Reaped so it does not linger as a zombie for the app's lifetime.
            let _ = child.wait();
            tracing::info!("local model server stopped");
        }

        if let Ok(mut loaded) = self.loaded_model.lock() {
            *loaded = None;
        }
    }
}

/// The server is killed when the app exits, so closing Brew Terminal does not leave a model
/// resident in memory.
impl Drop for EngineProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_endpoint_is_loopback_and_openai_shaped() {
        let endpoint = endpoint();
        assert!(endpoint.starts_with("http://127.0.0.1:"));
        assert!(endpoint.ends_with("/v1"));
    }

    #[test]
    fn the_port_avoids_the_common_ones() {
        // Colliding with Ollama's 11434 or a stray 8080 would make "start" fail for reasons
        // the user cannot see.
        assert_ne!(ENGINE_PORT, 11434);
        assert_ne!(ENGINE_PORT, 8080);
    }

    #[test]
    fn nothing_is_running_before_anything_starts() {
        let engine = EngineProcess::default();
        assert!(!engine.is_running());
        assert_eq!(engine.loaded_model(), None);
    }

    #[test]
    fn stopping_when_nothing_runs_is_harmless() {
        let engine = EngineProcess::default();
        engine.stop();
        engine.stop();
        assert!(!engine.is_running());
    }

    #[test]
    fn starting_without_an_engine_binary_fails_clearly() {
        let dir = tempfile::tempdir().unwrap();
        let engine = EngineProcess::default();

        let result = engine.start(
            &dir.path().join("missing-binary"),
            &dir.path().join("missing-model"),
            "some-model",
            &dir.path().join("server.log"),
        );

        assert!(matches!(result, Err(AppError::Storage(_))));
        assert!(!engine.is_running());
    }

    #[test]
    fn starting_without_the_model_fails_before_spawning_anything() {
        let dir = tempfile::tempdir().unwrap();
        let binary = dir.path().join("llama-server");
        std::fs::write(&binary, b"#!/bin/sh\nexit 0\n").unwrap();

        let engine = EngineProcess::default();
        let result = engine.start(
            &binary,
            &dir.path().join("absent.gguf"),
            "some-model",
            &dir.path().join("server.log"),
        );

        assert!(matches!(result, Err(AppError::Storage(_))));
        assert!(!engine.is_running());
    }
}
