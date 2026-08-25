//! CoinGecko crypto market data.
//!
//! Terms, limits and attribution: `docs/PROVIDERS.md`. Response shapes verified against real
//! calls on 2026-08-22; the recorded responses are the test fixtures, so these tests never
//! touch the network.

use async_trait::async_trait;
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::models::{
    downsample, Asset, AssetSearchResult, AssetType, ChartPoint, ChartRange, ProviderHealth, Quote,
    Region, MAX_SPARKLINE_POINTS,
};
use crate::providers::governor::{Admission, RateLimitPolicy, RateLimitState};
use crate::providers::http::{get_json, AuthHeader};
use crate::providers::{MarketDataProvider, ProviderCapabilities};
use crate::security::secrets;

pub const COINGECKO_ID: &str = "coingecko";
pub const COINGECKO_NAME: &str = "CoinGecko";
const BASE_URL: &str = "https://api.coingecko.com/api/v3";

/// The canonical-id namespace for CoinGecko-sourced assets: `crypto:cg:bitcoin`.
const NAMESPACE: &str = "cg";

/// Documented Demo limit is 100/min; the keyless tier is lower and explicitly not guaranteed
/// stable, so without a key we stay well under anything published. See PROVIDERS.md.
const KEYED_PER_MINUTE: u32 = 100;
const KEYLESS_PER_MINUTE: u32 = 50;

pub struct CoinGeckoProvider {
    client: reqwest::Client,
    limiter: Mutex<RateLimitState>,
}

/// One row of `/coins/markets`.
///
/// Numbers arrive as either integer or float JSON — `f64` accepts both. Fields that can be
/// null for less-covered coins are `Option`, and a missing one drops that field rather than
/// the whole row.
#[derive(Debug, Deserialize)]
struct MarketRow {
    id: String,
    symbol: String,
    name: String,
    current_price: Option<f64>,
    market_cap: Option<f64>,
    total_volume: Option<f64>,
    price_change_percentage_24h: Option<f64>,
    #[serde(default)]
    price_change_percentage_7d_in_currency: Option<f64>,
    #[serde(default)]
    sparkline_in_7d: Option<Sparkline>,
}

#[derive(Debug, Deserialize)]
struct Sparkline {
    #[serde(default)]
    price: Vec<f64>,
}

/// `/coins/{id}/market_chart`. Only `prices` is consumed; the response also carries
/// `market_caps` and `total_volumes`, which nothing renders yet.
#[derive(Debug, Deserialize)]
struct MarketChartResponse {
    /// `[[unix_millis, price], …]`, oldest first.
    #[serde(default)]
    prices: Vec<[f64; 2]>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    coins: Vec<SearchCoin>,
}

#[derive(Debug, Deserialize)]
struct SearchCoin {
    id: String,
    name: String,
    symbol: String,
    #[serde(default)]
    market_cap_rank: Option<u32>,
}

impl CoinGeckoProvider {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            limiter: Mutex::new(RateLimitState::default()),
        }
    }

    pub fn canonical_id(coin_id: &str) -> String {
        format!("crypto:{NAMESPACE}:{coin_id}")
    }

    /// Recovers the provider's own id from a canonical id. Returns `None` for an id that
    /// belongs to a different namespace, so a Finnhub asset can never be sent here.
    fn coin_id(asset_id: &str) -> Option<&str> {
        asset_id.strip_prefix(&format!("crypto:{NAMESPACE}:"))
    }

    /// Read at request time, never held in memory between calls and never sent over IPC.
    fn auth(&self) -> Option<AuthHeader<'static>> {
        secrets::read(COINGECKO_ID).map(|key| AuthHeader {
            name: "x-cg-demo-api-key",
            value: key,
        })
    }

    fn policy(&self) -> RateLimitPolicy {
        let per_minute = if secrets::exists(COINGECKO_ID) {
            KEYED_PER_MINUTE
        } else {
            KEYLESS_PER_MINUTE
        };
        RateLimitPolicy::new(per_minute, 60)
    }

    /// Asks the governor for permission before a request leaves the machine.
    async fn admit(&self) -> AppResult<()> {
        let policy = self.policy();
        let mut state = self.limiter.lock().await;
        match state.admit(&policy, crate::models::now_epoch_secs()) {
            Admission::Allow => Ok(()),
            Admission::Deny { retry_after_secs } => Err(AppError::RateLimited {
                provider_id: COINGECKO_ID.to_string(),
                retry_after_secs: Some(retry_after_secs as u64),
            }),
        }
    }

    async fn record(&self, succeeded: bool) {
        let policy = self.policy();
        let mut state = self.limiter.lock().await;
        if succeeded {
            state.record_success();
        } else {
            // Full jitter, so several panels failing at once do not retry in lockstep.
            state.record_failure(&policy, crate::models::now_epoch_secs(), rand_jitter());
        }
    }

    async fn markets(&self, query: &str) -> AppResult<Vec<Quote>> {
        self.admit().await?;

        let url = format!("{BASE_URL}/coins/markets?{query}");
        let result: AppResult<Vec<MarketRow>> =
            get_json(&self.client, COINGECKO_ID, &url, self.auth()).await;

        self.record(result.is_ok()).await;

        Ok(normalize_rows(result?))
    }
}

