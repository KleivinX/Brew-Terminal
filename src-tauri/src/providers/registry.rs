use std::sync::Arc;

use super::live::{
    alphavantage::ALPHAVANTAGE_ID,
    coingecko::COINGECKO_ID,
    finnhub::FINNHUB_ID,
    frankfurter::{self, FRANKFURTER_ID},
    nws::{self, NWS_ID},
    opensky::{self, OPENSKY_ID},
    rss::RSS_PROVIDER_ID,
    usgs::{self, USGS_ID},
    worldbank::{self, WORLDBANK_ID},
    AlphaVantageProvider, CoinGeckoProvider, FinnhubProvider, FrankfurterProvider, NwsProvider,
    OpenSkyProvider, RssNewsProvider, UsgsProvider, WorldBankProvider,
};
use super::mock::{
    community::MOCK_COMMUNITY_ID, market::MOCK_PROVIDER_ID, MockCommunityProvider,
    MockMarketProvider,
};
use super::{http, to_provider_info, CommunityProvider, MarketDataProvider, NewsProvider};
use crate::db::{repo_providers, DbPool};
use crate::error::AppResult;
use crate::models::{AssetType, ProviderInfo, ProviderKind};

/// Provider defaults, seeded on first run.
///
/// CoinGecko is on by default because it needs no credential. Finnhub is off because every one
/// of its endpoints requires a key. The mock provider is enabled only in debug builds — a
/// release must never quietly serve fixtures in place of market data.
pub fn default_provider_config() -> Vec<(&'static str, &'static str, bool)> {
    vec![
        (COINGECKO_ID, "market", true),
        (FINNHUB_ID, "market", false),
        // Charts only, and only for equities — see `providers::live::alphavantage`. Off until
        // a key is entered, like every other credentialed provider.
        (ALPHAVANTAGE_ID, "market", false),
        (MOCK_PROVIDER_ID, "market", cfg!(debug_assertions)),
        // News is on by default: the feeds it reads are public, need no credential, and the
        // panel is empty without it. The user's feed list is what actually decides what is
        // fetched, and they can empty it.
        (RSS_PROVIDER_ID, "news", true),
        // The Model Desk is off until the user configures an endpoint. AI_POLICY.md §1.
        (crate::providers::ai::LOCAL_PROVIDER_ID, "ai", false),
        (crate::providers::ai::CLOUD_PROVIDER_ID, "ai", false),
        // Community is opt-in and off by default. PRODUCT_SCOPE_V0_1.md §Research.
        (MOCK_COMMUNITY_ID, "community", false),
        /*
         * Sentry's sources. The first four are on by default and that is not a shortcut: all
         * four are keyless, and three of them are public-domain government output. There is
         * nothing for the user to sign up for and nothing to disclose, so a Sentry that draws
         * a blank map on first run would be withholding data for no reason.
         */
        (USGS_ID, "sentry", true),
        (NWS_ID, "sentry", true),
        (WORLDBANK_ID, "sentry", true),
        (FRANKFURTER_ID, "sentry", true),
        /*
         * OpenSky is the exception, and its terms are why rather than its price. The licence
         * covers non-profit research and education; using the REST API "in any operational
         * capacity — including integration into a live product, service, or automated system"
         * needs a prior written agreement. A shipped desktop app polling on a timer is exactly
         * that, so this stays off until a user with their own arrangement turns it on. See
         * `providers::live::opensky` and ADR-040.
         */
        (OPENSKY_ID, "sentry", false),
    ]
}

/// The Sentry sources, for Settings and for the layer sidebar.
///
/// A flat table rather than the `MarketDataProvider` trait: none of these price an asset, and
/// implementing `quotes()` and `chart()` to return errors would be a worse lie than a table.
pub struct SentryProviderInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub attribution: &'static str,
    pub docs_url: &'static str,
    pub requires_credential: bool,
}

