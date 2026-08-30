use std::collections::HashMap;

use serde::de::DeserializeOwned;
use serde::Serialize;

use super::degraded_from;
use crate::db::{repo_assets, repo_cache};
use crate::error::{AppError, AppResult};
use crate::models::{
    now_epoch_secs, Asset, AssetSearchResult, AssetType, ChartPoint, ChartRange, Degraded,
    DegradedReason, Envelope, EnvelopeMeta, EnvelopeSource, NewsArticle, NewsFilter, Quote,
};
use crate::providers::cache::{cache_key, CacheKind};
use crate::providers::registry::asset_type_of;
use crate::state::{with_db, AppState};

/// The default equity list.
///
/// Finnhub has no "most popular stocks" endpoint, and inventing a ranking would be presenting
/// an editorial choice as market data. This is a fixed, widely-recognised starting set so the
/// Stocks tab is not empty on first run — explicitly not a recommendation, and the UI says so.
/// The user's own watchlist is the list that matters.
const DEFAULT_US_EQUITIES: &[&str] = &[
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "JPM", "V", "KO",
];

/// Read-through cache with stale-while-revalidate.
///
///   1. Ask the provider.
///   2. On success, write the cache and return fresh data.
///   3. On a provider failure, fall back to cache and return it marked stale + degraded.
///   4. With nothing cached, return an empty payload that still carries the degraded reason.
///
/// Step 4 is why a first-run failure shows "provider unavailable" rather than a blank table
/// with no explanation.
pub(crate) async fn cached_or_degraded<T, F, Fut>(
    state: &AppState,
    kind: CacheKind,
    key: String,
    provider_id: &str,
    provider_name: &str,
    source: EnvelopeSource,
    fetch: F,
) -> AppResult<Envelope<Vec<T>>>
where
    T: Serialize + DeserializeOwned + Send + 'static,
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = AppResult<Vec<T>>>,
{
    let now = now_epoch_secs();

    match fetch().await {
        Ok(data) => {
            if let Ok(payload) = serde_json::to_string(&data) {
                let pool = state.pool.clone();
                let (key, provider_id_owned, kind_str, ttl) = (
                    key.clone(),
                    provider_id.to_string(),
                    kind.as_str().to_string(),
                    kind.ttl_seconds(),
                );
                // A cache write must never fail the request the user is waiting on.
                if let Err(error) = with_db(pool, move |conn| {
                    repo_cache::put(
                        conn,
                        &key,
                        &provider_id_owned,
                        &kind_str,
                        &payload,
                        ttl,
                        now,
                    )
                })
                .await
                {
                    tracing::warn!(?error, "cache write failed; serving live data anyway");
                }
            }

            Ok(Envelope::fresh(data, provider_id, provider_name, source))
        }

        Err(error) => {
            let Some(degraded) = degraded_from(&error) else {
                return Err(error);
            };

            tracing::warn!(provider = provider_id, ?error, "provider request failed");

            let pool = state.pool.clone();
            let lookup_key = key.clone();
            let cached = with_db(pool, move |conn| repo_cache::get(conn, &lookup_key)).await?;

            let (data, fetched_at) = match cached {
                Some(entry) => match serde_json::from_str::<Vec<T>>(&entry.payload_json) {
                    Ok(data) => (data, entry.fetched_at),
                    Err(parse_error) => {
                        tracing::warn!(?parse_error, "cached payload could not be read");
                        (Vec::new(), now)
                    }
                },
                None => (Vec::new(), now),
            };

            let fetched_at =
                chrono::DateTime::from_timestamp(fetched_at, 0).unwrap_or_else(chrono::Utc::now);

            Ok(
                Envelope::stale_at(data, provider_id, provider_name, fetched_at)
                    .with_degraded(degraded),
            )
        }
    }
}

