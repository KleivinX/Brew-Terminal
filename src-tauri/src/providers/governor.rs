//! Rate limiting, backoff and request admission.
//!
//! Pure decision logic with no I/O, so it is fully testable without a network. The governor is
//! the reason a free provider tier survives contact with a refreshing dashboard: it is the one
//! place that decides whether a request is allowed to leave the machine.

use std::time::Duration;

/// A provider's documented limits. Recorded from the provider's own documentation during the
/// terms review, not guessed. See ADR-008.
#[derive(Debug, Clone, Copy)]
pub struct RateLimitPolicy {
    pub requests_per_window: u32,
    pub window_secs: i64,
    pub max_backoff_secs: i64,
}

impl RateLimitPolicy {
    pub const fn new(requests_per_window: u32, window_secs: i64) -> Self {
        Self {
            requests_per_window,
            window_secs,
            max_backoff_secs: 300,
        }
    }

    /// Unlimited, for the mock provider and any local endpoint.
    pub const fn unlimited() -> Self {
        Self {
            requests_per_window: u32::MAX,
            window_secs: 60,
            max_backoff_secs: 300,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct RateLimitState {
    pub window_started_at: i64,
    pub request_count: u32,
    /// Set by a provider's own `Retry-After`. A hard gate, not a suggestion.
    pub retry_after_until: Option<i64>,
    pub consecutive_failures: u32,
    pub backoff_until: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Admission {
    Allow,
    /// Hold off; the caller serves cached data and surfaces a rate-limited state.
    Deny {
        retry_after_secs: i64,
    },
}

impl RateLimitState {
    /// Decides whether a request may proceed, and rolls the window when it has elapsed.
    pub fn admit(&mut self, policy: &RateLimitPolicy, now: i64) -> Admission {
        // A provider's explicit Retry-After outranks everything else we might infer.
        if let Some(until) = self.retry_after_until {
            if now < until {
                return Admission::Deny {
                    retry_after_secs: until - now,
                };
            }
            self.retry_after_until = None;
        }

        if let Some(until) = self.backoff_until {
            if now < until {
                return Admission::Deny {
                    retry_after_secs: until - now,
                };
            }
            self.backoff_until = None;
        }

        if now - self.window_started_at >= policy.window_secs {
            self.window_started_at = now;
            self.request_count = 0;
        }

        if self.request_count >= policy.requests_per_window {
            let retry_after_secs = policy.window_secs - (now - self.window_started_at);
            return Admission::Deny {
                retry_after_secs: retry_after_secs.max(1),
            };
        }

        self.request_count += 1;
        Admission::Allow
    }

    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
        self.backoff_until = None;
    }

    /// Exponential backoff with full jitter, capped. Jitter matters because several panels
    /// failing at once would otherwise retry in lockstep and hammer a recovering provider.
    pub fn record_failure(&mut self, policy: &RateLimitPolicy, now: i64, jitter: f64) -> i64 {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);

        let exponent = self.consecutive_failures.saturating_sub(1).min(10);
        let base = 1_i64 << exponent;
        let capped = base.min(policy.max_backoff_secs);
        let jittered = ((capped as f64) * jitter.clamp(0.0, 1.0)).round() as i64;
        let delay = jittered.max(1);

        self.backoff_until = Some(now + delay);
        delay
    }

    /// Applied when a provider returns 429 with a `Retry-After`.
    pub fn apply_retry_after(&mut self, now: i64, retry_after: Duration) {
        self.retry_after_until = Some(now + retry_after.as_secs() as i64);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_requests_up_to_the_limit() {
        let policy = RateLimitPolicy::new(3, 60);
        let mut state = RateLimitState::default();

        for _ in 0..3 {
            assert_eq!(state.admit(&policy, 1000), Admission::Allow);
        }
        assert!(matches!(state.admit(&policy, 1000), Admission::Deny { .. }));
    }

    #[test]
    fn window_rolls_over() {
        let policy = RateLimitPolicy::new(2, 60);
        let mut state = RateLimitState {
            window_started_at: 1000,
            ..Default::default()
        };

        state.admit(&policy, 1000);
        state.admit(&policy, 1000);
        assert!(matches!(state.admit(&policy, 1030), Admission::Deny { .. }));
        assert_eq!(state.admit(&policy, 1060), Admission::Allow, "new window");
    }

    #[test]
    fn deny_reports_a_useful_retry_hint() {
        let policy = RateLimitPolicy::new(1, 60);
        let mut state = RateLimitState {
            window_started_at: 1000,
            ..Default::default()
        };
        state.admit(&policy, 1000);

        match state.admit(&policy, 1010) {
            Admission::Deny { retry_after_secs } => assert_eq!(retry_after_secs, 50),
            other => panic!("expected Deny, got {other:?}"),
        }
    }

    #[test]
    fn provider_retry_after_outranks_the_window() {
        let policy = RateLimitPolicy::new(1000, 60);
        let mut state = RateLimitState::default();
        state.apply_retry_after(1000, Duration::from_secs(30));

        assert!(matches!(state.admit(&policy, 1010), Admission::Deny { .. }));
        assert_eq!(state.admit(&policy, 1031), Admission::Allow);
    }

    #[test]
    fn backoff_grows_exponentially_and_is_capped() {
        let policy = RateLimitPolicy::new(100, 60);
        let mut state = RateLimitState::default();

        // Full jitter (1.0) makes the growth observable; production uses a random factor.
        let first = state.record_failure(&policy, 0, 1.0);
        let second = state.record_failure(&policy, 0, 1.0);
        let third = state.record_failure(&policy, 0, 1.0);

        assert_eq!((first, second, third), (1, 2, 4));

        for _ in 0..20 {
            state.record_failure(&policy, 0, 1.0);
        }
        let capped = state.record_failure(&policy, 0, 1.0);
        assert!(capped <= policy.max_backoff_secs);
    }

    #[test]
    fn backoff_is_never_zero_even_with_no_jitter() {
        let policy = RateLimitPolicy::new(100, 60);
        let mut state = RateLimitState::default();
        // A zero delay would turn backoff into a tight retry loop.
        assert_eq!(state.record_failure(&policy, 0, 0.0), 1);
    }

    #[test]
    fn success_clears_backoff() {
        let policy = RateLimitPolicy::new(100, 60);
        let mut state = RateLimitState::default();

        state.record_failure(&policy, 1000, 1.0);
        assert!(state.backoff_until.is_some());

        state.record_success();
        assert!(state.backoff_until.is_none());
        assert_eq!(state.consecutive_failures, 0);
        assert_eq!(state.admit(&policy, 1000), Admission::Allow);
    }

    #[test]
    fn unlimited_policy_never_denies() {
        let policy = RateLimitPolicy::unlimited();
        let mut state = RateLimitState::default();
        for _ in 0..10_000 {
            assert_eq!(state.admit(&policy, 1000), Admission::Allow);
        }
    }
}
