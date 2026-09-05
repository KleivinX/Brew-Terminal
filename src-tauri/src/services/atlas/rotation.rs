//! The rotation policy: which provider answers the next Atlas request, and why.
//!
//! Atlas needs a quote roughly every ninety seconds for as long as the window is open. No free
//! tier will carry that alone — not because the data is unavailable but because real-time market
//! data is licensed, and a free tier is a sample rather than a supply. So Atlas spreads the load
//! across the tiers this project has already reviewed, and steps aside from one the moment it
//! says no.
//!
//! This module is deliberately pure. It holds no client, makes no request and reads no clock:
//! `now` is a parameter. That is what makes a rate-limit policy testable — the failure modes
//! worth catching are all about time (a window that never rolls, a backoff that never expires, a
//! daily cap that resets in the wrong timezone) and none of them are reproducible against a real
//! clock and a real API.
//!
//! **What it will not do.** It never treats an allowance as a target to be spent. Every ceiling
//! here is below what the provider publishes, and a provider that returns 429 is rested for
//! longer than it asked rather than retried at the edge of its limit. The point is to stay a
//! well-behaved client of four free services, not to extract the maximum from them.

use serde::Serialize;

use crate::models::AssetType;

/// What a provider is permitted, as recorded in `docs/PROVIDERS.md`.
///
/// The figures here are **below** each published limit on purpose. A client that runs at exactly
/// the documented ceiling is one clock-skew away from a 429, and the margin costs nothing at
/// Atlas's cadence.
#[derive(Debug, Clone, Copy)]
pub struct Allowance {
    pub provider_id: &'static str,
    pub provider_name: &'static str,
    /// Calls permitted inside `window_secs`.
    pub per_window: u32,
    pub window_secs: i64,
    /// A hard daily ceiling, where the provider publishes one.
    pub per_day: Option<u32>,
    /// Which markets this provider can answer for.
    pub serves: &'static [AssetType],
    /// True when the provider is unusable without a credential the user may not have set.
    pub needs_key: bool,
    /// Whether one call answers for many symbols.
    ///
    /// This decides what a tick actually costs, and the two providers here differ completely:
    /// CoinGecko's `/coins/markets` returns a whole watchlist for one call, while Finnhub's
    /// `/quote` takes one symbol per call, so twelve symbols is twelve calls. A manager that
    /// counted ticks rather than calls would be wrong by a factor of the watchlist length on
    /// the equities side.
    pub batches: bool,
    /// Ordering. Lower goes first; ties are resolved by position in the table.
    pub priority: u8,
}

/// Why a provider is not currently answering.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case", tag = "kind", content = "until")]
pub enum Unavailable {
    /// No credential configured. Not a failure — the user simply has not set one up.
    NeedsKey,
    /// This provider does not serve the market being asked about.
    WrongMarket,
    /// Said 429, or failed repeatedly. Resting until the given time.
    #[cfg_attr(test, ts(type = "number"))]
    Resting(i64),
    /// The per-minute allowance is spent. Frees at the given time.
    #[cfg_attr(test, ts(type = "number"))]
    WindowSpent(i64),
    /// The daily allowance is spent. Frees at the given time.
    #[cfg_attr(test, ts(type = "number"))]
    DaySpent(i64),
}

/// Whether a provider can take the next request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Availability {
    Ready,
    Blocked(Unavailable),
}

/// What has actually happened to one provider.
///
/// Counters are held rather than derived from a log of calls: Atlas asks this question on every
/// tick and the answer has to be O(1), not a scan.
#[derive(Debug, Clone, Default)]
pub struct Usage {
    window_started: i64,
    in_window: u32,
    day_started: i64,
    today: u32,
    resting_until: Option<i64>,
    consecutive_failures: u32,
}

/// The shortest rest after a 429 that did not say how long to wait.
///
/// A provider that has just refused is not asked again in the same minute. Sixty seconds is the
/// window length of every per-minute tier here, so this is "sit out one full window".
const BASE_REST_SECS: i64 = 60;

