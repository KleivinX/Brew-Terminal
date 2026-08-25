use std::sync::Arc;

use super::live::{
    coingecko::COINGECKO_ID, finnhub::FINNHUB_ID, CoinGeckoProvider, FinnhubProvider,
};
use super::mock::{
    community::MOCK_COMMUNITY_ID, market::MOCK_PROVIDER_ID, MockCommunityProvider,
    MockMarketProvider, MockNewsProvider,
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
        (MOCK_PROVIDER_ID, "market", cfg!(debug_assertions)),
        // The Model Desk is off until the user configures an endpoint. AI_POLICY.md §1.
        (crate::providers::ai::LOCAL_PROVIDER_ID, "ai", false),
        (crate::providers::ai::CLOUD_PROVIDER_ID, "ai", false),
        // Community is opt-in and off by default. PRODUCT_SCOPE_V0_1.md §Research.
        (MOCK_COMMUNITY_ID, "community", false),
    ]
}

/// Holds every provider and resolves which one answers a given request.
///
/// Routing is by asset type, because no single provider covers both crypto and equities. The
/// canonical id carries the type, so a watchlist mixing both can be split without guessing.
pub struct ProviderRegistry {
    pool: DbPool,
    coingecko: Arc<CoinGeckoProvider>,
    finnhub: Arc<FinnhubProvider>,
    mock_market: Arc<MockMarketProvider>,
    mock_news: Arc<MockNewsProvider>,
    mock_community: Arc<MockCommunityProvider>,
}

impl ProviderRegistry {
    pub fn new(pool: DbPool) -> AppResult<Self> {
        // One HTTP client, shared. reqwest pools connections internally, so sharing it means
        // a TLS handshake per host rather than per request.
        let client = http::build_client()?;

        Ok(Self {
            pool,
            coingecko: Arc::new(CoinGeckoProvider::new(client.clone())),
            finnhub: Arc::new(FinnhubProvider::new(client)),
            mock_market: Arc::new(MockMarketProvider::new()),
            mock_news: Arc::new(MockNewsProvider::new()),
            mock_community: Arc::new(MockCommunityProvider::new()),
        })
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

    pub fn news(&self) -> Arc<dyn NewsProvider> {
        self.mock_news.clone()
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

    pub async fn list_info(&self) -> Vec<ProviderInfo> {
        let mut out = Vec::new();

        let market: Vec<Arc<dyn MarketDataProvider>> = vec![
            self.coingecko.clone(),
            self.finnhub.clone(),
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

        let news = self.news();
        let news_caps = super::ProviderCapabilities {
            asset_types: Vec::new(),
            search: false,
            quotes: false,
            charts: Vec::new(),
            profiles: false,
            regions: Vec::new(),
            requires_credential: false,
            attribution: news.attribution().to_string(),
            docs_url: None,
        };
        out.push(to_provider_info(
            news.id(),
            news.display_name(),
            ProviderKind::News,
            &news_caps,
            true,
            false,
            news.health().await,
        ));

        out
    }
}

/// Reads the asset type out of a canonical id (`crypto:cg:bitcoin` → Crypto).
pub fn asset_type_of(asset_id: &str) -> Option<AssetType> {
    AssetType::parse(asset_id.split(':').next()?)
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
