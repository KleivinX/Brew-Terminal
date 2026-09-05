//! The providers Atlas is allowed to rotate through, and what each is permitted.
//!
//! Every entry corresponds to a section of `docs/PROVIDERS.md` where that provider's terms and
//! published limits were read and recorded. Nothing is listed here that has not been through
//! that review — ADR-008 makes it a condition of shipping an adapter, and a rotation manager
//! that quietly adds a fourth source would route around the rule rather than follow it.
//!
//! The numbers are below each published limit, deliberately. See `Allowance`.

use crate::models::AssetType;

use super::rotation::Allowance;

/// Crypto and equities, in the order Atlas tries them.
///
/// **Crypto** is served by CoinGecko alone today. That is not a gap in the design — it is the
/// only crypto source this project has reviewed, and the rotation table is where a second one
/// would be added once it has been. Binance's public endpoints are the obvious candidate and
/// are documented and keyless, but they are geo-restricted in the US (Binance.US is a separate
/// API with separate terms), and neither has been through the ADR-008 review. Adding a provider
/// here is a config entry; adding one without reading its terms is the thing the rule forbids.
///
/// **Equities** are served by Finnhub. Alpha Vantage was the obvious second, and the arithmetic
/// rules it out rather than the terms: its `GLOBAL_QUOTE` endpoint takes one symbol per call
/// against a free tier of 25 requests *a day*, so a twelve-symbol watchlist would spend half the
/// daily budget on a single tick and all of it on the second. It is a chart provider in this
/// codebase for that reason — `quotes()` deliberately returns nothing — and listing it here
/// would produce a fallback that rotates to a provider which answers with an empty list. A
/// fallback that silently returns no data is worse than none, because the status line would
/// claim a working route.
///
/// So the honest tier below a rate-limited provider is the cache, and Atlas says so: the ticker
/// keeps showing the last good figure with its age, rather than implying a fresh one.
pub static PROVIDERS: &[Allowance] = &[
    Allowance {
        provider_id: crate::providers::live::coingecko::COINGECKO_ID,
        provider_name: "CoinGecko",
        // 50/min is the adapter's existing keyless setting; Atlas takes a slice of it rather
        // than a budget of its own, because the two share one account's allowance.
        per_window: 20,
        window_secs: 60,
        // 10,000/month works out near 300/day. Atlas is capped well under that so a day of
        // Atlas cannot spend the month's allowance the rest of the app also draws on.
        per_day: Some(200),
        serves: &[AssetType::Crypto],
        needs_key: false,
        // `/coins/markets` returns the whole watchlist for one call.
        batches: true,
        priority: 0,
    },
    Allowance {
        provider_id: crate::providers::live::finnhub::FINNHUB_ID,
        provider_name: "Finnhub",
        // Published free tier is 60/min. Atlas takes a third, leaving room for the rest of the
        // app — the Research Lab and the screener draw on the same key.
        per_window: 20,
        window_secs: 60,
        per_day: None,
        serves: &[AssetType::Stock],
        needs_key: true,
        // `/quote` takes one symbol per call — there is no batch quote endpoint on this API.
        // Twelve symbols is twelve calls, which is what `per_window` has to be read against.
        batches: false,
        priority: 0,
    },
];

/// The allowance for one provider id, for the status line.
pub fn allowance_for(provider_id: &str) -> Option<&'static Allowance> {
    PROVIDERS.iter().find(|a| a.provider_id == provider_id)
}