/// The longest rest. Beyond this the provider is effectively out of the rotation for the
/// session, and continuing to double achieves nothing except making recovery slower than the
/// outage.
const MAX_REST_SECS: i64 = 15 * 60;

/// Consecutive ordinary failures before a provider is rested.
///
/// One failure is a blip — a dropped connection, a slow DNS answer — and rotating away on it
/// would empty the queue on a flaky café network. Three in a row is a provider that is not
/// working.
const FAILURES_BEFORE_REST: u32 = 3;

/// Seconds in a day, for the daily-cap rollover.
const DAY_SECS: i64 = 86_400;

impl Usage {
    /// Rolls the per-window and per-day counters forward to `now`.
    ///
    /// Called before every read so a stale counter can never block a provider that has in fact
    /// been idle. Windows are fixed rather than sliding — a sliding window needs the timestamp
    /// of every call, and at these volumes the difference is one extra call per minute in the
    /// worst case, which the margin below each published limit already absorbs.
    fn roll(&mut self, now: i64, allowance: &Allowance) {
        if now.saturating_sub(self.window_started) >= allowance.window_secs {
            self.window_started = now;
            self.in_window = 0;
        }

        // The day boundary is UTC midnight, not "24 hours since the first call". A provider
        // that documents a daily cap resets it on a calendar day, and a rolling 24-hour window
        // would drift an hour later every day until it no longer resembled either.
        let today_start = now - now.rem_euclid(DAY_SECS);
        if self.day_started != today_start {
            self.day_started = today_start;
            self.today = 0;
        }

        if let Some(until) = self.resting_until {
            if now >= until {
                self.resting_until = None;
                self.consecutive_failures = 0;
            }
        }
    }

    /// Whether this provider can take the next request.
    pub fn availability(&mut self, now: i64, allowance: &Allowance, has_key: bool) -> Availability {
        self.roll(now, allowance);

        if allowance.needs_key && !has_key {
            return Availability::Blocked(Unavailable::NeedsKey);
        }
        if let Some(until) = self.resting_until {
            return Availability::Blocked(Unavailable::Resting(until));
        }
        if let Some(cap) = allowance.per_day {
            if self.today >= cap {
                return Availability::Blocked(Unavailable::DaySpent(self.day_started + DAY_SECS));
            }
        }
        if self.in_window >= allowance.per_window {
            return Availability::Blocked(Unavailable::WindowSpent(
                self.window_started + allowance.window_secs,
            ));
        }

        Availability::Ready
    }

    /// Books a call against both counters.
    ///
    /// Called when the request is *made*, not when it succeeds. A request that fails still
    /// consumed the allowance — the provider counted it — and booking on success would let a
    /// run of failures blow straight through a daily cap.
    pub fn record_call(&mut self, now: i64, allowance: &Allowance) {
        self.roll(now, allowance);
        self.in_window = self.in_window.saturating_add(1);
        self.today = self.today.saturating_add(1);
    }

    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
    }

    /// Rests the provider after it returned 429.
    ///
    /// `retry_after` is honoured when the provider sends one, and a floor is applied under it:
    /// a `Retry-After: 1` from a provider that has just refused is not an invitation to try
    /// again next second. Without a header the rest doubles per consecutive refusal.
    pub fn record_rate_limited(&mut self, now: i64, retry_after_secs: Option<u64>) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);

        let backoff = match retry_after_secs {
            Some(secs) => (secs as i64).max(BASE_REST_SECS),
            None => {
                let doublings = self.consecutive_failures.saturating_sub(1).min(8);
                BASE_REST_SECS.saturating_mul(1_i64 << doublings)
            }
        };

        self.resting_until = Some(now + backoff.min(MAX_REST_SECS));
    }

    /// Records an ordinary failure, resting the provider once they stop looking like a blip.
    pub fn record_failure(&mut self, now: i64) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        if self.consecutive_failures >= FAILURES_BEFORE_REST {
            let doublings = (self.consecutive_failures - FAILURES_BEFORE_REST).min(8);
            let backoff = BASE_REST_SECS.saturating_mul(1_i64 << doublings);
            self.resting_until = Some(now + backoff.min(MAX_REST_SECS));
        }
    }

    /// How many symbols this provider can serve right now.
    ///
    /// For a batching provider that is "all of them, for one call". For a per-symbol provider
    /// it is however many calls are left, which is the number Atlas uses to decide how much of
    /// the watchlist it can refresh this tick and how much stays on its cached value.
    pub fn capacity(&mut self, now: i64, allowance: &Allowance, wanted: usize) -> usize {
        self.roll(now, allowance);
        if allowance.batches {
            return if self.in_window < allowance.per_window {
                wanted
            } else {
                0
            };
        }

        let per_window_left = allowance.per_window.saturating_sub(self.in_window) as usize;
        let per_day_left = allowance
            .per_day
            .map(|cap| cap.saturating_sub(self.today) as usize)
            .unwrap_or(usize::MAX);

        wanted.min(per_window_left).min(per_day_left)
    }

    /// Calls remaining in the current window, for the status line.
    pub fn window_remaining(&self, allowance: &Allowance) -> u32 {
        allowance.per_window.saturating_sub(self.in_window)
    }

    /// Calls remaining today, where a daily cap exists.
    pub fn day_remaining(&self, allowance: &Allowance) -> Option<u32> {
        allowance.per_day.map(|cap| cap.saturating_sub(self.today))
    }

    #[cfg(test)]
    pub fn resting_until(&self) -> Option<i64> {
        self.resting_until
    }
}