pub const SENTRY_PROVIDERS: &[SentryProviderInfo] = &[
    SentryProviderInfo {
        id: USGS_ID,
        name: usgs::USGS_NAME,
        attribution: usgs::USGS_ATTRIBUTION,
        docs_url: usgs::USGS_DOCS,
        requires_credential: false,
    },
    SentryProviderInfo {
        id: NWS_ID,
        name: nws::NWS_NAME,
        attribution: nws::NWS_ATTRIBUTION,
        docs_url: nws::NWS_DOCS,
        requires_credential: false,
    },
    SentryProviderInfo {
        id: WORLDBANK_ID,
        name: worldbank::WORLDBANK_NAME,
        attribution: worldbank::WORLDBANK_ATTRIBUTION,
        docs_url: worldbank::WORLDBANK_DOCS,
        requires_credential: false,
    },
    SentryProviderInfo {
        id: FRANKFURTER_ID,
        name: frankfurter::FRANKFURTER_NAME,
        attribution: frankfurter::FRANKFURTER_ATTRIBUTION,
        docs_url: frankfurter::FRANKFURTER_DOCS,
        requires_credential: false,
    },
    SentryProviderInfo {
        id: OPENSKY_ID,
        name: opensky::OPENSKY_NAME,
        attribution: opensky::OPENSKY_ATTRIBUTION,
        docs_url: opensky::OPENSKY_DOCS,
        requires_credential: true,
    },
];

/// Holds every provider and resolves which one answers a given request.
///
/// Routing is by asset type, because no single provider covers both crypto and equities. The
/// canonical id carries the type, so a watchlist mixing both can be split without guessing.
pub struct ProviderRegistry {
    pool: DbPool,
    client: reqwest::Client,
    download_client: reqwest::Client,
    coingecko: Arc<CoinGeckoProvider>,
    finnhub: Arc<FinnhubProvider>,
    alphavantage: Arc<AlphaVantageProvider>,
    mock_market: Arc<MockMarketProvider>,
    rss_news: Arc<RssNewsProvider>,
    mock_community: Arc<MockCommunityProvider>,
    usgs: Arc<UsgsProvider>,
    nws: Arc<NwsProvider>,
    worldbank: Arc<WorldBankProvider>,
    frankfurter: Arc<FrankfurterProvider>,
    /// Holds a cached bearer token across calls, which is why it is an `Arc` rather than
    /// constructed per request — see `OpenSkyProvider::bearer`.
    opensky: Arc<OpenSkyProvider>,
}

impl ProviderRegistry {
    pub fn new(pool: DbPool) -> AppResult<Self> {
        // One HTTP client, shared. reqwest pools connections internally, so sharing it means
        // a TLS handshake per host rather than per request.
        let client = http::build_client()?;
        let client_for_sentry = client.clone();

        Ok(Self {
            client: client.clone(),
            // Large downloads need a client with no total timeout — see `http::build_download_client`.
            download_client: http::build_download_client()?,
            coingecko: Arc::new(CoinGeckoProvider::new(client.clone())),
            finnhub: Arc::new(FinnhubProvider::new(client.clone())),
            alphavantage: Arc::new(AlphaVantageProvider::new(client.clone())),
            mock_market: Arc::new(MockMarketProvider::new()),
            // The feed adapter reads the user's feed list on every call, so it needs the pool
            // as well as the client.
            rss_news: Arc::new(RssNewsProvider::new(client, pool.clone())),
            mock_community: Arc::new(MockCommunityProvider::new()),
            usgs: Arc::new(UsgsProvider::new(client_for_sentry.clone())),
            nws: Arc::new(NwsProvider::new(client_for_sentry.clone())),
            worldbank: Arc::new(WorldBankProvider::new(client_for_sentry.clone())),
            frankfurter: Arc::new(FrankfurterProvider::new(client_for_sentry.clone())),
            opensky: Arc::new(OpenSkyProvider::new(client_for_sentry)),
            pool,
        })
    }

    /// The shared HTTP client.
    ///
    /// Exposed so a service making a one-off request — checking a feed the user just typed,
    /// say — reuses the client that carries the guarantees in THREAT_MODEL.md §3, rather than
    /// building a second one that quietly does not.
    pub fn http_client(&self) -> reqwest::Client {
        self.client.clone()
    }