/// Maps a range onto the provider's `days` parameter.
///
/// Granularity is chosen by CoinGecko, not by us: 1 day returns 5-minute points, 2–90 days
/// hourly, beyond that daily. `Max` returns `None` because the free tiers refuse it.
fn days_for(range: ChartRange) -> Option<u32> {
    match range {
        ChartRange::Day => Some(1),
        ChartRange::Week => Some(7),
        ChartRange::Month => Some(30),
        ChartRange::Quarter => Some(90),
        ChartRange::Year => Some(365),
        ChartRange::Max => None,
    }
}

/// Upper bound on points handed to the chart.
///
/// A 90-day hourly series is ~2,160 points. The canvas renderer copes, but on the reference
/// 2016 machine every point still costs parsing, IPC serialization and a JS array entry, and
/// no display shows more detail than this at chart width.
const MAX_CHART_POINTS: usize = 750;

/// `[[millis, price], …]` → validated `ChartPoint`s in seconds, oldest first.
fn normalize_chart(raw: Vec<[f64; 2]>) -> Vec<ChartPoint> {
    let mut points: Vec<ChartPoint> = raw
        .into_iter()
        .filter_map(|[millis, price]| {
            if !millis.is_finite() || !price.is_finite() || price < 0.0 {
                return None;
            }
            let time = (millis / 1000.0).round() as i64;
            // Same plausibility window the news validator uses: reject a timestamp that would
            // render as the year 33000 rather than drawing it.
            if !(946_684_800..=4_102_444_800).contains(&time) {
                return None;
            }
            Some(ChartPoint { time, close: price })
        })
        .collect();

    // The chart library requires strictly ascending, de-duplicated timestamps; a repeated
    // stamp makes it throw rather than skip the point.
    points.sort_by_key(|p| p.time);
    points.dedup_by_key(|p| p.time);

    if points.len() > MAX_CHART_POINTS {
        let last = points.len() - 1;
        points = (0..MAX_CHART_POINTS)
            .map(|i| points[(i * last) / (MAX_CHART_POINTS - 1)])
            .collect();
        points.dedup_by_key(|p| p.time);
    }

    points
}

/// A cheap jitter source. The governor only needs a spread, not cryptographic randomness, so
/// this avoids pulling in `rand` for one call.
fn rand_jitter() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    (nanos % 1000) as f64 / 1000.0
}

/// Provider DTOs → app-level quotes, with validation.
///
/// A row that fails validation is dropped with a counter rather than failing the request:
/// one malformed coin must not blank a whole table. See THREAT_MODEL.md §3.
fn normalize_rows(rows: Vec<MarketRow>) -> Vec<Quote> {
    let mut dropped = 0usize;

    let quotes: Vec<Quote> = rows
        .into_iter()
        .filter_map(|row| {
            let price = row.current_price?;

            let sparkline = row
                .sparkline_in_7d
                .map(|s| {
                    // 168 hourly points come back; the UI contract is at most 24.
                    let clean: Vec<f64> = s.price.into_iter().filter(|v| v.is_finite()).collect();
                    downsample(&clean, MAX_SPARKLINE_POINTS)
                })
                .unwrap_or_default();

            let quote = Quote {
                asset_id: CoinGeckoProvider::canonical_id(&row.id),
                symbol: row.symbol.to_uppercase(),
                name: row.name,
                asset_type: AssetType::Crypto,
                price,
                currency: "USD".into(),
                change_pct_24h: row.price_change_percentage_24h,
                change_pct_7d: row.price_change_percentage_7d_in_currency,
                market_cap: row.market_cap,
                volume_24h: row.total_volume,
                sparkline,
            };

            match quote.validate_and_normalize() {
                Ok(valid) => Some(valid),
                Err(reason) => {
                    tracing::debug!(reason, "dropping invalid CoinGecko row");
                    dropped += 1;
                    None
                }
            }
        })
        .collect();

    if dropped > 0 {
        tracing::warn!(dropped, "dropped invalid rows from CoinGecko response");
    }

    quotes
}

