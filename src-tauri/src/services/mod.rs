//! Service layer.
//!
//! Commands are thin `#[tauri::command]` wrappers; the logic lives here and takes `&AppState`
//! rather than `tauri::State`. That is what makes the full path — provider → validate → cache →
//! database → envelope — reachable from an integration test without standing up a Tauri app.
//!
//! Matches the chain documented in ARCHITECTURE.md §7:
//! command → service → governor → adapter → validator → normalizer → domain model.

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
pub mod notes;
pub mod portfolio;
pub mod profile;
pub mod screener;
pub mod sentiment;
pub mod settings;
pub mod updates;
pub mod watchlist;

use crate::error::AppError;
use crate::models::{Degraded, DegradedReason};

/// Maps a provider failure onto the envelope's `degraded` field.
///
/// This is the mechanism behind "never silently fail a provider request": a failure becomes a
/// visible, explained state attached to whatever data we can still show, rather than an empty
/// panel or a swallowed error. The message comes from `AppError`, which guarantees it is
/// user-safe. See ARCHITECTURE.md §11.
pub fn degraded_from(error: &AppError) -> Option<Degraded> {
    let (reason, retry_after_secs) = match error {
        AppError::NotConfigured { .. } => (DegradedReason::NotConfigured, None),
        AppError::RateLimited {
            retry_after_secs, ..
        } => (DegradedReason::RateLimited, *retry_after_secs),
        AppError::Network { .. } => (DegradedReason::Network, None),
        AppError::ProviderError { .. } => (DegradedReason::ProviderError, None),
        AppError::InvalidResponse { .. } => (DegradedReason::InvalidResponse, None),
        // Storage, validation and not-found are genuine command failures, not degraded data.
        // They propagate as errors so the caller sees a failure rather than an empty table.
        _ => return None,
    };

    let retry_after = retry_after_secs
        .map(|secs| (chrono::Utc::now() + chrono::Duration::seconds(secs as i64)).to_rfc3339());

    Some(Degraded {
        reason,
        retry_after,
        message: user_message(error),
    })
}

fn user_message(error: &AppError) -> String {
    // Round-trips through the serializer so there is exactly one source of user-facing
    // wording, rather than a second copy that can drift out of step.
    serde_json::to_value(error)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "Something went wrong.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_failures_become_degraded_states() {
        let error = AppError::RateLimited {
            provider_id: "mock".into(),
            retry_after_secs: Some(30),
        };
        let degraded = degraded_from(&error).unwrap();

        assert_eq!(degraded.reason, DegradedReason::RateLimited);
        assert!(degraded.retry_after.is_some());
        assert!(!degraded.message.is_empty());
    }

    #[test]
    fn storage_failures_are_errors_not_degraded_data() {
        // A broken database is not "stale data" — surfacing it as degraded would show the
        // user an empty table with a soft warning instead of a real failure.
        assert!(degraded_from(&AppError::Storage("disk".into())).is_none());
        assert!(degraded_from(&AppError::NotFound).is_none());
    }

    #[test]
    fn degraded_message_never_carries_provider_internals() {
        let error = AppError::ProviderError {
            provider_id: "finnhub".into(),
            status: Some(403),
        };
        let degraded = degraded_from(&error).unwrap();
        assert!(!degraded.message.contains("403"));
    }
}
