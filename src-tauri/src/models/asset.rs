use serde::{Deserialize, Serialize};

/// Asset class. Anything outside this set is rejected at the adapter boundary rather than
/// carried through as a string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "lowercase")]
pub enum AssetType {
    Crypto,
    Stock,
    Etf,
    Index,
}

impl AssetType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Crypto => "crypto",
            Self::Stock => "stock",
            Self::Etf => "etf",
            Self::Index => "index",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "crypto" => Some(Self::Crypto),
            "stock" => Some(Self::Stock),
            "etf" => Some(Self::Etf),
            "index" => Some(Self::Index),
            _ => None,
        }
    }
}

/// An asset, identified by a canonical app-level id that no provider controls.
///
/// The id format is `<asset_type>:<namespace>:<key>` — see DATA_MODEL.md §1. User data
/// (watchlists, notes, progress) references this id, never a provider's symbol, so swapping
/// providers never rewrites anything the user made.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: String,
    pub asset_type: AssetType,
    pub symbol: String,
    pub name: String,
    pub currency: String,
    pub exchange: Option<String>,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct AssetSearchResult {
    pub asset: Asset,
    /// Ranking only. Never rendered as a judgement about the asset itself.
    pub score: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
pub enum ChartRange {
    #[serde(rename = "1D")]
    Day,
    #[serde(rename = "1W")]
    Week,
    #[serde(rename = "1M")]
    Month,
    #[serde(rename = "3M")]
    Quarter,
    #[serde(rename = "1Y")]
    Year,
    #[serde(rename = "MAX")]
    Max,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ChartPoint {
    /// Unix epoch seconds, UTC.
    #[cfg_attr(test, ts(type = "number"))]
    pub time: i64,
    pub close: f64,
}

/// One period's open, high, low and close.
///
/// Charts draw closes and need nothing more. This exists for the Kronos projection, which was
/// trained on whole candles and is fed nothing less — see `services::kronos`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candle {
    /// Unix epoch seconds, UTC — the start of the period.
    pub time: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    /// `None` where the provider does not report it. Never a zero standing in for "unknown".
    pub volume: Option<f64>,
}

impl Candle {
    /// Finite, positive, and with the high and low actually bounding the open and close.
    pub fn is_plausible(&self) -> bool {
        let prices = [self.open, self.high, self.low, self.close];
        prices.iter().all(|p| p.is_finite() && *p > 0.0)
            && self.high >= self.open.max(self.close)
            && self.low <= self.open.min(self.close)
            && self.volume.map_or(true, |v| v.is_finite() && v >= 0.0)
            && (946_684_800..=4_102_444_800).contains(&self.time)
    }
}