#[async_trait]
impl MarketDataProvider for CoinGeckoProvider {
    fn id(&self) -> &str {
        COINGECKO_ID
    }

    fn display_name(&self) -> &str {
        COINGECKO_NAME
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            asset_types: vec![AssetType::Crypto],
            search: true,
            quotes: true,
            /*
             * Every range except Max.
             *
             * The public and Demo tiers refuse `days=max` with error 10012 — historical data
             * is limited to the past 365 days. Advertising Max would put a button in the UI
             * that always fails, which is exactly what the capability flags exist to prevent.
             * A paid plan lifts the limit; this adapter would then add ChartRange::Max.
             */
            charts: vec![
                ChartRange::Day,
                ChartRange::Week,
                ChartRange::Month,
                ChartRange::Quarter,
                ChartRange::Year,
            ],
            profiles: false,
            regions: vec![Region::new(
                "global",
                "Global",
                "Crypto trades globally; region does not narrow this list.",
            )],
            requires_credential: false,
            attribution: "Data provided by CoinGecko".into(),
            docs_url: Some("https://www.coingecko.com/en/api".into()),
        }
    }

    async fn health(&self) -> ProviderHealth {
        let state = self.limiter.lock().await;
        if state.backoff_until.is_some() || state.retry_after_until.is_some() {
            ProviderHealth::RateLimited
        } else {
            ProviderHealth::Ok
        }
    }

    async fn search_assets(&self, query: &str, limit: usize) -> AppResult<Vec<AssetSearchResult>> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        self.admit().await?;

        let url = format!("{BASE_URL}/search?query={}", urlencode(trimmed));
        let result: AppResult<SearchResponse> =
            get_json(&self.client, COINGECKO_ID, &url, self.auth()).await;
        self.record(result.is_ok()).await;

        let response = result?;
        let needle = trimmed.to_lowercase();

        Ok(response
            .coins
            .into_iter()
            .take(limit)
            .map(|coin| {
                let symbol = coin.symbol.to_uppercase();
                // CoinGecko returns results already ranked; this only distinguishes an exact
                // ticker from a loose name match so the palette can order sensibly.
                let score = if symbol.to_lowercase() == needle {
                    1.0
                } else if coin.name.to_lowercase().starts_with(&needle) {
                    0.85
                } else {
                    // Better-known coins first among equally loose matches.
                    0.6 - (coin.market_cap_rank.unwrap_or(9999) as f64 / 100_000.0)
                };

                AssetSearchResult {
                    asset: Asset {
                        id: CoinGeckoProvider::canonical_id(&coin.id),
                        asset_type: AssetType::Crypto,
                        symbol,
                        name: coin.name,
                        currency: "USD".into(),
                        exchange: None,
                        region: Some("global".into()),
                    },
                    score: score.clamp(0.0, 1.0),
                }
            })
            .collect())
    }

    async fn quotes(&self, asset_ids: &[String]) -> AppResult<Vec<Quote>> {
        let coin_ids: Vec<&str> = asset_ids
            .iter()
            .filter_map(|id| Self::coin_id(id))
            .collect();
        if coin_ids.is_empty() {
            return Ok(Vec::new());
        }

        // One request for the whole watchlist. `/coins/markets` accepts a comma-separated
        // `ids` list, which is what makes this provider viable on a 10k-calls/month budget.
        let query = format!(
            "vs_currency=usd&ids={}&sparkline=true&price_change_percentage=7d&per_page=250&page=1",
            urlencode(&coin_ids.join(","))
        );
        self.markets(&query).await
    }

    async fn market_list(
        &self,
        asset_type: AssetType,
        _region: &str,
        limit: usize,
    ) -> AppResult<Vec<Quote>> {
        if asset_type != AssetType::Crypto {
            // Capability mismatch is a caller bug; returning empty would look like "no data".
            return Err(AppError::NotConfigured {
                provider_id: COINGECKO_ID.to_string(),
            });
        }

        let query = format!(
            "vs_currency=usd&order=market_cap_desc&per_page={}&page=1&sparkline=true&price_change_percentage=7d",
            limit.clamp(1, 250)
        );
        self.markets(&query).await
    }

    async fn asset(&self, asset_id: &str) -> AppResult<Option<Asset>> {
        let Some(coin_id) = Self::coin_id(asset_id) else {
            return Ok(None);
        };

        // Reuses the quotes path rather than adding a second endpoint: one fewer response
        // shape to validate, and it stays inside the same rate-limit accounting.
        let quotes = self.quotes(&[asset_id.to_string()]).await?;
        Ok(quotes.into_iter().next().map(|quote| Asset {
            id: CoinGeckoProvider::canonical_id(coin_id),
            asset_type: AssetType::Crypto,
            symbol: quote.symbol,
            name: quote.name,
            currency: quote.currency,
            exchange: None,
            region: Some("global".into()),
        }))
    }

    async fn chart(&self, asset_id: &str, range: ChartRange) -> AppResult<Vec<ChartPoint>> {
        let Some(coin_id) = Self::coin_id(asset_id) else {
            // An id from another provider is a routing bug, not missing data.
            return Err(AppError::NotConfigured {
                provider_id: COINGECKO_ID.to_string(),
            });
        };

        let Some(days) = days_for(range) else {
            return Err(AppError::NotConfigured {
                provider_id: COINGECKO_ID.to_string(),
            });
        };

        self.admit().await?;

        let url = format!(
            "{BASE_URL}/coins/{}/market_chart?vs_currency=usd&days={days}",
            urlencode(coin_id)
        );
        let result: AppResult<MarketChartResponse> =
            get_json(&self.client, COINGECKO_ID, &url, self.auth()).await;
        self.record(result.is_ok()).await;

        Ok(normalize_chart(result?.prices))
    }
}

