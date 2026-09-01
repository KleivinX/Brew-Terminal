//! Alpha Vantage — daily candles for equities.
//!
//! Exists for one reason: Finnhub's candle endpoint is paid, so before this adapter the Stocks
//! tab had no chart at all. Alpha Vantage's free tier does serve daily history for real symbols.
//!
//! **It is a chart provider and nothing else.** `capabilities()` advertises no quotes, no search
//! and no profiles, even though the API offers them, because the free tier allows *25 requests a
//! day* — the tightest budget of any provider here by a wide margin. Spending one on a quote
//! that Finnhub serves for free would mean a chart the user cannot open later. The registry
//! therefore keeps Finnhub for quotes and reaches for this only when a chart is asked for.
//!
//! Only daily-derived ranges are offered. Intraday exists as a separate endpoint and would
//! double the request cost of the same screen; a 1D candle chart is not worth half the daily
//! budget.

use std::collections::HashMap;

use async_trait::async_trait;
use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::models::{
    Asset, AssetSearchResult, AssetType, ChartPoint, ChartRange, ProviderHealth, Quote, Region,
};
use crate::providers::{http, MarketDataProvider, ProviderCapabilities};
use crate::security::secrets;

pub const ALPHAVANTAGE_ID: &str = "alphavantage";
pub const ALPHAVANTAGE_NAME: &str = "Alpha Vantage";

const BASE: &str = "https://www.alphavantage.co/query";

/// Ranges this adapter can build from a daily series.
const RANGES: &[ChartRange] = &[
    ChartRange::Month,
    ChartRange::Quarter,
    ChartRange::Year,
    ChartRange::Max,
];

#[derive(Debug, Deserialize)]
struct DailyResponse {
    #[serde(rename = "Time Series (Daily)")]
    series: Option<HashMap<String, DailyBar>>,
    /// Present when the daily request budget is spent. The body is a 200 with a prose message
    /// rather than a 429, so this is the only way to detect it.
    #[serde(rename = "Note")]
    note: Option<String>,
    #[serde(rename = "Information")]
    information: Option<String>,
    #[serde(rename = "Error Message")]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DailyBar {
    #[serde(rename = "4. close")]
    close: String,
}

pub struct AlphaVantageProvider {
    client: reqwest::Client,
}

impl AlphaVantageProvider {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    fn key(&self) -> AppResult<String> {
        secrets::read(ALPHAVANTAGE_ID).ok_or(AppError::NotConfigured {
            provider_id: ALPHAVANTAGE_ID.to_string(),
        })
    }

    /// The bare ticker, from a canonical id like `stock:us:AAPL`.
    fn symbol_of(asset_id: &str) -> AppResult<String> {
        asset_id
            .rsplit(':')
            .next()
            .filter(|s| !s.is_empty())
            .map(str::to_uppercase)
            .ok_or(AppError::NotFound)
    }
}

/// How many trailing days each range keeps.
fn days_for(range: ChartRange) -> Option<usize> {
    match range {
        ChartRange::Month => Some(31),
        ChartRange::Quarter => Some(93),
        ChartRange::Year => Some(366),
        ChartRange::Max => None,
        // Intraday ranges are not served; the capability check rejects them before here.
        ChartRange::Day | ChartRange::Week => Some(7),
    }
}

/// Turns the response's date-keyed map into an ordered series.
///
/// Alpha Vantage returns an object, not an array, so ordering is this adapter's job — a chart
/// drawn from hash order is unreadable noise.
fn to_points(series: HashMap<String, DailyBar>, range: ChartRange) -> Vec<ChartPoint> {
    let mut points: Vec<ChartPoint> = series
        .into_iter()
        .filter_map(|(date, bar)| {
            let close: f64 = bar.close.parse().ok()?;
            if !close.is_finite() || close < 0.0 {
                return None;
            }
            // Dates are US/Eastern trading days; midday UTC keeps a bar on its own day
            // regardless of the reader's timezone.
            let parsed = chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").ok()?;
            let time = parsed.and_hms_opt(12, 0, 0)?.and_utc().timestamp();
            Some(ChartPoint { time, close })
        })
        .collect();

    points.sort_by_key(|p| p.time);

    if let Some(days) = days_for(range) {
        if points.len() > days {
            points.drain(..points.len() - days);
        }
    }

    points
}