    /// The client for model and engine downloads.
    ///
    /// Deliberately not `http_client`: that one caps the whole request at 15 seconds, which no
    /// multi-hundred-megabyte download can meet.
    pub fn download_client(&self) -> reqwest::Client {
        self.download_client.clone()
    }

    fn enabled(&self, provider_id: &str) -> bool {
        self.pool
            .get()
            .map(|conn| repo_providers::is_enabled(&conn, provider_id))
            .unwrap_or(false)
    }

    /// The provider that answers for a given asset type, or `None` if none is configured.
    ///
    /// Returning `None` rather than silently falling back to fixtures is deliberate: the UI
    /// then shows "no provider set up" and a route to Settings, instead of presenting mock
    /// numbers that look real.
    pub fn market_for(&self, asset_type: AssetType) -> Option<Arc<dyn MarketDataProvider>> {
        match asset_type {
            AssetType::Crypto => {
                if self.enabled(COINGECKO_ID) {
                    return Some(self.coingecko.clone());
                }
            }
            AssetType::Stock | AssetType::Etf | AssetType::Index => {
                // Finnhub also needs a key, which `capabilities().requires_credential`
                // advertises and `health()` reports.
                if self.enabled(FINNHUB_ID) {
                    return Some(self.finnhub.clone());
                }
            }
        }

        // Fixtures are a last resort and only when explicitly enabled.
        if self.enabled(MOCK_PROVIDER_ID) {
            return Some(self.mock_market.clone());
        }

        None
    }

    /// Routes by canonical id prefix — `crypto:…` and `stock:…` go to different providers.
    pub fn market_for_asset_id(&self, asset_id: &str) -> Option<Arc<dyn MarketDataProvider>> {
        let asset_type = asset_type_of(asset_id)?;
        self.market_for(asset_type)
    }

    /// The provider that can draw a chart for this asset, which is not always the one that
    /// prices it.
    ///
    /// Equities are the case that forces this to exist: Finnhub serves quotes on its free tier
    /// but its candles are paid, so it advertises no ranges. Routing charts separately means a
    /// user can hold a Finnhub key for prices and an Alpha Vantage key for history, and get
    /// both, instead of the Stocks tab having no chart at all.
    pub fn chart_provider_for(
        &self,
        asset_id: &str,
        range: crate::models::ChartRange,
    ) -> Option<Arc<dyn MarketDataProvider>> {
        let asset_type = asset_type_of(asset_id)?;

        // The asset's usual provider first, when it can actually serve the range.
        if let Some(primary) = self.market_for(asset_type) {
            if primary.capabilities().charts.contains(&range) {
                return Some(primary);
            }
        }

        // Otherwise anything enabled that can. Today that is only Alpha Vantage, for equities.
        if matches!(
            asset_type,
            AssetType::Stock | AssetType::Etf | AssetType::Index
        ) && self.enabled(ALPHAVANTAGE_ID)
            && self.alphavantage.capabilities().charts.contains(&range)
        {
            return Some(self.alphavantage.clone());
        }

        None
    }

    /// Every enabled market provider, for search fan-out.
    pub fn enabled_market_providers(&self) -> Vec<Arc<dyn MarketDataProvider>> {
        let mut providers: Vec<Arc<dyn MarketDataProvider>> = Vec::new();
        if self.enabled(COINGECKO_ID) {
            providers.push(self.coingecko.clone());
        }
        if self.enabled(FINNHUB_ID) {
            providers.push(self.finnhub.clone());
        }
        if self.enabled(MOCK_PROVIDER_ID) {
            providers.push(self.mock_market.clone());
        }
        providers
    }

    /// The news provider, or `None` when none is enabled.
    ///
    /// An `Option` for the same reason `market_for` returns one. v0.1.0 returned a fixture
    /// provider here unconditionally — in release builds too — so a shipped app presented
    /// invented headlines under a badge that said `source: live`. There is no fixture news
    /// adapter any more: if no feed provider is on, the panel says so.
    pub fn news(&self) -> Option<Arc<dyn NewsProvider>> {
        if self.enabled(RSS_PROVIDER_ID) {
            return Some(self.rss_news.clone());
        }
        None
    }

