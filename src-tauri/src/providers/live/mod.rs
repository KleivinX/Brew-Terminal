//! Live provider adapters.
//!
//! Every adapter here was written against a response shape verified from the provider itself —
//! a real call or their own machine-readable spec — and each one's terms, limits and
//! attribution are recorded in `docs/PROVIDERS.md` before it was enabled. See ADR-008.

pub mod alphavantage;
pub mod alternative_me;
pub mod coingecko;
pub mod finnhub;
pub mod frankfurter;
pub mod fred;
pub mod nws;
pub mod opensky;
pub mod rss;
pub mod usgs;
pub mod worldbank;

pub use alphavantage::AlphaVantageProvider;
pub use alternative_me::AlternativeMeProvider;
pub use coingecko::CoinGeckoProvider;
pub use finnhub::FinnhubProvider;
pub use frankfurter::FrankfurterProvider;
pub use fred::FredProvider;
pub use nws::NwsProvider;
pub use opensky::OpenSkyProvider;
pub use rss::RssNewsProvider;
pub use usgs::UsgsProvider;
pub use worldbank::WorldBankProvider;
