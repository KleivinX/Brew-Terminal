//! Atlas — a live ticker served by rotating free-tier providers.
//!
//! Real-time market data is licensed, so no free tier will carry a ticker refreshing every
//! ninety seconds on its own. Atlas spreads the load across the tiers this project has already
//! reviewed and steps aside from any one of them the moment it says no.
//!
//! `rotation.rs` holds the policy — pure, clock-injected, and where the tests are.
//! `catalogue.rs` holds what each provider is permitted, tied to `docs/PROVIDERS.md`.

use std::collections::HashMap;

use serde::Serialize;

use crate::error::AppResult;
use crate::models::{now_epoch_secs, AssetType, DegradedReason, Quote};
use crate::providers::registry::asset_type_of;
use crate::state::AppState;

pub mod catalogue;
pub mod rotation;

use rotation::{Unavailable, Usage};

/// Per-provider accounting, keyed by provider id.
pub type AtlasUsage = HashMap<&'static str, Usage>;

/// Which provider is serving Atlas, and what is behind it.
///
/// Rendered as the status line. The promise it makes — "fallback ready" — is checked rather
/// than assumed: `fallback` is only populated when a second provider could take the next
/// request right now.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct AtlasRoute {
    pub market: AssetType,
    pub provider_id: String,
    pub provider_name: String,
    /// The provider that would take over right now, if any.
    pub fallback_name: Option<String>,
    /// Calls left in the current minute.
    #[cfg_attr(test, ts(type = "number"))]
    pub window_remaining: u32,
    /// Calls left today, where the provider caps by day.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub day_remaining: Option<u32>,
    /// Populated instead of the rest when nothing could serve the request.
    pub blocked: Vec<AtlasBlocked>,
}

/// One provider that stood down, and why.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct AtlasBlocked {
    pub provider_name: String,
    /// A short phrase for the status line: "rate limited", "needs a key", "daily limit".
    pub reason: String,
    /// When it frees up, where that is known.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub until: Option<i64>,
}

fn describe(reason: Unavailable) -> (String, Option<i64>) {
    match reason {
        Unavailable::NeedsKey => ("needs a key".into(), None),
        Unavailable::WrongMarket => ("wrong market".into(), None),
        Unavailable::Resting(until) => ("rate limited".into(), Some(until)),
        Unavailable::WindowSpent(until) => ("minute limit".into(), Some(until)),
        Unavailable::DaySpent(until) => ("daily limit".into(), Some(until)),
    }
}

/// A tick of the Atlas ticker: the quotes, and the route that served them.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct AtlasSnapshot {
    pub quotes: Vec<Quote>,
    /// One entry per market represented in the request.
    pub routes: Vec<AtlasRoute>,
}

/// Takes the usage lock, recovering from poisoning.
///
/// A `std::sync::Mutex` rather than tokio's, deliberately: the guard is never held across an
/// await, and a synchronous lock makes that a compile error rather than a convention. Poisoning
/// is recovered from because these are rate-limit counters — a panic elsewhere in the process
/// does not make "Finnhub has used 4 of its 20 calls" untrue, and refusing to serve the ticker
/// over it would be a worse outcome than a slightly stale count.
fn lock_usage(state: &AppState) -> std::sync::MutexGuard<'_, AtlasUsage> {
    state
        .atlas
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Splits ids into the markets that answer for them, preserving the caller's order.
fn by_market(asset_ids: &[String]) -> Vec<(AssetType, Vec<String>)> {
    let mut crypto = Vec::new();
    let mut stocks = Vec::new();

    for id in asset_ids {
        match asset_type_of(id) {
            Some(AssetType::Crypto) => crypto.push(id.clone()),
            // Etf and Index route to the equity provider, the same as the rest of the app.
            Some(_) => stocks.push(id.clone()),
            None => {}
        }
    }

    let mut out = Vec::new();
    if !crypto.is_empty() {
        out.push((AssetType::Crypto, crypto));
    }
    if !stocks.is_empty() {
        out.push((AssetType::Stock, stocks));
    }
    out
}

