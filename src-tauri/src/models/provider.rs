use serde::{Deserialize, Serialize};

use super::{AssetType, ChartRange};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Market,
    News,
    Community,
    Ai,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderHealth {
    Ok,
    NotConfigured,
    RateLimited,
    Error,
    Disabled,
}

/// What a provider can actually do.
///
/// The UI hides or disables what a provider does not support rather than showing a control
/// that fails when pressed — e.g. a provider with no intraday data simply has no 1D range.
/// A market region a provider can serve.
///
/// `id` is what gets stored in preferences and sent to the adapter; `display_name` is what the
/// user picks from. Deliberately not an enum: the set of regions is provider-driven and will
/// grow, and a closed enum would mean a schema change for every new market.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub id: String,
    pub display_name: String,
    /// What choosing this region actually changes, in plain language.
    pub description: String,
}

impl Region {
    pub fn new(id: &str, display_name: &str, description: &str) -> Self {
        Self {
            id: id.to_string(),
            display_name: display_name.to_string(),
            description: description.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub display_name: String,
    pub kind: ProviderKind,
    pub enabled: bool,
    pub requires_credential: bool,
    /// A flag, never a key and never a fragment of one. See THREAT_MODEL.md §4.
    pub has_credential: bool,
    pub health: ProviderHealth,
    /// Attribution text the UI is required to render alongside this provider's data.
    pub attribution: String,
    pub docs_url: Option<String>,
    pub supported_asset_types: Vec<AssetType>,
    pub supported_ranges: Vec<ChartRange>,
    pub supported_regions: Vec<Region>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub entry_count: i64,
    pub total_bytes: i64,
    pub oldest_fetched_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub data_dir: String,
    pub db_path: String,
    pub schema_version: i64,
    pub is_mock_mode: bool,
}
