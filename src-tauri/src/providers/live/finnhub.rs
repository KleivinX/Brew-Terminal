//! Finnhub equity data.
//!
//! Terms, limits and attribution: `docs/PROVIDERS.md`. Response shapes come from Finnhub's own
//! OpenAPI document, not from prose — see the table in that file.
//!
//! Disabled until the user supplies a key: every endpoint here requires one.

use async_trait::async_trait;
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::error::{AppError, AppResult};
use crate::models::{
    Asset, AssetSearchResult, AssetType, ChartPoint, ChartRange, ProviderHealth, Quote, Region,
};
use crate::providers::governor::{Admission, RateLimitPolicy, RateLimitState};
use crate::providers::http::{get_json, AuthHeader};
use crate::providers::{MarketDataProvider, ProviderCapabilities};
use crate::security::secrets;

pub const FINNHUB_ID: &str = "finnhub";
pub const FINNHUB_NAME: &str = "Finnhub";
const BASE_URL: &str = "https://finnhub.io/api/v1";

/// Free plan: 60 calls/minute, with a 30 calls/second ceiling across all plans.
const PER_MINUTE: u32 = 60;

/// In-flight cap. `/quote` is one symbol per call, so a watchlist fans out; four at a time
/// stays comfortably under the 30/second ceiling while still finishing quickly.
const MAX_CONCURRENCY: usize = 4;

pub struct FinnhubProvider {
    client: reqwest::Client,
    limiter: Mutex<RateLimitState>,
}

/// `/quote`. Prices only — no symbol, name or currency comes back, which is why the adapter
/// needs the canonical asset to already exist locally.
#[derive(Debug, Deserialize)]
struct QuoteResponse {
    /// Current price.
    c: f64,
    /// Percent change.
    dp: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    result: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchHit {
    symbol: String,
    description: String,
    #[serde(rename = "displaySymbol", default)]
    display_symbol: Option<String>,
    #[serde(rename = "type", default)]
    kind: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CompanyProfile {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    ticker: Option<String>,
    #[serde(default)]
    exchange: Option<String>,
    #[serde(default)]
    currency: Option<String>,
}

impl FinnhubProvider {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            limiter: Mutex::new(RateLimitState::default()),
        }
    }

    pub fn canonical_id(symbol: &str) -> String {
        format!("stock:us:{}", symbol.to_uppercase())
    }

    fn symbol_of(asset_id: &str) -> Option<&str> {
        asset_id.strip_prefix("stock:us:")
    }

    /// The key travels in a header, never a query string: a key in a URL ends up in request
    /// logs, proxy logs and any error that echoes the URL. See PROVIDERS.md.
    fn auth(&self) -> AppResult<AuthHeader<'static>> {
        secrets::read(FINNHUB_ID)
            .map(|key| AuthHeader {
                name: "X-Finnhub-Token",
                value: key,
            })
            .ok_or_else(|| AppError::NotConfigured {
                provider_id: FINNHUB_ID.to_string(),
            })
    }

    fn policy(&self) -> RateLimitPolicy {
        RateLimitPolicy::new(PER_MINUTE, 60)
    }

    /// Reserves budget for `count` requests up front.
    ///
    /// `/quote` has no batch endpoint, so N symbols costs N calls. Asking for the whole budget
    /// before starting means the adapter declines cleanly instead of firing half a watchlist
    /// at the API and collecting 429s for the rest.
    async fn admit_many(&self, count: usize) -> AppResult<usize> {
        let policy = self.policy();
        let now = crate::models::now_epoch_secs();
        let mut state = self.limiter.lock().await;

        let mut granted = 0usize;
        let mut retry_after = 0i64;

        for _ in 0..count {
            match state.admit(&policy, now) {
                Admission::Allow => granted += 1,
                Admission::Deny { retry_after_secs } => {
                    retry_after = retry_after_secs;
                    break;
                }
            }
        }

        if granted == 0 {
            return Err(AppError::RateLimited {
                provider_id: FINNHUB_ID.to_string(),
                retry_after_secs: Some(retry_after.max(1) as u64),
            });
        }

        Ok(granted)
    }

    async fn record_success(&self) {
        self.limiter.lock().await.record_success();
    }

    async fn record_failure(&self) {
        let policy = self.policy();
        let mut state = self.limiter.lock().await;
        state.record_failure(&policy, crate::models::now_epoch_secs(), 0.5);
    }

    /// Fetches one symbol using owned inputs, so the future can be spawned onto the runtime
    /// rather than borrowing `self` — that is what makes the fan-out genuinely concurrent.
    async fn fetch_quote_owned(
        client: reqwest::Client,
        token: String,
        symbol: String,
    ) -> (String, AppResult<QuoteResponse>) {
        let url = format!("{BASE_URL}/quote?symbol={}", encode(&symbol));
        let auth = AuthHeader {
            name: "X-Finnhub-Token",
            value: token,
        };
        let result = get_json(&client, FINNHUB_ID, &url, Some(auth)).await;
        (symbol, result)
    }
}

