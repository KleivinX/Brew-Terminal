pub mod ai;
pub mod cache;
pub mod governor;
pub mod http;
pub mod live;
pub mod mock;
pub mod registry;

use async_trait::async_trait;

use crate::error::AppResult;
use crate::models::{
    Asset, AssetSearchResult, AssetType, ChartPoint, ChartRange, CommunityFilter, CommunityPost,
    NewsArticle, NewsFilter, ProviderHealth, ProviderInfo, Quote, Region,
};

/// What a provider can actually do.
///
/// The UI reads these flags and hides or disables what is unsupported, rather than offering a
/// control that fails when pressed. A provider with no intraday data simply has no 1D range.
#[derive(Debug, Clone)]
pub struct ProviderCapabilities {
    pub asset_types: Vec<AssetType>,
    pub search: bool,
    pub quotes: bool,
    pub charts: Vec<ChartRange>,
    pub profiles: bool,
    /// Regions this provider can actually serve. Settings offers exactly these and no more —
    /// the brief's "as data providers support them", enforced rather than promised.
    pub regions: Vec<Region>,
    pub requires_credential: bool,
    /// Attribution text the UI is required to render alongside this provider's data.
    /// Not optional, and not something a panel can choose to omit.
    pub attribution: String,
    pub docs_url: Option<String>,
}

/// Market data source.
///
/// No UI component ever names a concrete provider. The chain is always
/// command → service → governor → adapter → validator → normalizer → domain model.
#[async_trait]
pub trait MarketDataProvider: Send + Sync {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;
    fn capabilities(&self) -> ProviderCapabilities;

    async fn health(&self) -> ProviderHealth;
    async fn search_assets(&self, query: &str, limit: usize) -> AppResult<Vec<AssetSearchResult>>;
    /// Batched by design: there is no single-quote method, so an N+1 fetch cannot be written
    /// by accident at any layer above this one.
    async fn quotes(&self, asset_ids: &[String]) -> AppResult<Vec<Quote>>;
    async fn market_list(
        &self,
        asset_type: AssetType,
        region: &str,
        limit: usize,
    ) -> AppResult<Vec<Quote>>;
    async fn asset(&self, asset_id: &str) -> AppResult<Option<Asset>>;
    async fn chart(&self, asset_id: &str, range: ChartRange) -> AppResult<Vec<ChartPoint>>;
}

#[async_trait]
pub trait NewsProvider: Send + Sync {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;
    fn attribution(&self) -> &str;

    async fn health(&self) -> ProviderHealth;
    async fn news(&self, filter: &NewsFilter) -> AppResult<Vec<NewsArticle>>;
}

/// A source of public discussion.
///
/// Separate from `NewsProvider` because the safety framing differs: a news article is edited
/// and attributable, a forum post is neither. Everything this returns is rendered as quoted,
/// unverified material with its source and timestamp. See PRODUCT_SCOPE_V0_1.md §6.
#[async_trait]
pub trait CommunityProvider: Send + Sync {
    fn id(&self) -> &str;
    fn display_name(&self) -> &str;
    fn attribution(&self) -> &str;

    async fn health(&self) -> ProviderHealth;
    async fn posts(&self, filter: &CommunityFilter) -> AppResult<Vec<CommunityPost>>;
}

pub fn to_provider_info(
    id: &str,
    display_name: &str,
    kind: crate::models::ProviderKind,
    caps: &ProviderCapabilities,
    enabled: bool,
    has_credential: bool,
    health: ProviderHealth,
) -> ProviderInfo {
    ProviderInfo {
        id: id.to_string(),
        display_name: display_name.to_string(),
        kind,
        enabled,
        requires_credential: caps.requires_credential,
        has_credential,
        health,
        attribution: caps.attribution.clone(),
        docs_url: caps.docs_url.clone(),
        supported_asset_types: caps.asset_types.clone(),
        supported_ranges: caps.charts.clone(),
        supported_regions: caps.regions.clone(),
    }
}
