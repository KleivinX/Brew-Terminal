use std::sync::atomic::{AtomicU8, Ordering};

use async_trait::async_trait;

use super::MockBehavior;
use crate::error::{AppError, AppResult};
use crate::models::{
    Asset, AssetSearchResult, AssetType, ChartPoint, ChartRange, ProviderHealth, Quote, Region,
};
use crate::providers::{MarketDataProvider, ProviderCapabilities};

/// The same fixture files the browser harness imports — one copy of the development data,
/// read here at compile time. See content/fixtures/README.md.
const CRYPTO_QUOTES: &str = include_str!("../../../../content/fixtures/crypto_quotes.json");
const STOCK_QUOTES: &str = include_str!("../../../../content/fixtures/stock_quotes.json");
const SEARCH_INDEX: &str = include_str!("../../../../content/fixtures/search_index.json");
const CHART_SERIES: &str = include_str!("../../../../content/fixtures/chart_series.json");

pub const MOCK_PROVIDER_ID: &str = "mock";
pub const MOCK_PROVIDER_NAME: &str = "Mock provider (fixtures)";

/// Region id meaning "do not filter". Chosen over an Option so the preference always holds a
/// concrete value and the adapter boundary has one shape.
pub const REGION_GLOBAL: &str = "global";

pub struct MockMarketProvider {
    quotes: Vec<Quote>,
    assets: Vec<Asset>,
    /// Daily closes per asset id, oldest first.
    charts: std::collections::HashMap<String, Vec<ChartPoint>>,
    behavior: AtomicU8,
}

impl MockMarketProvider {
    pub fn new() -> Self {
        // A malformed fixture is a build-time authoring mistake, not a runtime condition.
        // Failing loudly here beats shipping a provider that silently returns nothing.
        let mut quotes: Vec<Quote> =
            serde_json::from_str(CRYPTO_QUOTES).expect("crypto_quotes.json is malformed");
        let stocks: Vec<Quote> =
            serde_json::from_str(STOCK_QUOTES).expect("stock_quotes.json is malformed");
        quotes.extend(stocks);

        // Fixtures go through the same validation as any provider response. If a fixture
        // could not survive it, neither could real data shaped the same way.
        let quotes = quotes
            .into_iter()
            .filter_map(|q| match q.clone().validate_and_normalize() {
                Ok(valid) => Some(valid),
                Err(reason) => {
                    tracing::warn!(symbol = %q.symbol, reason, "dropping invalid fixture quote");
                    None
                }
            })
            .collect();

        let assets: Vec<Asset> =
            serde_json::from_str(SEARCH_INDEX).expect("search_index.json is malformed");

        let charts: std::collections::HashMap<String, Vec<ChartPoint>> =
            serde_json::from_str(CHART_SERIES).expect("chart_series.json is malformed");

        Self {
            quotes,
            assets,
            charts,
            behavior: AtomicU8::new(MockBehavior::Normal as u8),
        }
    }

    pub fn set_behavior(&self, behavior: MockBehavior) {
        self.behavior.store(behavior as u8, Ordering::Relaxed);
    }

    pub fn behavior(&self) -> MockBehavior {
        match self.behavior.load(Ordering::Relaxed) {
            1 => MockBehavior::Slow,
            2 => MockBehavior::Empty,
            3 => MockBehavior::Stale,
            4 => MockBehavior::RateLimited,
            5 => MockBehavior::Error,
            6 => MockBehavior::NotConfigured,
            _ => MockBehavior::Normal,
        }
    }

    /// Turns the forced behaviour into the same errors a real provider would produce, so the
    /// service layer above cannot tell the difference.
    async fn simulate(&self) -> AppResult<bool> {
        match self.behavior() {
            MockBehavior::Slow => {
                tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
                Ok(true)
            }
            MockBehavior::Empty => Ok(false),
            MockBehavior::RateLimited => Err(AppError::RateLimited {
                provider_id: MOCK_PROVIDER_ID.into(),
                retry_after_secs: Some(60),
            }),
            MockBehavior::Error => Err(AppError::ProviderError {
                provider_id: MOCK_PROVIDER_ID.into(),
                status: Some(503),
            }),
            MockBehavior::NotConfigured => Err(AppError::NotConfigured {
                provider_id: MOCK_PROVIDER_ID.into(),
            }),
            MockBehavior::Normal | MockBehavior::Stale => Ok(true),
        }
    }
}

impl Default for MockMarketProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl MarketDataProvider for MockMarketProvider {
    fn id(&self) -> &str {
        MOCK_PROVIDER_ID
    }

