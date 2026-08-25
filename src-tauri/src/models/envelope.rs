use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Where a payload came from. `Mock` is never silently presentable as real: the UI renders a
/// fixtures badge and the status bar shows mock mode for the whole session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnvelopeSource {
    Live,
    Cache,
    Mock,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DegradedReason {
    RateLimited,
    Network,
    ProviderError,
    NotConfigured,
    InvalidResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Degraded {
    pub reason: DegradedReason,
    pub retry_after: Option<String>,
    /// User-safe. Produced by `AppError::user_message`, never by string-formatting a provider.
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeMeta {
    pub provider_id: String,
    pub provider_name: String,
    /// ISO 8601 UTC — when the data was retrieved, not when it was requested.
    pub fetched_at: String,
    pub source: EnvelopeSource,
    pub stale: bool,
    pub degraded: Option<Degraded>,
}

/// Every data-returning command replies with one of these.
///
/// This is the mechanism behind "no number renders without its provider and its age": the
/// frontend cannot obtain data without also receiving attribution, timestamp and degraded
/// state. Dropping provenance would take deliberate effort. See ARCHITECTURE.md §2.2.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope<T> {
    pub data: T,
    pub meta: EnvelopeMeta,
}

impl<T> Envelope<T> {
    pub fn fresh(data: T, provider_id: &str, provider_name: &str, source: EnvelopeSource) -> Self {
        Self {
            data,
            meta: EnvelopeMeta {
                provider_id: provider_id.to_string(),
                provider_name: provider_name.to_string(),
                fetched_at: now_iso8601(),
                source,
                stale: false,
                degraded: None,
            },
        }
    }

    /// Cached data past its TTL. The value is still returned — stale never means blank.
    pub fn stale_at(
        data: T,
        provider_id: &str,
        provider_name: &str,
        fetched_at: DateTime<Utc>,
    ) -> Self {
        Self {
            data,
            meta: EnvelopeMeta {
                provider_id: provider_id.to_string(),
                provider_name: provider_name.to_string(),
                fetched_at: fetched_at.to_rfc3339(),
                source: EnvelopeSource::Cache,
                stale: true,
                degraded: None,
            },
        }
    }

    pub fn with_degraded(mut self, degraded: Degraded) -> Self {
        self.meta.stale = true;
        self.meta.degraded = Some(degraded);
        self
    }
}

pub fn now_iso8601() -> String {
    Utc::now().to_rfc3339()
}

pub fn now_epoch_secs() -> i64 {
    Utc::now().timestamp()
}

/// Past its TTL but still the best value available.
pub fn is_stale(fetched_at_epoch: i64, ttl_seconds: i64, now_epoch: i64) -> bool {
    now_epoch - fetched_at_epoch > ttl_seconds
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ttl_boundary_is_not_yet_stale() {
        // Exactly at the TTL is still fresh; one second past it is not.
        assert!(!is_stale(1000, 60, 1060));
        assert!(is_stale(1000, 60, 1061));
    }

    #[test]
    fn clock_skew_does_not_report_stale() {
        // A timestamp from the future (clock skew, or a provider's own clock) must not
        // be treated as expired.
        assert!(!is_stale(2000, 60, 1000));
    }

    #[test]
    fn fresh_envelope_carries_attribution() {
        let envelope =
            Envelope::fresh(vec![1, 2, 3], "mock", "Mock provider", EnvelopeSource::Mock);
        assert_eq!(envelope.meta.provider_id, "mock");
        assert_eq!(envelope.meta.provider_name, "Mock provider");
        assert!(!envelope.meta.stale);
        assert!(envelope.meta.degraded.is_none());
    }

    #[test]
    fn degraded_envelope_is_always_stale() {
        let envelope =
            Envelope::fresh(0, "mock", "Mock", EnvelopeSource::Mock).with_degraded(Degraded {
                reason: DegradedReason::RateLimited,
                retry_after: None,
                message: "limit reached".into(),
            });
        assert!(
            envelope.meta.stale,
            "degraded data must never present as fresh"
        );
    }
}