    /// The community provider, or `None` when none is enabled.
    ///
    /// An `Option` rather than a default, because "no community provider" is the shipped state:
    /// the only adapter that exists is the fixture one, and it is compiled in but seeded
    /// disabled. A release therefore has nothing to return here until someone enables it. See
    /// PROVIDERS.md.
    pub fn community(&self) -> Option<Arc<dyn CommunityProvider>> {
        if self.enabled(MOCK_COMMUNITY_ID) {
            Some(self.mock_community.clone())
        } else {
            None
        }
    }

    /// Direct handle to the mock, for the dev panel only. Not part of the abstraction.
    pub fn mock_market(&self) -> Arc<MockMarketProvider> {
        self.mock_market.clone()
    }

    /// True when every enabled market provider is a mock, so the UI can show a standing
    /// "these numbers are fixtures" marker.
    pub fn is_mock_mode(&self) -> bool {
        let providers = self.enabled_market_providers();
        !providers.is_empty() && providers.iter().all(|p| p.id() == MOCK_PROVIDER_ID)
    }

    /// Whether a Sentry source is switched on.
    ///
    /// Public because `services::sentry` decides which layers to fetch, and the enabled flag
    /// is the only thing that decision turns on.
    pub fn sentry_enabled(&self, provider_id: &str) -> bool {
        self.enabled(provider_id)
    }

    pub fn usgs(&self) -> Arc<UsgsProvider> {
        self.usgs.clone()
    }

    pub fn nws(&self) -> Arc<NwsProvider> {
        self.nws.clone()
    }

    pub fn worldbank(&self) -> Arc<WorldBankProvider> {
        self.worldbank.clone()
    }

    pub fn frankfurter(&self) -> Arc<FrankfurterProvider> {
        self.frankfurter.clone()
    }

    pub fn opensky(&self) -> Arc<OpenSkyProvider> {
        self.opensky.clone()
    }

    pub async fn list_info(&self) -> Vec<ProviderInfo> {
        let mut out = Vec::new();

        let market: Vec<Arc<dyn MarketDataProvider>> = vec![
            self.coingecko.clone(),
            self.finnhub.clone(),
            self.alphavantage.clone(),
            self.mock_market.clone(),
        ];

        for provider in market {
            let caps = provider.capabilities();
            let enabled = self.enabled(provider.id());
            let has_credential = crate::security::secrets::exists(provider.id());

            let health = if !enabled {
                crate::models::ProviderHealth::Disabled
            } else {
                provider.health().await
            };

            out.push(to_provider_info(
                provider.id(),
                provider.display_name(),
                ProviderKind::Market,
                &caps,
                enabled,
                has_credential,
                health,
            ));
        }

        // Listed whether or not it is on, the same as the market adapters, so Settings shows
        // what exists rather than only what happens to be enabled.
        let news: Vec<Arc<dyn NewsProvider>> = vec![self.rss_news.clone()];

        for provider in news {
            let enabled = self.enabled(provider.id());
            let caps = super::ProviderCapabilities {
                asset_types: Vec::new(),
                search: false,
                quotes: false,
                charts: Vec::new(),
                profiles: false,
                regions: Vec::new(),
                requires_credential: false,
                attribution: provider.attribution().to_string(),
                docs_url: None,
            };

            let health = if !enabled {
                crate::models::ProviderHealth::Disabled
            } else {
                provider.health().await
            };

            out.push(to_provider_info(
                provider.id(),
                provider.display_name(),
                ProviderKind::News,
                &caps,
                enabled,
                false,
                health,
            ));
        }

        /*
         * Sentry's sources, listed the same way — present whether or not they are on, so
         * Settings shows what exists rather than only what happens to be enabled. Health is
         * derived rather than probed: four of these need no credential, and firing five
         * requests every time the settings page opens would spend other people's bandwidth to
         * tell the user something the configuration already says.
         */
        for provider in SENTRY_PROVIDERS {
            let enabled = self.enabled(provider.id);
            let has_credential = crate::security::secrets::exists(provider.id);

            let health = if !enabled {
                crate::models::ProviderHealth::Disabled
            } else if provider.requires_credential && !has_credential {
                crate::models::ProviderHealth::NotConfigured
            } else {
                crate::models::ProviderHealth::Ok
            };

            let caps = super::ProviderCapabilities {
                asset_types: Vec::new(),
                search: false,
                quotes: false,
                charts: Vec::new(),
                profiles: false,
                regions: Vec::new(),
                requires_credential: provider.requires_credential,
                attribution: provider.attribution.to_string(),
                docs_url: Some(provider.docs_url.to_string()),
            };

            out.push(to_provider_info(
                provider.id,
                provider.name,
                ProviderKind::Sentry,
                &caps,
                enabled,
                has_credential,
                health,
            ));
        }

        out
    }
}