/// The provider chosen for a request, and the one waiting behind it.
#[derive(Debug, Clone, Copy)]
pub struct Route {
    pub chosen: &'static Allowance,
    /// The next provider that could take over right now, if there is one.
    ///
    /// Resolved eagerly rather than on failure because the status line promises it: telling the
    /// user a fallback is ready is a claim, and it should be one the app has actually checked.
    pub fallback: Option<&'static Allowance>,
}

/// Why no provider could take the request.
#[derive(Debug, Clone)]
pub struct NoRoute {
    /// Every candidate that serves this market, with the reason it stood down.
    pub blocked: Vec<(&'static str, Unavailable)>,
}

/// Picks the provider for the next request.
///
/// Order is by `priority`, then by position in the table — stable, so the same conditions always
/// produce the same route and a user watching the status line does not see it flap between two
/// equally-eligible providers.
///
/// `has_key` is a closure rather than a set because whether a credential exists is a keychain
/// question, and this module does not do I/O.
pub fn choose(
    now: i64,
    asset_type: AssetType,
    table: &'static [Allowance],
    usage: &mut std::collections::HashMap<&'static str, Usage>,
    has_key: &dyn Fn(&str) -> bool,
) -> Result<Route, NoRoute> {
    let mut candidates: Vec<&'static Allowance> = table
        .iter()
        .filter(|allowance| allowance.serves.contains(&asset_type))
        .collect();
    candidates.sort_by_key(|allowance| allowance.priority);

    let mut ready: Vec<&'static Allowance> = Vec::new();
    let mut blocked: Vec<(&'static str, Unavailable)> = Vec::new();

    for allowance in candidates {
        let state = usage.entry(allowance.provider_id).or_default();
        match state.availability(now, allowance, has_key(allowance.provider_id)) {
            Availability::Ready => ready.push(allowance),
            Availability::Blocked(reason) => blocked.push((allowance.provider_id, reason)),
        }
    }

    match ready.first() {
        Some(chosen) => Ok(Route {
            chosen,
            fallback: ready.get(1).copied(),
        }),
        None => Err(NoRoute { blocked }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const MINUTE: i64 = 60;

    static FAST: Allowance = Allowance {
        batches: false,
        provider_id: "fast",
        provider_name: "Fast",
        per_window: 3,
        window_secs: 60,
        per_day: None,
        serves: &[AssetType::Stock],
        needs_key: false,
        priority: 0,
    };

    static SLOW: Allowance = Allowance {
        batches: false,
        provider_id: "slow",
        provider_name: "Slow",
        per_window: 2,
        window_secs: 60,
        per_day: Some(4),
        serves: &[AssetType::Stock],
        needs_key: true,
        priority: 1,
    };

    static CRYPTO_ONLY: Allowance = Allowance {
        batches: true,
        provider_id: "crypto",
        provider_name: "Crypto",
        per_window: 5,
        window_secs: 60,
        per_day: None,
        serves: &[AssetType::Crypto],
        needs_key: false,
        priority: 0,
    };

    static TABLE: &[Allowance] = &[FAST, SLOW, CRYPTO_ONLY];

    fn keyed(_: &str) -> bool {
        true
    }

    fn keyless(_: &str) -> bool {
        false
    }

    fn route(now: i64, usage: &mut HashMap<&'static str, Usage>) -> Result<Route, NoRoute> {
        choose(now, AssetType::Stock, TABLE, usage, &keyed)
    }

    #[test]
    fn the_highest_priority_provider_answers_first() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        let route = route(0, &mut usage).unwrap();

        assert_eq!(route.chosen.provider_id, "fast");
        assert_eq!(
            route.fallback.map(|a| a.provider_id),
            Some("slow"),
            "the status line promises a fallback, so one has to have been checked"
        );
    }

    /// A provider that does not serve the market is never a candidate, and never appears as a
    /// fallback for it either.
    #[test]
    fn a_provider_for_another_market_is_not_offered() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        let stocks = route(0, &mut usage).unwrap();
        assert_ne!(stocks.chosen.provider_id, "crypto");
        assert_ne!(stocks.fallback.map(|a| a.provider_id), Some("crypto"));

        let crypto = choose(0, AssetType::Crypto, TABLE, &mut usage, &keyed).unwrap();
        assert_eq!(crypto.chosen.provider_id, "crypto");
        assert!(
            crypto.fallback.is_none(),
            "there is no second crypto source"
        );
    }

    #[test]
    fn spending_the_window_hands_over_to_the_next_provider() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();

        for _ in 0..FAST.per_window {
            let picked = route(0, &mut usage).unwrap();
            assert_eq!(picked.chosen.provider_id, "fast");
            usage.get_mut("fast").unwrap().record_call(0, &FAST);
        }

        let after = route(0, &mut usage).unwrap();
        assert_eq!(after.chosen.provider_id, "slow");
        assert!(after.fallback.is_none(), "nothing is left behind it");
    }

    /// The window is what makes this sustainable rather than a one-shot budget.
    #[test]
    fn the_window_frees_up_again_when_it_rolls() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        for _ in 0..FAST.per_window {
            usage.entry("fast").or_default().record_call(0, &FAST);
        }
        assert_eq!(route(30, &mut usage).unwrap().chosen.provider_id, "slow");

        assert_eq!(
            route(MINUTE, &mut usage).unwrap().chosen.provider_id,
            "fast",
            "a minute later the allowance is back"
        );
    }