/// One tick of the ticker.
///
/// The rotation manager decides two things per market: **whether** to ask a provider at all, and
/// **how many symbols** it can afford this tick. The second matters more than it looks — Finnhub
/// serves one symbol per call, so a twelve-symbol watchlist is twelve calls against a per-minute
/// allowance, and a manager that only counted ticks would be wrong by the length of the list.
///
/// Symbols beyond what the budget covers are not dropped and not faked: they come back from the
/// cache with their real age on them, and the route says the tick was partial. That is the whole
/// resilience story — a free tier that cannot carry the refresh rate degrades to older data
/// rather than to an error or, worse, to a number with no provenance.
pub async fn snapshot(state: &AppState, asset_ids: Vec<String>) -> AppResult<AtlasSnapshot> {
    let now = now_epoch_secs();
    let mut quotes: Vec<Quote> = Vec::new();
    let mut routes: Vec<AtlasRoute> = Vec::new();

    for (market, ids) in by_market(&asset_ids) {
        // The lock is taken, used, and dropped before any await. Holding it across a network
        // call would serialise every Atlas tick behind the slowest provider.
        let decision = {
            let mut usage = lock_usage(state);
            // The keychain is the authority on whether a keyed provider can be used at all.
            let has_key = |id: &str| crate::security::secrets::exists(id);

            match rotation::choose(now, market, catalogue::PROVIDERS, &mut usage, &has_key) {
                Ok(route) => {
                    let state_for = usage.entry(route.chosen.provider_id).or_default();
                    let capacity = state_for.capacity(now, route.chosen, ids.len());

                    // Booked before the request, not after: a call that fails still consumed
                    // the allowance, because the provider counted it.
                    let calls = if route.chosen.batches { 1 } else { capacity };
                    for _ in 0..calls {
                        state_for.record_call(now, route.chosen);
                    }

                    Some((route, capacity))
                }
                Err(no_route) => {
                    routes.push(AtlasRoute {
                        market,
                        provider_id: String::new(),
                        provider_name: "none available".into(),
                        fallback_name: None,
                        window_remaining: 0,
                        day_remaining: None,
                        blocked: no_route
                            .blocked
                            .into_iter()
                            .map(|(id, reason)| {
                                let (text, until) = describe(reason);
                                AtlasBlocked {
                                    provider_name: catalogue::allowance_for(id)
                                        .map(|a| a.provider_name.to_string())
                                        .unwrap_or_else(|| id.to_string()),
                                    reason: text,
                                    until,
                                }
                            })
                            .collect(),
                    });
                    None
                }
            }
        };

        let Some((route, capacity)) = decision else {
            continue;
        };

        // Everything the budget covers is refreshed; the tail comes from cache with its age.
        let (fresh, cached) = ids.split_at(capacity.min(ids.len()));

        let mut rate_limited = false;
        if !fresh.is_empty() {
            let envelope = super::market::get_quotes(state, fresh.to_vec()).await?;
            rate_limited = matches!(
                envelope.meta.degraded.as_ref().map(|d| &d.reason),
                Some(DegradedReason::RateLimited)
            );
            quotes.extend(envelope.data);
        }

        if !cached.is_empty() {
            // Served from whatever the cache holds. `get_quotes` already prefers cache when the
            // provider cannot answer, so this is the same path with no fresh call behind it.
            if let Ok(envelope) = super::market::get_quotes(state, cached.to_vec()).await {
                quotes.extend(envelope.data);
            }
        }

        let mut usage = lock_usage(state);
        let state_for = usage.entry(route.chosen.provider_id).or_default();
        if rate_limited {
            // No Retry-After here: the envelope carries a formatted string for the UI rather
            // than the raw seconds, so the backoff falls back to doubling. Erring long is the
            // right direction for a provider that has just refused.
            state_for.record_rate_limited(now, None);
        } else {
            state_for.record_success();
        }

        routes.push(AtlasRoute {
            market,
            provider_id: route.chosen.provider_id.to_string(),
            provider_name: route.chosen.provider_name.to_string(),
            fallback_name: route.fallback.map(|a| a.provider_name.to_string()),
            window_remaining: state_for.window_remaining(route.chosen),
            day_remaining: state_for.day_remaining(route.chosen),
            blocked: Vec::new(),
        });
    }

    Ok(AtlasSnapshot { quotes, routes })
}