/// Minimal percent-encoding for query values.
///
/// Only the characters that can appear in a coin id or a search term need handling, so this
/// avoids a dependency for a dozen lines. Anything outside the unreserved set is encoded.
fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b',' => {
                out.push(*byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Recorded from a real call on 2026-08-22 — see PROVIDERS.md.
    const MARKETS_FIXTURE: &str =
        include_str!("../../../../content/fixtures/providers/coingecko_markets.json");
    const SEARCH_FIXTURE: &str =
        include_str!("../../../../content/fixtures/providers/coingecko_search.json");

    fn parse_markets() -> Vec<MarketRow> {
        serde_json::from_str(MARKETS_FIXTURE).expect("recorded response no longer parses")
    }

    #[test]
    fn parses_a_real_recorded_response() {
        let rows = parse_markets();
        assert_eq!(rows.len(), 5);
        assert_eq!(rows[0].id, "bitcoin");
    }

    #[test]
    fn normalizes_into_valid_quotes() {
        let quotes = normalize_rows(parse_markets());
        assert_eq!(quotes.len(), 5);

        let btc = &quotes[0];
        assert_eq!(btc.asset_id, "crypto:cg:bitcoin");
        assert_eq!(btc.symbol, "BTC", "symbols are uppercased");
        assert_eq!(btc.currency, "USD");
        assert!(btc.price > 0.0);
        assert!(btc.market_cap.is_some());
    }

    #[test]
    fn downsamples_the_168_point_sparkline_to_the_ui_contract() {
        // The API returns hourly points over 7 days. Handing 168 points per row to the table
        // would be 168x the DOM work the sparkline is designed for.
        let raw = parse_markets();
        let raw_len = raw[0].sparkline_in_7d.as_ref().unwrap().price.len();
        assert_eq!(raw_len, 168, "recorded fixture should carry hourly points");

        let quotes = normalize_rows(raw);
        assert_eq!(quotes[0].sparkline.len(), MAX_SPARKLINE_POINTS);
    }

    #[test]
    fn canonical_ids_round_trip() {
        let id = CoinGeckoProvider::canonical_id("bitcoin");
        assert_eq!(id, "crypto:cg:bitcoin");
        assert_eq!(CoinGeckoProvider::coin_id(&id), Some("bitcoin"));
    }

    #[test]
    fn ignores_asset_ids_from_another_provider() {
        // A Finnhub id must never be sent to CoinGecko as a coin id.
        assert_eq!(CoinGeckoProvider::coin_id("stock:us:AAPL"), None);
        assert_eq!(CoinGeckoProvider::coin_id("crypto:other:bitcoin"), None);
    }

    #[test]
    fn drops_a_row_with_no_price_but_keeps_the_rest() {
        let mut rows = parse_markets();
        rows[1].current_price = None;

        let quotes = normalize_rows(rows);
        assert_eq!(quotes.len(), 4, "one row dropped, the others survive");
    }

    #[test]
    fn survives_null_market_cap_and_volume() {
        let mut rows = parse_markets();
        rows[0].market_cap = None;
        rows[0].total_volume = None;

        let quotes = normalize_rows(rows);
        assert_eq!(
            quotes.len(),
            5,
            "a missing field drops the field, not the row"
        );
        assert!(quotes[0].market_cap.is_none());
        assert!(quotes[0].price > 0.0);
    }

    #[test]
    fn parses_the_recorded_search_response() {
        let response: SearchResponse = serde_json::from_str(SEARCH_FIXTURE)
            .expect("recorded search response no longer parses");
        assert!(!response.coins.is_empty());
        assert_eq!(response.coins[0].id, "bitcoin");
    }

    #[test]
    fn capabilities_advertise_every_range_except_max() {
        // The free tiers cap history at 365 days, so Max would be a button that always fails.
        let caps = CoinGeckoProvider::new(reqwest::Client::new()).capabilities();
        assert!(caps.charts.contains(&ChartRange::Day));
        assert!(caps.charts.contains(&ChartRange::Year));
        assert!(
            !caps.charts.contains(&ChartRange::Max),
            "Max is not available on the public or Demo tier"
        );
        assert_eq!(caps.asset_types, vec![AssetType::Crypto]);
        assert!(!caps.requires_credential);
        assert!(!caps.attribution.is_empty(), "attribution is mandatory");
    }

    #[test]
    fn every_advertised_range_maps_to_a_days_parameter() {
        // A range the UI can select but the adapter cannot translate would be a dead button.
        let caps = CoinGeckoProvider::new(reqwest::Client::new()).capabilities();
        for range in caps.charts {
            assert!(days_for(range).is_some(), "{range:?} has no days mapping");
        }
        assert!(days_for(ChartRange::Max).is_none());
    }

    const CHART_1D: &str =
        include_str!("../../../../content/fixtures/providers/coingecko_chart_1d.json");
    const CHART_1Y: &str =
        include_str!("../../../../content/fixtures/providers/coingecko_chart_1y.json");

    fn chart_points(fixture: &str) -> Vec<ChartPoint> {
        let parsed: MarketChartResponse =
            serde_json::from_str(fixture).expect("recorded chart response no longer parses");
        normalize_chart(parsed.prices)
    }

    #[test]
    fn parses_a_real_recorded_chart_response() {
        let points = chart_points(CHART_1D);
        assert!(!points.is_empty());
        assert!(points.iter().all(|p| p.close > 0.0));
    }

    #[test]
    fn converts_milliseconds_to_seconds() {
        // The API sends millis; every other timestamp in this app is seconds.
        let points = chart_points(CHART_1D);
        let first = points.first().unwrap().time;
        assert!(
            (1_600_000_000..=4_102_444_800).contains(&first),
            "timestamp {first} does not look like Unix seconds"
        );
    }

    #[test]
    fn points_are_ascending_and_unique() {
        // lightweight-charts throws on an out-of-order or repeated timestamp.
        for fixture in [CHART_1D, CHART_1Y] {
            let points = chart_points(fixture);
            for pair in points.windows(2) {
                assert!(
                    pair[0].time < pair[1].time,
                    "timestamps must strictly ascend"
                );
            }
        }
    }

    #[test]
    fn drops_malformed_points_without_losing_the_series() {
        let raw = vec![
            [1_755_820_800_000.0, 100.0],
            [f64::NAN, 101.0],
            [1_755_824_400_000.0, f64::INFINITY],
            [1_755_828_000_000.0, -5.0],
            [1_755_831_600_000.0, 102.0],
        ];
        let points = normalize_chart(raw);
        assert_eq!(
            points.len(),
            2,
            "two good points survive, three bad ones are dropped"
        );
    }

    #[test]
    fn caps_a_long_series_while_keeping_the_endpoints() {
        let raw: Vec<[f64; 2]> = (0..5000)
            .map(|i| {
                [
                    1_600_000_000_000.0 + (i as f64) * 3_600_000.0,
                    100.0 + i as f64,
                ]
            })
            .collect();

        let first_ms = raw[0][0];
        let last_ms = raw[raw.len() - 1][0];
        let points = normalize_chart(raw);

        assert!(points.len() <= MAX_CHART_POINTS);
        assert_eq!(points.first().unwrap().time, (first_ms / 1000.0) as i64);
        assert_eq!(points.last().unwrap().time, (last_ms / 1000.0) as i64);
    }

    #[test]
    fn an_empty_series_is_not_an_error() {
        assert!(normalize_chart(Vec::new()).is_empty());
    }

    #[test]
    fn urlencode_escapes_what_matters() {
        assert_eq!(urlencode("bitcoin,ethereum"), "bitcoin,ethereum");
        assert_eq!(urlencode("bit coin"), "bit%20coin");
        assert_eq!(urlencode("a&b=c"), "a%26b%3Dc");
    }
}