    #[test]
    fn a_429_rests_the_provider_and_the_next_one_takes_over() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        usage
            .entry("fast")
            .or_default()
            .record_rate_limited(0, None);

        let after = route(1, &mut usage).unwrap();
        assert_eq!(after.chosen.provider_id, "slow");
    }

    /// A provider that has just refused is not asked again in the same minute, whatever its
    /// header says. `Retry-After: 1` is not an invitation.
    #[test]
    fn a_retry_after_is_honoured_but_never_below_the_floor() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        let state = usage.entry("fast").or_default();

        state.record_rate_limited(0, Some(1));
        assert_eq!(state.resting_until(), Some(BASE_REST_SECS));

        let mut other = Usage::default();
        other.record_rate_limited(0, Some(300));
        assert_eq!(
            other.resting_until(),
            Some(300),
            "a longer request is obeyed"
        );
    }

    #[test]
    fn repeated_refusals_back_off_further_each_time() {
        let mut state = Usage::default();

        state.record_rate_limited(0, None);
        assert_eq!(state.resting_until(), Some(BASE_REST_SECS));

        state.record_rate_limited(0, None);
        assert_eq!(state.resting_until(), Some(BASE_REST_SECS * 2));

        state.record_rate_limited(0, None);
        assert_eq!(state.resting_until(), Some(BASE_REST_SECS * 4));
    }

    /// Doubling forever makes recovery slower than the outage.
    #[test]
    fn the_backoff_is_capped() {
        let mut state = Usage::default();
        for _ in 0..20 {
            state.record_rate_limited(0, None);
        }
        assert_eq!(state.resting_until(), Some(MAX_REST_SECS));
    }

    #[test]
    fn a_rested_provider_comes_back_when_its_rest_is_over() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        usage
            .entry("fast")
            .or_default()
            .record_rate_limited(0, None);

        assert_eq!(route(1, &mut usage).unwrap().chosen.provider_id, "slow");
        assert_eq!(
            route(BASE_REST_SECS, &mut usage)
                .unwrap()
                .chosen
                .provider_id,
            "fast",
            "the rotation returns to the preferred provider rather than staying on the fallback"
        );
    }

    /// One failure is a dropped connection. Rotating away on it would empty the queue on a
    /// flaky network.
    #[test]
    fn a_single_failure_does_not_move_the_rotation() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        usage.entry("fast").or_default().record_failure(0);

        assert_eq!(route(0, &mut usage).unwrap().chosen.provider_id, "fast");
    }

    #[test]
    fn repeated_failures_do_rest_it() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        {
            let state = usage.entry("fast").or_default();
            for _ in 0..FAILURES_BEFORE_REST {
                state.record_failure(0);
            }
        }

        assert_eq!(route(0, &mut usage).unwrap().chosen.provider_id, "slow");
    }

    #[test]
    fn a_success_clears_the_failure_streak() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        {
            let state = usage.entry("fast").or_default();
            state.record_failure(0);
            state.record_failure(0);
            state.record_success();
            state.record_failure(0);
        }

        assert_eq!(
            route(0, &mut usage).unwrap().chosen.provider_id,
            "fast",
            "two before a success and one after is not three in a row"
        );
    }

    /// The tight-budget case Alpha Vantage is in. A daily cap has to survive the window rolling
    /// twenty times, or it is not a daily cap.
    #[test]
    fn a_daily_cap_holds_across_windows() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        let cap = SLOW.per_day.unwrap();

        let mut now = 0;
        for _ in 0..cap {
            usage.entry("slow").or_default().record_call(now, &SLOW);
            now += MINUTE;
        }

        let state = usage.entry("slow").or_default();
        assert!(
            matches!(
                state.availability(now, &SLOW, true),
                Availability::Blocked(Unavailable::DaySpent(_))
            ),
            "the per-minute window has rolled four times; the day has not"
        );
    }

    #[test]
    fn the_daily_cap_resets_at_utc_midnight() {
        let mut state = Usage::default();
        // 23:30 UTC.
        let late = 23 * 3_600 + 30 * 60;
        for _ in 0..SLOW.per_day.unwrap() {
            state.record_call(late, &SLOW);
        }
        assert!(matches!(
            state.availability(late, &SLOW, true),
            Availability::Blocked(Unavailable::DaySpent(_))
        ));

        // 00:30 the next day.
        let next = DAY_SECS + 30 * 60;
        assert_eq!(state.availability(next, &SLOW, true), Availability::Ready);
    }

    /// Not a failure, and not something to back off from. The user simply has not set a key up,
    /// and the status line should say that rather than "rate limited".
    #[test]
    fn a_provider_with_no_credential_stands_down_without_being_penalised() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        let picked = choose(0, AssetType::Stock, TABLE, &mut usage, &keyless).unwrap();

        assert_eq!(picked.chosen.provider_id, "fast", "this one needs no key");
        assert!(
            picked.fallback.is_none(),
            "the keyed provider is not a fallback while it has no key"
        );
    }

    #[test]
    fn every_provider_blocked_reports_why_rather_than_failing_silently() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        usage
            .entry("fast")
            .or_default()
            .record_rate_limited(0, None);

        let error = choose(1, AssetType::Stock, TABLE, &mut usage, &keyless).unwrap_err();
        let reasons: HashMap<_, _> = error.blocked.into_iter().collect();

        assert!(matches!(reasons.get("fast"), Some(Unavailable::Resting(_))));
        assert_eq!(reasons.get("slow"), Some(&Unavailable::NeedsKey));
    }

    /// A request that failed still consumed the allowance — the provider counted it. Booking on
    /// success would let a run of failures walk straight through a daily cap.
    #[test]
    fn a_call_is_booked_whether_or_not_it_worked() {
        let mut state = Usage::default();
        state.record_call(0, &SLOW);
        state.record_failure(0);

        assert_eq!(state.day_remaining(&SLOW), Some(SLOW.per_day.unwrap() - 1));
    }

    #[test]
    fn the_status_line_can_read_what_is_left() {
        let mut state = Usage::default();
        assert_eq!(state.window_remaining(&FAST), FAST.per_window);
        assert_eq!(state.day_remaining(&FAST), None, "no daily cap to report");

        state.record_call(0, &FAST);
        assert_eq!(state.window_remaining(&FAST), FAST.per_window - 1);
    }

    /// The number that actually decides what a tick costs. Finnhub serves one symbol per call,
    /// so a twelve-symbol watchlist is twelve calls — a manager counting ticks would be wrong by
    /// the length of the list.
    #[test]
    fn a_per_symbol_provider_can_only_afford_its_remaining_calls() {
        let mut state = Usage::default();
        assert_eq!(state.capacity(0, &FAST, 10), FAST.per_window as usize);

        state.record_call(0, &FAST);
        assert_eq!(state.capacity(0, &FAST, 10), (FAST.per_window - 1) as usize);
    }

    #[test]
    fn it_never_offers_more_capacity_than_was_asked_for() {
        let mut state = Usage::default();
        assert_eq!(state.capacity(0, &FAST, 1), 1);
    }

    /// One call answers for the whole watchlist, so the length of the list does not enter into
    /// it — the only question is whether there is a call left.
    #[test]
    fn a_batching_provider_serves_everything_for_one_call() {
        let mut state = Usage::default();
        assert_eq!(state.capacity(0, &CRYPTO_ONLY, 500), 500);

        for _ in 0..CRYPTO_ONLY.per_window {
            state.record_call(0, &CRYPTO_ONLY);
        }
        assert_eq!(state.capacity(0, &CRYPTO_ONLY, 500), 0);
    }

    /// The partial-tick case: a budget that covers part of the list refreshes that part, and
    /// the rest keeps its cached value rather than being dropped or faked.
    #[test]
    fn a_tight_budget_yields_a_partial_tick_rather_than_nothing() {
        let mut state = Usage::default();
        state.record_call(0, &FAST);
        state.record_call(0, &FAST);

        let capacity = state.capacity(0, &FAST, 12);
        assert_eq!(capacity, 1);
        assert!(capacity > 0, "a partial refresh beats an empty one");
    }

    #[test]
    fn a_daily_cap_also_limits_capacity() {
        // Spread across windows, so the per-minute allowance has rolled and only the daily cap
        // is still binding — otherwise this would be testing the window limit again.
        let mut state = Usage::default();
        let mut now = 0;
        for _ in 0..SLOW.per_day.unwrap() - 1 {
            state.record_call(now, &SLOW);
            now += MINUTE;
        }

        assert_eq!(state.capacity(now, &SLOW, 10), 1, "one left today");
    }

    /// Two providers that are equally eligible must not swap places between ticks — a status
    /// line that flickers between them reads as instability that is not there.
    #[test]
    fn the_route_is_stable_while_nothing_changes() {
        let mut usage: HashMap<&'static str, Usage> = HashMap::new();
        let first = route(0, &mut usage).unwrap().chosen.provider_id;

        for tick in 1..10 {
            assert_eq!(route(tick, &mut usage).unwrap().chosen.provider_id, first);
        }
    }
}
