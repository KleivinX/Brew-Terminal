//! Tauri command wrappers.
//!
//! Every command here is a thin adapter: unwrap `tauri::State` and delegate to the matching
//! service function. Keeping the logic out of this layer is what lets integration tests
//! exercise the real path — provider, cache, database, envelope — without a Tauri runtime.

pub mod ai;
pub mod alerts;
pub mod cache;
pub mod community;
pub mod csv_export;
pub mod feed_discovery;
pub mod learn;
pub mod local_models;
pub mod macro_data;
pub mod market;
pub mod news_feeds;
pub mod news_read;
pub mod notes;
pub mod portfolio;
pub mod profile;
pub mod saved_views;
pub mod screener;
pub mod sentiment;
pub mod settings;
pub mod watchlist;