/// Reads the asset type out of a canonical id (`crypto:cg:bitcoin` → Crypto).
pub fn asset_type_of(asset_id: &str) -> Option<AssetType> {
    AssetType::parse(asset_id.split(':').next()?)
}

#[cfg(test)]
mod chart_routing_tests {
    use super::*;
    use crate::db::migrations;
    use crate::models::ChartRange;

    fn registry() -> ProviderRegistry {
        let pool = crate::db::pool::create_in_memory().unwrap();
        {
            let mut conn = pool.get().unwrap();
            migrations::run(&mut conn, None).unwrap();
            repo_providers::upsert_defaults(&conn, &default_provider_config()).unwrap();
            // The fixture provider is seeded on in debug builds and advertises every range, so
            // it would answer before any real adapter and these tests would prove nothing.
            repo_providers::set_enabled(&conn, MOCK_PROVIDER_ID, false).unwrap();
        }
        ProviderRegistry::new(pool).unwrap()
    }

    /// Crypto has always worked; this pins that the new routing did not change it.
    #[test]
    fn crypto_charts_still_come_from_coingecko() {
        let registry = registry();
        let provider = registry
            .chart_provider_for("crypto:cg:bitcoin", ChartRange::Month)
            .expect("crypto should have a chart provider");
        assert_eq!(provider.id(), COINGECKO_ID);
    }

    /// The gap this feature exists to close: Finnhub prices equities but its candles are paid,
    /// so before Alpha Vantage was routable a stock chart had no provider at all.
    #[test]
    fn a_stock_has_no_chart_provider_until_alpha_vantage_is_enabled() {
        let registry = registry();
        assert!(
            registry
                .chart_provider_for("stock:us:AAPL", ChartRange::Month)
                .is_none(),
            "Finnhub advertises no ranges, so nothing should answer yet"
        );
    }

    #[test]
    fn enabling_alpha_vantage_gives_stocks_a_chart_provider() {
        let registry = registry();
        {
            let conn = registry.pool.get().unwrap();
            repo_providers::set_enabled(&conn, ALPHAVANTAGE_ID, true).unwrap();
        }

        let provider = registry
            .chart_provider_for("stock:us:AAPL", ChartRange::Month)
            .expect("Alpha Vantage should answer once enabled");
        assert_eq!(provider.id(), ALPHAVANTAGE_ID);
    }

    #[test]
    fn it_is_not_offered_for_a_range_it_cannot_serve() {
        let registry = registry();
        {
            let conn = registry.pool.get().unwrap();
            repo_providers::set_enabled(&conn, ALPHAVANTAGE_ID, true).unwrap();
        }

        // Intraday is a different endpoint and is deliberately not served.
        assert!(registry
            .chart_provider_for("stock:us:AAPL", ChartRange::Day)
            .is_none());
    }

