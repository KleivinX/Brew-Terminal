//! Downloading and running a model locally.
//!
//! The Model Desk has always been able to talk to a local OpenAI-compatible server; what it
//! could not do was get one. This module closes that gap without changing the shape of the
//! feature: it fetches an engine and weights the user picks, runs the engine on loopback, and
//! the existing adapter then talks to it exactly as it would to someone's own Ollama.
//!
//! The rules it keeps:
//!
//! * **Nothing is fetched until asked.** No catalogue refresh on launch, no background
//!   download, no update check on the engine.
//! * **Everything fetched is verified.** Pinned URL, pinned size, pinned SHA-256 — see
//!   `catalogue`.
//! * **Local means local.** The server binds `127.0.0.1` explicitly — see `engine`.
//! * **It is all deletable.** Weights are large and live in the app data directory; the UI
//!   shows the size and removes them on request.

pub mod archive;
pub mod catalogue;
pub mod download;
pub mod engine;
pub mod store;