#[async_trait]
impl MarketDataProvider for FinnhubProvider {
    fn id(&self) -> &str {
        FINNHUB_ID
    }

    fn display_name(&self) -> &str {
        FINNHUB_NAME
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            asset_types: vec![AssetType::Stock],
            search: true,
            quotes: true,
            // Candles are a premium endpoint on this provider, so no ranges are advertised.
            charts: Vec::new(),
            profiles: true,
            regions: vec![Region::new(
                "us",
                "United States",
                "US-listed equities. This adapter covers US symbols only.",
            )],
            requires_credential: true,
            attribution: "Market data by Finnhub".into(),
            docs_url: Some("https://finnhub.io/docs/api".into()),
        }
    }

    async fn health(&self) -> ProviderHealth {
        if !secrets::exists(FINNHUB_ID) {
            return ProviderHealth::NotConfigured;
        }
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

        let auth = self.auth()?;
        self.admit_many(1).await?;

        let url = format!("{BASE_URL}/search?q={}", encode(trimmed));
        let result: AppResult<SearchResponse> =
            get_json(&self.client, FINNHUB_ID, &url, Some(auth)).await;

        match &result {
            Ok(_) => self.record_success().await,
            Err(_) => self.record_failure().await,
        }

        let needle = trimmed.to_uppercase();

        Ok(result?
            .result
            .into_iter()
            // Common stock only: the raw feed includes warrants, units and other instruments
            // whose tickers look alike and which this app does not present.
            .filter(|hit| hit.kind.as_deref().map_or(true, |k| k == "Common Stock"))
            .filter(|hit| !hit.symbol.contains('.') && !hit.symbol.is_empty())
            .take(limit)
            .map(|hit| {
                let symbol = hit.display_symbol.unwrap_or_else(|| hit.symbol.clone());
                let score = if symbol.to_uppercase() == needle {
                    1.0
                } else {
                    0.7
                };

                AssetSearchResult {
                    asset: Asset {
                        id: FinnhubProvider::canonical_id(&symbol),
                        asset_type: AssetType::Stock,
                        symbol: symbol.to_uppercase(),
                        name: hit.description,
                        currency: "USD".into(),
                        exchange: None,
                        region: Some("us".into()),
                    },
                    score,
                }
            })
            .collect())
    }

    async fn quotes(&self, asset_ids: &[String]) -> AppResult<Vec<Quote>> {
        let symbols: Vec<String> = asset_ids
            .iter()
            .filter_map(|id| Self::symbol_of(id))
            .map(str::to_string)
            .collect();

        if symbols.is_empty() {
            return Ok(Vec::new());
        }

        // Ensure a key exists before spending any budget.
        self.auth()?;
        let granted = self.admit_many(symbols.len()).await?;

        if granted < symbols.len() {
            tracing::warn!(
                requested = symbols.len(),
                granted,
                "Finnhub budget covers only part of this watchlist; fetching what fits"
            );
        }

        let mut quotes = Vec::with_capacity(granted);
        let mut failures = 0usize;

        let token = self.auth()?.value;

        /*
         * Bounded fan-out. `/quote` is one symbol per call — see PROVIDERS.md — so a watchlist
         * becomes N requests. They run MAX_CONCURRENCY at a time on the runtime, which keeps
         * a 25-symbol refresh from taking 25 round trips end to end while staying far below
         * the provider's 30-calls-per-second ceiling.
         */
        for chunk in symbols[..granted].chunks(MAX_CONCURRENCY) {
            let mut set = tokio::task::JoinSet::new();
            for symbol in chunk {
                set.spawn(Self::fetch_quote_owned(
                    self.client.clone(),
                    token.clone(),
                    symbol.clone(),
                ));
            }

            let mut results = Vec::with_capacity(chunk.len());
            while let Some(joined) = set.join_next().await {
                match joined {
                    Ok(pair) => results.push(pair),
                    Err(error) => {
                        tracing::warn!(?error, "a Finnhub quote task did not complete");
                        failures += 1;
                    }
                }
            }

            for (symbol, result) in results {
                match result {
                    Ok(raw) => {
                        let quote = Quote {
                            asset_id: FinnhubProvider::canonical_id(&symbol),
                            symbol: symbol.to_uppercase(),
                            // `/quote` carries no name. The service layer fills it from the
                            // stored canonical asset; the symbol is a truthful placeholder.
                            name: symbol.to_uppercase(),
                            asset_type: AssetType::Stock,
                            price: raw.c,
                            currency: "USD".into(),
                            change_pct_24h: raw.dp,
                            // Finnhub's quote has no 7-day figure. Left absent rather than
                            // derived from data this adapter does not have.
                            change_pct_7d: None,
                            market_cap: None,
                            volume_24h: None,
                            sparkline: Vec::new(),
                        };

                        match quote.validate_and_normalize() {
                            Ok(valid) => quotes.push(valid),
                            Err(reason) => {
                                tracing::debug!(symbol, reason, "dropping invalid Finnhub quote");
                                failures += 1;
                            }
                        }
                    }
                    Err(error) => {
                        tracing::warn!(symbol, ?error, "Finnhub quote failed");
                        failures += 1;
                    }
                }
            }
        }

        if quotes.is_empty() && failures > 0 {
            self.record_failure().await;
            return Err(AppError::ProviderError {
                provider_id: FINNHUB_ID.to_string(),
                status: None,
            });
        }

        self.record_success().await;
        Ok(quotes)
    }

    async fn market_list(
        &self,
        asset_type: AssetType,
        _region: &str,
        _limit: usize,
    ) -> AppResult<Vec<Quote>> {
        if asset_type != AssetType::Stock {
            return Err(AppError::NotConfigured {
                provider_id: FINNHUB_ID.to_string(),
            });
        }

        // There is no "top stocks" endpoint on this API, and inventing a ranking would be
        // presenting an editorial list as market data. The default set is supplied by the
        // service layer instead; this adapter only answers for symbols it is asked about.
        Err(AppError::NotConfigured {
            provider_id: FINNHUB_ID.to_string(),
        })
    }

    async fn asset(&self, asset_id: &str) -> AppResult<Option<Asset>> {
        let Some(symbol) = Self::symbol_of(asset_id) else {
            return Ok(None);
        };

        let auth = self.auth()?;
        self.admit_many(1).await?;

        let url = format!("{BASE_URL}/stock/profile2?symbol={}", encode(symbol));
        let result: AppResult<CompanyProfile> =
            get_json(&self.client, FINNHUB_ID, &url, Some(auth)).await;

        match &result {
            Ok(_) => self.record_success().await,
            Err(_) => self.record_failure().await,
        }

        let profile = result?;

        // An unknown symbol comes back as an empty object rather than a 404.
        if profile.name.is_none() && profile.ticker.is_none() {
            return Ok(None);
        }

        Ok(Some(Asset {
            id: asset_id.to_string(),
            asset_type: AssetType::Stock,
            symbol: profile
                .ticker
                .unwrap_or_else(|| symbol.to_uppercase())
                .to_uppercase(),
            name: profile.name.unwrap_or_else(|| symbol.to_uppercase()),
            currency: profile.currency.unwrap_or_else(|| "USD".into()),
            exchange: profile.exchange,
            region: Some("us".into()),
        }))
    }

    async fn chart(&self, _asset_id: &str, _range: ChartRange) -> AppResult<Vec<ChartPoint>> {
        // Candles are premium on this provider; not advertised, so never offered.
        Err(AppError::NotConfigured {
            provider_id: FINNHUB_ID.to_string(),
        })
    }
}