    #[test]
    fn it_is_never_routed_for_crypto() {
        let registry = registry();
        {
            let conn = registry.pool.get().unwrap();
            repo_providers::set_enabled(&conn, ALPHAVANTAGE_ID, true).unwrap();
            repo_providers::set_enabled(&conn, COINGECKO_ID, false).unwrap();
        }

        assert!(registry
            .chart_provider_for("crypto:cg:bitcoin", ChartRange::Month)
            .is_none());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{migrations, pool};

    fn registry_with(enabled: &[(&str, bool)]) -> ProviderRegistry {
        let p = pool::create_in_memory().unwrap();
        {
            let mut conn = p.get().unwrap();
            migrations::run(&mut conn, None).unwrap();
            repo_providers::upsert_defaults(&conn, &default_provider_config()).unwrap();
            for (id, on) in enabled {
                repo_providers::set_enabled(&conn, id, *on).unwrap();
            }
        }
        ProviderRegistry::new(p).unwrap()
    }

    #[test]
    fn routes_crypto_and_equities_to_different_providers() {
        let registry = registry_with(&[
            (COINGECKO_ID, true),
            (FINNHUB_ID, true),
            (MOCK_PROVIDER_ID, false),
        ]);

        assert_eq!(
            registry.market_for(AssetType::Crypto).unwrap().id(),
            COINGECKO_ID
        );
        assert_eq!(
            registry.market_for(AssetType::Stock).unwrap().id(),
            FINNHUB_ID
        );
    }

    #[test]
    fn routes_by_canonical_id() {
        let registry = registry_with(&[
            (COINGECKO_ID, true),
            (FINNHUB_ID, true),
            (MOCK_PROVIDER_ID, false),
        ]);

        assert_eq!(
            registry
                .market_for_asset_id("crypto:cg:bitcoin")
                .unwrap()
                .id(),
            COINGECKO_ID
        );
        assert_eq!(
            registry.market_for_asset_id("stock:us:AAPL").unwrap().id(),
            FINNHUB_ID
        );
        assert!(registry.market_for_asset_id("nonsense").is_none());
    }

    #[test]
    fn returns_none_rather_than_falling_back_to_fixtures() {
        // With no provider configured the UI must say so, not show mock numbers.
        let registry = registry_with(&[
            (COINGECKO_ID, false),
            (FINNHUB_ID, false),
            (MOCK_PROVIDER_ID, false),
        ]);
        assert!(registry.market_for(AssetType::Stock).is_none());
        assert!(registry.market_for(AssetType::Crypto).is_none());
    }

    #[test]
    fn falls_back_to_the_mock_only_when_it_is_explicitly_enabled() {
        let registry = registry_with(&[
            (COINGECKO_ID, false),
            (FINNHUB_ID, false),
            (MOCK_PROVIDER_ID, true),
        ]);
        assert_eq!(
            registry.market_for(AssetType::Stock).unwrap().id(),
            MOCK_PROVIDER_ID
        );
        assert!(registry.is_mock_mode());
    }

    #[test]
    fn is_not_mock_mode_when_a_live_provider_is_on() {
        let registry = registry_with(&[
            (COINGECKO_ID, true),
            (FINNHUB_ID, false),
            (MOCK_PROVIDER_ID, true),
        ]);
        assert!(
            !registry.is_mock_mode(),
            "a live provider means the data is not all fixtures"
        );
    }

    #[test]
    fn asset_type_parsing_covers_every_namespace() {
        assert_eq!(asset_type_of("crypto:cg:bitcoin"), Some(AssetType::Crypto));
        assert_eq!(asset_type_of("stock:us:AAPL"), Some(AssetType::Stock));
        assert_eq!(asset_type_of("etf:us:VOO"), Some(AssetType::Etf));
        assert_eq!(asset_type_of("index:global:SPX"), Some(AssetType::Index));
        assert_eq!(asset_type_of("bogus:x:y"), None);
    }

    #[tokio::test]
    async fn every_listed_provider_carries_attribution() {
        let registry = registry_with(&[(COINGECKO_ID, true)]);
        for provider in registry.list_info().await {
            assert!(
                !provider.attribution.trim().is_empty(),
                "{} has no attribution",
                provider.id
            );
        }
    }

    #[tokio::test]
    async fn a_disabled_provider_reports_disabled_health() {
        let registry = registry_with(&[(FINNHUB_ID, false)]);
        let info = registry.list_info().await;
        let finnhub = info.iter().find(|p| p.id == FINNHUB_ID).unwrap();
        assert_eq!(finnhub.health, crate::models::ProviderHealth::Disabled);
        assert!(finnhub.requires_credential);
    }
}