    fn display_name(&self) -> &str {
        MOCK_PROVIDER_NAME
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            asset_types: vec![AssetType::Crypto, AssetType::Stock, AssetType::Etf],
            search: true,
            quotes: true,
            charts: vec![
                ChartRange::Day,
                ChartRange::Week,
                ChartRange::Month,
                ChartRange::Quarter,
                ChartRange::Year,
                ChartRange::Max,
            ],
            profiles: false,
            // The fixture holds a year of daily closes, so Max and Year are the same series.
            // Advertising Max here (where CoinGecko cannot) is deliberate: it keeps the
            // range-selector's "hide what is unsupported" behaviour exercised in development.
            regions: vec![
                Region::new(
                    REGION_GLOBAL,
                    "Global",
                    "Widely recognised assets across markets. No endorsement implied.",
                ),
                Region::new("us", "United States", "US-listed equities and ETFs."),
            ],
            requires_credential: false,
            attribution: "Development fixtures. Not real market data.".into(),
            docs_url: None,
        }
    }

    async fn health(&self) -> ProviderHealth {
        match self.behavior() {
            MockBehavior::RateLimited => ProviderHealth::RateLimited,
            MockBehavior::Error => ProviderHealth::Error,
            MockBehavior::NotConfigured => ProviderHealth::NotConfigured,
            _ => ProviderHealth::Ok,
        }
    }

    async fn search_assets(&self, query: &str, limit: usize) -> AppResult<Vec<AssetSearchResult>> {
        if !self.simulate().await? {
            return Ok(Vec::new());
        }

        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Ok(Vec::new());
        }

        let mut results: Vec<AssetSearchResult> = self
            .assets
            .iter()
            .filter_map(|asset| {
                let symbol = asset.symbol.to_lowercase();
                let name = asset.name.to_lowercase();

                let score = if symbol == needle {
                    1.0
                } else if symbol.starts_with(&needle) {
                    0.9
                } else if name.starts_with(&needle) {
                    0.8
                } else if name.contains(&needle) || symbol.contains(&needle) {
                    0.6
                } else {
                    return None;
                };

                Some(AssetSearchResult {
                    asset: asset.clone(),
                    score,
                })
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(limit);
        Ok(results)
    }

    async fn quotes(&self, asset_ids: &[String]) -> AppResult<Vec<Quote>> {
        if !self.simulate().await? {
            return Ok(Vec::new());
        }
        Ok(self
            .quotes
            .iter()
            .filter(|q| asset_ids.contains(&q.asset_id))
            .cloned()
            .collect())
    }

    async fn market_list(
        &self,
        asset_type: AssetType,
        region: &str,
        limit: usize,
    ) -> AppResult<Vec<Quote>> {
        if !self.simulate().await? {
            return Ok(Vec::new());
        }

        // Quotes carry no region of their own; the canonical asset record does. Looking it up
        // here keeps region a property of the asset rather than duplicating it onto every
        // price update.
        let region_of: std::collections::HashMap<&str, Option<&str>> = self
            .assets
            .iter()
            .map(|a| (a.id.as_str(), a.region.as_deref()))
            .collect();

        Ok(self
            .quotes
            .iter()
            .filter(|q| q.asset_type == asset_type)
            .filter(|q| {
                if region == REGION_GLOBAL {
                    return true;
                }
                region_of
                    .get(q.asset_id.as_str())
                    .copied()
                    .flatten()
                    .is_some_and(|r| r == region)
            })
            .take(limit)
            .cloned()
            .collect())
    }

    async fn asset(&self, asset_id: &str) -> AppResult<Option<Asset>> {
        Ok(self.assets.iter().find(|a| a.id == asset_id).cloned())
    }

    async fn chart(&self, asset_id: &str, range: ChartRange) -> AppResult<Vec<ChartPoint>> {
        if !self.simulate().await? {
            return Ok(Vec::new());
        }

        let Some(series) = self.charts.get(asset_id) else {
            // No fabricated series for an asset the fixture does not cover: an empty chart
            // with an honest empty state beats invented history.
            return Ok(Vec::new());
        };

        // The fixture is a year of daily closes, so a range is a tail of it.
        let days = match range {
            ChartRange::Day => 2,
            ChartRange::Week => 7,
            ChartRange::Month => 30,
            ChartRange::Quarter => 90,
            ChartRange::Year | ChartRange::Max => series.len(),
        };

        let start = series.len().saturating_sub(days);
        Ok(series[start..].to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn fixtures_load_and_validate() {
        let provider = MockMarketProvider::new();
        let quotes = provider
            .market_list(AssetType::Crypto, "global", 50)
            .await
            .unwrap();

        assert!(!quotes.is_empty(), "crypto fixtures must load");
        for quote in &quotes {
            assert!(quote.price.is_finite());
            assert_eq!(quote.currency, "USD");
            assert!(quote.sparkline.len() <= crate::models::MAX_SPARKLINE_POINTS);
        }
    }

    #[tokio::test]
    async fn search_ranks_exact_symbol_first() {
        let provider = MockMarketProvider::new();
        let results = provider.search_assets("btc", 5).await.unwrap();
        assert_eq!(results[0].asset.symbol, "BTC");
    }

    #[tokio::test]
    async fn search_with_blank_query_returns_nothing() {
        let provider = MockMarketProvider::new();
        assert!(provider.search_assets("   ", 5).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn quotes_are_filtered_to_requested_ids() {
        let provider = MockMarketProvider::new();
        let quotes = provider
            .quotes(&["crypto:cg:bitcoin".to_string()])
            .await
            .unwrap();
        assert_eq!(quotes.len(), 1);
        assert_eq!(quotes[0].symbol, "BTC");
    }

    /// Every failure mode must be reachable, and must arrive as a real error rather than an
    /// empty list — otherwise the UI could not tell "no results" from "provider down".
    #[tokio::test]
    async fn every_failure_mode_is_reachable() {
        let provider = MockMarketProvider::new();

        provider.set_behavior(MockBehavior::RateLimited);
        assert!(matches!(
            provider.quotes(&[]).await,
            Err(AppError::RateLimited { .. })
        ));

        provider.set_behavior(MockBehavior::Error);
        assert!(matches!(
            provider.quotes(&[]).await,
            Err(AppError::ProviderError { .. })
        ));

        provider.set_behavior(MockBehavior::NotConfigured);
        assert!(matches!(
            provider.quotes(&[]).await,
            Err(AppError::NotConfigured { .. })
        ));

        provider.set_behavior(MockBehavior::Empty);
        assert!(provider
            .market_list(AssetType::Crypto, "global", 10)
            .await
            .unwrap()
            .is_empty());

        provider.set_behavior(MockBehavior::Normal);
        assert!(!provider
            .market_list(AssetType::Crypto, "global", 10)
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn global_region_returns_every_asset_of_the_type() {
        let provider = MockMarketProvider::new();
        let all = provider
            .market_list(AssetType::Stock, REGION_GLOBAL, 50)
            .await
            .unwrap();
        assert!(!all.is_empty());
    }

    #[tokio::test]
    async fn a_specific_region_filters_the_list() {
        let provider = MockMarketProvider::new();

        let us = provider
            .market_list(AssetType::Stock, "us", 50)
            .await
            .unwrap();
        let all = provider
            .market_list(AssetType::Stock, REGION_GLOBAL, 50)
            .await
            .unwrap();
        assert!(!us.is_empty(), "the fixtures include US equities");
        assert!(us.len() <= all.len());

        // A region no fixture covers returns nothing rather than silently ignoring the filter.
        let none = provider
            .market_list(AssetType::Stock, "jp", 50)
            .await
            .unwrap();
        assert!(none.is_empty());
    }

    #[tokio::test]
    async fn capabilities_advertise_the_regions_the_fixtures_cover() {
        let caps = MockMarketProvider::new().capabilities();
        let ids: Vec<&str> = caps.regions.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains(&REGION_GLOBAL));
        assert!(ids.contains(&"us"));
    }

    #[tokio::test]
    async fn chart_ranges_return_progressively_longer_series() {
        let provider = MockMarketProvider::new();
        let id = "crypto:cg:bitcoin";

        let week = provider.chart(id, ChartRange::Week).await.unwrap();
        let month = provider.chart(id, ChartRange::Month).await.unwrap();
        let year = provider.chart(id, ChartRange::Year).await.unwrap();

        assert_eq!(week.len(), 7);
        assert_eq!(month.len(), 30);
        assert!(year.len() > month.len());

        for pair in year.windows(2) {
            assert!(pair[0].time < pair[1].time, "chart points must ascend");
        }
    }

    #[tokio::test]
    async fn an_asset_with_no_recorded_series_returns_empty_rather_than_invented_data() {
        let provider = MockMarketProvider::new();
        let points = provider
            .chart("crypto:cg:nothing-here", ChartRange::Year)
            .await
            .unwrap();
        assert!(points.is_empty());
    }

    #[tokio::test]
    async fn health_reflects_forced_behavior() {
        let provider = MockMarketProvider::new();
        provider.set_behavior(MockBehavior::RateLimited);
        assert_eq!(provider.health().await, ProviderHealth::RateLimited);
    }
}
