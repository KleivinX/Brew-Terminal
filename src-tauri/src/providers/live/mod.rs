//! Live provider adapters.
//!
//! Every adapter here was written against a response shape verified from the provider itself —
//! a real call or their own machine-readable spec — and each one's terms, limits and
//! attribution are recorded in `docs/PROVIDERS.md` before it was enabled. See ADR-008.

pub mod alphavantage;
pub mod coingecko;
pub mod finnhub;
pub mod fred;
pub mod rss;

pub use alphavantage::AlphaVantageProvider;
pub use coingecko::CoinGeckoProvider;
pub use finnhub::FinnhubProvider;
pub use fred::FredProvider;
pub use rss::RssNewsProvider;