#[async_trait]
impl MarketDataProvider for AlphaVantageProvider {
    fn id(&self) -> &str {
        ALPHAVANTAGE_ID
    }

    fn display_name(&self) -> &str {
        ALPHAVANTAGE_NAME
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            asset_types: vec![AssetType::Stock, AssetType::Etf],
            // Deliberately none of these: the 25-a-day budget belongs to charts. See the module
            // comment.
            search: false,
            quotes: false,
            charts: RANGES.to_vec(),
            profiles: false,
            regions: vec![Region::new(
                "us",
                "United States",
                "Daily closes for US-listed symbols.",
            )],
            requires_credential: true,
            attribution: "Data provided by Alpha Vantage".to_string(),
            docs_url: Some("https://www.alphavantage.co/documentation/".to_string()),
        }
    }

    async fn health(&self) -> ProviderHealth {
        if secrets::exists(ALPHAVANTAGE_ID) {
            ProviderHealth::Ok
        } else {
            ProviderHealth::NotConfigured
        }
    }

    async fn chart(&self, asset_id: &str, range: ChartRange) -> AppResult<Vec<ChartPoint>> {
        if !RANGES.contains(&range) {
            return Err(AppError::NotConfigured {
                provider_id: ALPHAVANTAGE_ID.to_string(),
            });
        }

        let key = self.key()?;
        let symbol = Self::symbol_of(asset_id)?;

        // `compact` is 100 trading days and covers everything but MAX, at the same request cost.
        // Asking for `full` by default would pull twenty years to draw one month.
        let size = if range == ChartRange::Max {
            "full"
        } else {
            "compact"
        };
        let url = format!(
            "{BASE}?function=TIME_SERIES_DAILY&symbol={symbol}&outputsize={size}&apikey={key}"
        );

        let response: DailyResponse =
            http::get_json(&self.client, ALPHAVANTAGE_ID, &url, None).await?;

        // The budget message arrives as a 200 with prose, so it has to be detected here rather
        // than by status code. Reported as rate-limited so the UI says the true thing.
        if let Some(note) = response.note.or(response.information) {
            tracing::warn!(
                provider = ALPHAVANTAGE_ID,
                "provider returned a notice instead of data"
            );
            if note.to_lowercase().contains("rate limit")
                || note.to_lowercase().contains("higher api call")
                || note.to_lowercase().contains("25 requests")
            {
                return Err(AppError::RateLimited {
                    provider_id: ALPHAVANTAGE_ID.to_string(),
                    retry_after_secs: None,
                });
            }
            return Err(AppError::InvalidResponse {
                provider_id: ALPHAVANTAGE_ID.to_string(),
                detail: "the provider returned a notice instead of data".into(),
            });
        }

        if response.error.is_some() {
            return Err(AppError::NotFound);
        }

        let Some(series) = response.series else {
            return Err(AppError::InvalidResponse {
                provider_id: ALPHAVANTAGE_ID.to_string(),
                detail: "no daily series in the response".into(),
            });
        };

        let points = to_points(series, range);
        if points.is_empty() {
            return Err(AppError::NotFound);
        }
        Ok(points)
    }

    // --- Not served. The capability advertises none of these, and the registry never routes
    // them here; these exist to satisfy the trait. ---

    async fn search_assets(
        &self,
        _query: &str,
        _limit: usize,
    ) -> AppResult<Vec<AssetSearchResult>> {
        Ok(Vec::new())
    }

    async fn quotes(&self, _asset_ids: &[String]) -> AppResult<Vec<Quote>> {
        Ok(Vec::new())
    }

    async fn market_list(
        &self,
        _asset_type: AssetType,
        _region: &str,
        _limit: usize,
    ) -> AppResult<Vec<Quote>> {
        Ok(Vec::new())
    }

    async fn asset(&self, _asset_id: &str) -> AppResult<Option<Asset>> {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bars(pairs: &[(&str, &str)]) -> HashMap<String, DailyBar> {
        pairs
            .iter()
            .map(|(d, c)| {
                (
                    (*d).to_string(),
                    DailyBar {
                        close: (*c).to_string(),
                    },
                )
            })
            .collect()
    }

    #[test]
    fn takes_the_ticker_out_of_a_canonical_id() {
        assert_eq!(
            AlphaVantageProvider::symbol_of("stock:us:aapl").unwrap(),
            "AAPL"
        );
        assert_eq!(
            AlphaVantageProvider::symbol_of("stock:us:MSFT").unwrap(),
            "MSFT"
        );
    }

    /// The response is an object keyed by date, so ordering is this adapter's responsibility.
    #[test]
    fn orders_the_series_oldest_first() {
        let points = to_points(
            bars(&[
                ("2026-01-03", "12"),
                ("2026-01-01", "10"),
                ("2026-01-02", "11"),
            ]),
            ChartRange::Max,
        );

        let closes: Vec<f64> = points.iter().map(|p| p.close).collect();
        assert_eq!(closes, vec![10.0, 11.0, 12.0]);
        for pair in points.windows(2) {
            assert!(pair[0].time < pair[1].time, "points must ascend in time");
        }
    }

    #[test]
    fn trims_to_the_requested_range_keeping_the_most_recent() {
        let many: Vec<(String, String)> = (1..=60)
            .map(|d| (format!("2026-03-{d:02}"), format!("{}", 100 + d)))
            .filter(|(date, _)| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok())
            .collect();
        let pairs: Vec<(&str, &str)> = many.iter().map(|(d, c)| (d.as_str(), c.as_str())).collect();

        let points = to_points(bars(&pairs), ChartRange::Month);
        assert!(points.len() <= 31);
        // The newest bar survives the trim; the oldest is what gets dropped.
        let last = points.last().unwrap();
        assert!(points.iter().all(|p| p.time <= last.time));
    }

    #[test]
    fn drops_bars_that_are_not_usable_rather_than_failing_the_whole_series() {
        let points = to_points(
            bars(&[
                ("2026-01-01", "10"),
                ("not-a-date", "11"),
                ("2026-01-02", "not-a-number"),
                ("2026-01-03", "-5"),
                ("2026-01-04", "13"),
            ]),
            ChartRange::Max,
        );

        let closes: Vec<f64> = points.iter().map(|p| p.close).collect();
        assert_eq!(
            closes,
            vec![10.0, 13.0],
            "one bad bar must not lose the good ones"
        );
    }

    #[test]
    fn advertises_charts_and_nothing_else() {
        let caps = AlphaVantageProvider::new(reqwest::Client::new()).capabilities();

        assert!(caps.requires_credential);
        assert!(!caps.charts.is_empty());
        // The 25-a-day budget belongs to charts. See the module comment.
        assert!(!caps.quotes, "quotes would spend the chart budget");
        assert!(!caps.search);
        assert!(!caps.profiles);
        assert!(!caps.attribution.is_empty());
    }

    #[test]
    fn offers_no_intraday_range() {
        let caps = AlphaVantageProvider::new(reqwest::Client::new()).capabilities();
        assert!(!caps.charts.contains(&ChartRange::Day));
        assert!(!caps.charts.contains(&ChartRange::Week));
    }

    #[tokio::test]
    async fn refuses_every_call_without_a_credential() {
        let provider = AlphaVantageProvider::new(reqwest::Client::new());
        // No key stored in the test environment, so this must not reach the network.
        let result = provider.chart("stock:us:AAPL", ChartRange::Month).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn an_unsupported_range_is_refused_before_a_request_is_built() {
        let provider = AlphaVantageProvider::new(reqwest::Client::new());
        assert!(matches!(
            provider.chart("stock:us:AAPL", ChartRange::Day).await,
            Err(AppError::NotConfigured { .. })
        ));
    }
}