fn encode(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_documented_quote_shape() {
        // Shape from Finnhub's OpenAPI document; see PROVIDERS.md.
        let raw = r#"{"c":214.29,"d":1.7,"dp":0.8,"h":215.1,"l":212.0,"o":213.0,"pc":212.59,"t":1755820800}"#;
        let quote: QuoteResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(quote.c, 214.29);
        assert_eq!(quote.dp, Some(0.8));
    }

    #[test]
    fn tolerates_a_quote_with_no_percent_change() {
        let quote: QuoteResponse = serde_json::from_str(r#"{"c":10.0}"#).unwrap();
        assert!(quote.dp.is_none());
    }

    #[test]
    fn parses_the_documented_search_shape() {
        let raw = r#"{"count":2,"result":[
            {"description":"APPLE INC","displaySymbol":"AAPL","symbol":"AAPL","type":"Common Stock"},
            {"description":"APPLE INC WARRANT","displaySymbol":"AAPL.WS","symbol":"AAPL.WS","type":"Warrant"}
        ]}"#;
        let response: SearchResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(response.result.len(), 2);
    }

    #[test]
    fn parses_an_empty_profile_for_an_unknown_symbol() {
        // Finnhub answers an unknown symbol with `{}`, not a 404.
        let profile: CompanyProfile = serde_json::from_str("{}").unwrap();
        assert!(profile.name.is_none());
        assert!(profile.ticker.is_none());
    }

    #[test]
    fn canonical_ids_round_trip_and_reject_other_namespaces() {
        let id = FinnhubProvider::canonical_id("aapl");
        assert_eq!(id, "stock:us:AAPL");
        assert_eq!(FinnhubProvider::symbol_of(&id), Some("AAPL"));
        assert_eq!(FinnhubProvider::symbol_of("crypto:cg:bitcoin"), None);
    }

    #[test]
    fn capabilities_declare_a_required_credential_and_no_charts() {
        let caps = FinnhubProvider::new(reqwest::Client::new()).capabilities();
        assert!(caps.requires_credential);
        assert!(
            caps.charts.is_empty(),
            "candles are premium on this provider"
        );
        assert_eq!(caps.asset_types, vec![AssetType::Stock]);
        assert!(!caps.attribution.is_empty());
    }

    #[tokio::test]
    async fn every_call_refuses_without_a_credential() {
        // Nothing may leave the machine before the user has configured this provider.
        let provider = FinnhubProvider::new(reqwest::Client::new());

        let quotes = provider.quotes(&["stock:us:AAPL".to_string()]).await;
        assert!(matches!(quotes, Err(AppError::NotConfigured { .. })));

        let search = provider.search_assets("apple", 5).await;
        assert!(matches!(search, Err(AppError::NotConfigured { .. })));

        let asset = provider.asset("stock:us:AAPL").await;
        assert!(matches!(asset, Err(AppError::NotConfigured { .. })));
    }

    #[tokio::test]
    async fn an_empty_symbol_list_makes_no_request() {
        let provider = FinnhubProvider::new(reqwest::Client::new());
        assert!(provider.quotes(&[]).await.unwrap().is_empty());
        // Ids belonging to another provider are filtered out, not sent as symbols.
        assert!(provider
            .quotes(&["crypto:cg:bitcoin".to_string()])
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn reports_not_configured_health_without_a_key() {
        let provider = FinnhubProvider::new(reqwest::Client::new());
        assert_eq!(provider.health().await, ProviderHealth::NotConfigured);
    }

    #[test]
    fn encode_escapes_query_values() {
        assert_eq!(encode("AAPL"), "AAPL");
        assert_eq!(encode("BRK.B"), "BRK.B");
        assert_eq!(encode("a b&c"), "a%20b%26c");
    }
}