/// Envelope for "no provider is configured for this".
fn not_configured<T: Default>(kind: &str) -> Envelope<T> {
    Envelope::fresh(T::default(), "none", "No provider", EnvelopeSource::Live).with_degraded(
        Degraded {
            reason: DegradedReason::NotConfigured,
            retry_after: None,
            message: format!(
                "No {kind} provider is set up yet. Add one in Settings → Data providers."
            ),
        },
    )
}

/// Combines the metadata of several providers into one envelope header.
///
/// A watchlist can mix crypto and equities, which come from different providers. Both have to
/// be credited, so the display name lists every contributor — attribution is not something the
/// UI gets to drop because the data came from more than one place.
fn merge_meta(parts: Vec<EnvelopeMeta>) -> EnvelopeMeta {
    if parts.len() == 1 {
        return parts.into_iter().next().expect("length checked");
    }

    let names: Vec<String> = parts
        .iter()
        .map(|m| m.provider_name.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();

    // Oldest contributor wins: the panel is only as fresh as its stalest part.
    let oldest = parts
        .iter()
        .min_by(|a, b| a.fetched_at.cmp(&b.fetched_at))
        .map(|m| m.fetched_at.clone())
        .unwrap_or_else(crate::models::now_iso8601);

    EnvelopeMeta {
        provider_id: "multi".into(),
        provider_name: names.join(" · "),
        fetched_at: oldest,
        source: if parts.iter().any(|m| m.source == EnvelopeSource::Mock) {
            EnvelopeSource::Mock
        } else if parts.iter().any(|m| m.source == EnvelopeSource::Cache) {
            EnvelopeSource::Cache
        } else {
            EnvelopeSource::Live
        },
        stale: parts.iter().any(|m| m.stale),
        // Surfaces the first problem rather than hiding it behind a partly-successful result.
        degraded: parts.into_iter().find_map(|m| m.degraded),
    }
}

/// Whether an envelope is carrying real data or fixtures.
///
/// Every mock provider must be listed here. v0.1.0 checked only the market mock, so fixture
/// community posts were labelled `Live` and the UI's "fixtures" marker never appeared on that
/// panel. (Fixture *news* had the same bug; that provider has since been deleted outright.)
/// Anything that can serve invented data belongs in this list.
pub(crate) fn source_for(provider_id: &str) -> EnvelopeSource {
    let is_mock = provider_id == crate::providers::mock::market::MOCK_PROVIDER_ID
        || provider_id == crate::providers::mock::community::MOCK_COMMUNITY_ID;

    if is_mock {
        EnvelopeSource::Mock
    } else {
        EnvelopeSource::Live
    }
}

pub async fn search_assets(
    state: &AppState,
    query: String,
    limit: usize,
) -> AppResult<Envelope<Vec<AssetSearchResult>>> {
    let providers = state.registry.enabled_market_providers();
    if providers.is_empty() {
        return Ok(not_configured("market data"));
    }

    let limit = limit.clamp(1, 50);
    let mut all: Vec<AssetSearchResult> = Vec::new();
    let mut metas: Vec<EnvelopeMeta> = Vec::new();

    // Fans out across providers so one search covers crypto and equities together.
    for provider in providers {
        if !provider.capabilities().search {
            continue;
        }

        let key = cache_key(provider.id(), "search", &[query.clone(), limit.to_string()]);
        let id = provider.id().to_string();
        let name = provider.display_name().to_string();
        let source = source_for(&id);
        let query = query.clone();

        let result = cached_or_degraded(state, CacheKind::Search, key, &id, &name, source, || {
            let provider = provider.clone();
            async move { provider.search_assets(&query, limit).await }
        })
        .await?;

        all.extend(result.data);
        metas.push(result.meta);
    }

    all.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    all.truncate(limit);

    Ok(Envelope {
        data: all,
        meta: merge_meta(metas),
    })
}

/// Quotes for a mixed set of assets.
///
/// Ids are grouped by the provider that owns them and fetched per provider, then merged. Each
/// provider still receives one batched call for its share.
pub async fn get_quotes(
    state: &AppState,
    asset_ids: Vec<String>,
) -> AppResult<Envelope<Vec<Quote>>> {
    if asset_ids.is_empty() {
        return Ok(Envelope::fresh(
            Vec::new(),
            "none",
            "No provider",
            EnvelopeSource::Live,
        ));
    }

    if asset_ids.len() > 200 {
        return Err(AppError::Validation {
            field: "assetIds".into(),
            detail: "at most 200 assets can be requested at once".into(),
        });
    }

    let mut by_provider: HashMap<String, Vec<String>> = HashMap::new();
    let mut unroutable = false;

    for asset_id in &asset_ids {
        match state.registry.market_for_asset_id(asset_id) {
            Some(provider) => by_provider
                .entry(provider.id().to_string())
                .or_default()
                .push(asset_id.clone()),
            None => unroutable = true,
        }
    }

    if by_provider.is_empty() {
        return Ok(not_configured("market data"));
    }

    let mut quotes: Vec<Quote> = Vec::new();
    let mut metas: Vec<EnvelopeMeta> = Vec::new();

    for (provider_id, ids) in by_provider {
        let Some(provider) = state.registry.market_for_asset_id(&ids[0]) else {
            continue;
        };

        let key = cache_key(&provider_id, "quotes", &ids);
        let name = provider.display_name().to_string();
        let source = source_for(&provider_id);

        let result = cached_or_degraded(
            state,
            CacheKind::Quote,
            key,
            &provider_id,
            &name,
            source,
            || {
                let provider = provider.clone();
                let ids = ids.clone();
                async move { provider.quotes(&ids).await }
            },
        )
        .await?;

        quotes.extend(result.data);
        metas.push(result.meta);
    }

    // A provider returning only a symbol (Finnhub's /quote carries no name) gets its display
    // name filled from the canonical asset stored locally.
    let ids: Vec<String> = quotes.iter().map(|q| q.asset_id.clone()).collect();
    let stored = with_db(state.pool.clone(), move |conn| {
        repo_assets::get_many(conn, &ids)
    })
    .await?;
    let names: HashMap<String, String> = stored.into_iter().map(|a| (a.id, a.name)).collect();
    for quote in &mut quotes {
        if quote.name == quote.symbol {
            if let Some(name) = names.get(&quote.asset_id) {
                quote.name = name.clone();
            }
        }
    }

    let mut meta = merge_meta(metas);
    if unroutable && meta.degraded.is_none() {
        meta.stale = true;
        meta.degraded = Some(Degraded {
            reason: DegradedReason::NotConfigured,
            retry_after: None,
            message: "Some assets have no provider set up, so they are not shown.".into(),
        });
    }

    Ok(Envelope { data: quotes, meta })
}

pub async fn get_market_list(
    state: &AppState,
    asset_type: AssetType,
    region: String,
    limit: usize,
) -> AppResult<Envelope<Vec<Quote>>> {
    let Some(provider) = state.registry.market_for(asset_type) else {
        return Ok(not_configured("market data"));
    };

    let limit = limit.clamp(1, 200);
    let provider_id = provider.id().to_string();
    let name = provider.display_name().to_string();
    let source = source_for(&provider_id);

    // Providers with no "top assets" endpoint (Finnhub) are asked for a fixed default set
    // instead. See DEFAULT_US_EQUITIES.
    let uses_default_list = asset_type != AssetType::Crypto
        && provider_id == crate::providers::live::finnhub::FINNHUB_ID;

    let key = cache_key(
        &provider_id,
        "market_list",
        &[
            asset_type.as_str().to_string(),
            region.clone(),
            limit.to_string(),
        ],
    );

    cached_or_degraded(
        state,
        CacheKind::Quote,
        key,
        &provider_id,
        &name,
        source,
        || {
            let provider = provider.clone();
            let region = region.clone();
            async move {
                if uses_default_list {
                    let ids: Vec<String> = DEFAULT_US_EQUITIES
                        .iter()
                        .take(limit)
                        .map(|symbol| {
                            crate::providers::live::finnhub::FinnhubProvider::canonical_id(symbol)
                        })
                        .collect();
                    provider.quotes(&ids).await
                } else {
                    provider.market_list(asset_type, &region, limit).await
                }
            }
        },
    )
    .await
}

pub async fn get_asset(state: &AppState, asset_id: String) -> AppResult<Option<Asset>> {
    // Prefer the locally stored canonical asset: it is what watchlists reference, it works
    // offline, and it costs no provider budget.
    let lookup = asset_id.clone();
    if let Some(asset) = with_db(state.pool.clone(), move |conn| {
        repo_assets::get(conn, &lookup)
    })
    .await?
    {
        return Ok(Some(asset));
    }

    let Some(provider) = state.registry.market_for_asset_id(&asset_id) else {
        return Ok(None);
    };

    let asset = provider.asset(&asset_id).await?;

    // Cache it so the next lookup is local and the watchlist foreign key can be satisfied.
    if let Some(found) = asset.clone() {
        let now = now_epoch_secs();
        let _ = with_db(state.pool.clone(), move |conn| {
            repo_assets::upsert(conn, &found, now)
        })
        .await;
    }

    Ok(asset)
}

pub async fn get_chart(
    state: &AppState,
    asset_id: String,
    range: ChartRange,
) -> AppResult<Envelope<Vec<ChartPoint>>> {
    let Some(provider) = state.registry.market_for_asset_id(&asset_id) else {
        return Ok(not_configured("market data"));
    };

    // Capability check: a provider that cannot serve this range gets a clear not-configured
    // state rather than an empty chart the user cannot interpret.
    if !provider.capabilities().charts.contains(&range) {
        return Ok(not_configured("chart"));
    }

    let kind = CacheKind::for_chart(range);
    let provider_id = provider.id().to_string();
    let name = provider.display_name().to_string();
    let source = source_for(&provider_id);
    let key = cache_key(
        &provider_id,
        "chart",
        &[asset_id.clone(), format!("{range:?}")],
    );

    cached_or_degraded(state, kind, key, &provider_id, &name, source, || {
        let provider = provider.clone();
        let asset_id = asset_id.clone();
        async move { provider.chart(&asset_id, range).await }
    })
    .await
}

pub async fn get_news(
    state: &AppState,
    filter: NewsFilter,
) -> AppResult<Envelope<Vec<NewsArticle>>> {
    let Some(provider) = state.registry.news() else {
        return Ok(not_configured("news"));
    };
    let key = cache_key(
        provider.id(),
        "news",
        &[filter.category.clone(), filter.limit.to_string()],
    );
    let (id, name) = (
        provider.id().to_string(),
        provider.display_name().to_string(),
    );
    let source = source_for(&id);

    cached_or_degraded(state, CacheKind::News, key, &id, &name, source, || {
        let provider = provider.clone();
        let filter = NewsFilter {
            category: filter.category.clone(),
            asset_id: filter.asset_id.clone(),
            limit: filter.limit.clamp(1, 100),
        };
        async move { provider.news(&filter).await }
    })
    .await
}

/// Exposed for the settings "test connection" action.
pub fn asset_type_for_id(asset_id: &str) -> Option<AssetType> {
    asset_type_of(asset_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(provider: &str, name: &str, fetched: &str, source: EnvelopeSource) -> EnvelopeMeta {
        EnvelopeMeta {
            provider_id: provider.into(),
            provider_name: name.into(),
            fetched_at: fetched.into(),
            source,
            stale: false,
            degraded: None,
        }
    }

    /// Regression test. `source_for` used to check only the market mock, so fixture news and
    /// fixture community posts were labelled live and the UI's "fixtures" marker never showed
    /// on those panels.
    #[test]
    fn every_mock_provider_is_labelled_as_fixtures() {
        use crate::providers::mock;

        for id in [
            mock::market::MOCK_PROVIDER_ID,
            mock::community::MOCK_COMMUNITY_ID,
        ] {
            assert_eq!(
                source_for(id),
                EnvelopeSource::Mock,
                "{id} serves fixtures and must be labelled as such"
            );
        }
    }

    #[test]
    fn real_providers_are_labelled_live() {
        use crate::providers::live;

        for id in [
            live::coingecko::COINGECKO_ID,
            live::finnhub::FINNHUB_ID,
            live::rss::RSS_PROVIDER_ID,
        ] {
            assert_eq!(
                source_for(id),
                EnvelopeSource::Live,
                "{id} is a real source"
            );
        }
    }

    #[test]
    fn a_single_provider_keeps_its_own_identity() {
        let merged = merge_meta(vec![meta(
            "coingecko",
            "CoinGecko",
            "2026-08-22T00:00:00Z",
            EnvelopeSource::Live,
        )]);
        assert_eq!(merged.provider_id, "coingecko");
        assert_eq!(merged.provider_name, "CoinGecko");
    }

    #[test]
    fn merging_credits_every_contributor() {
        // A mixed watchlist must attribute both providers, not just the first one.
        let merged = merge_meta(vec![
            meta(
                "coingecko",
                "CoinGecko",
                "2026-08-22T00:01:00Z",
                EnvelopeSource::Live,
            ),
            meta(
                "finnhub",
                "Finnhub",
                "2026-08-22T00:00:00Z",
                EnvelopeSource::Live,
            ),
        ]);

        assert_eq!(merged.provider_id, "multi");
        assert!(merged.provider_name.contains("CoinGecko"));
        assert!(merged.provider_name.contains("Finnhub"));
    }

    #[test]
    fn merged_freshness_is_the_stalest_contributor() {
        let merged = merge_meta(vec![
            meta("a", "A", "2026-08-22T00:05:00Z", EnvelopeSource::Live),
            meta("b", "B", "2026-08-22T00:00:00Z", EnvelopeSource::Live),
        ]);
        assert_eq!(merged.fetched_at, "2026-08-22T00:00:00Z");
    }

    #[test]
    fn any_mock_contributor_marks_the_whole_panel_as_mock() {
        // Otherwise half-fixture data could present itself as live.
        let merged = merge_meta(vec![
            meta(
                "coingecko",
                "CoinGecko",
                "2026-08-22T00:00:00Z",
                EnvelopeSource::Live,
            ),
            meta(
                "mock",
                "Mock provider",
                "2026-08-22T00:00:00Z",
                EnvelopeSource::Mock,
            ),
        ]);
        assert_eq!(merged.source, EnvelopeSource::Mock);
    }

    #[test]
    fn a_degraded_contributor_is_surfaced_not_hidden() {
        let mut bad = meta(
            "finnhub",
            "Finnhub",
            "2026-08-22T00:00:00Z",
            EnvelopeSource::Live,
        );
        bad.stale = true;
        bad.degraded = Some(Degraded {
            reason: DegradedReason::RateLimited,
            retry_after: None,
            message: "limit reached".into(),
        });

        let merged = merge_meta(vec![
            meta(
                "coingecko",
                "CoinGecko",
                "2026-08-22T00:00:00Z",
                EnvelopeSource::Live,
            ),
            bad,
        ]);

        assert!(merged.stale);
        assert_eq!(merged.degraded.unwrap().reason, DegradedReason::RateLimited);
    }

    #[test]
    fn not_configured_envelope_explains_itself() {
        let envelope: Envelope<Vec<Quote>> = not_configured("market data");
        let degraded = envelope.meta.degraded.expect("must carry a reason");
        assert_eq!(degraded.reason, DegradedReason::NotConfigured);
        assert!(degraded.message.contains("Settings"));
    }

    #[test]
    fn the_default_equity_list_is_a_fixed_set_not_a_ranking() {
        assert!(!DEFAULT_US_EQUITIES.is_empty());
        assert!(DEFAULT_US_EQUITIES.contains(&"AAPL"));
    }
}
