//! Live provider smoke tests.
//!
//! **Ignored by default.** These make real network calls, so they are not part of CI: a
//! provider outage is not a reason for a build to fail, and a test suite should not spend
//! someone's rate-limit budget on every run.
//!
//! Run them by hand when an adapter changes, or when re-checking the terms review:
//!
//! ```bash
//! cargo test --test live_network -- --ignored --nocapture
//! ```

use brew_terminal_lib::models::AssetType;
use brew_terminal_lib::providers::live::CoinGeckoProvider;
use brew_terminal_lib::providers::{http, MarketDataProvider};

fn provider() -> CoinGeckoProvider {
    CoinGeckoProvider::new(http::build_client().expect("client"))
}

#[tokio::test]
#[ignore = "makes a real network call"]
async fn coingecko_market_list_answers_with_usable_quotes() {
    let quotes = provider()
        .market_list(AssetType::Crypto, "global", 5)
        .await
        .expect("CoinGecko market list failed");

    assert!(!quotes.is_empty(), "expected rows from the live API");
    println!("received {} live quotes", quotes.len());

    for quote in &quotes {
        println!(
            "  {} {} price={} cap={:?} spark={}",
            quote.asset_id,
            quote.symbol,
            quote.price,
            quote.market_cap,
            quote.sparkline.len()
        );

        assert!(quote.asset_id.starts_with("crypto:cg:"));
        assert!(quote.price.is_finite() && quote.price > 0.0);
        assert_eq!(quote.currency, "USD");
        assert_eq!(quote.symbol, quote.symbol.to_uppercase());
        // The API returns 168 hourly points; the UI contract is at most 24.
        assert!(quote.sparkline.len() <= 24, "sparkline was not downsampled");
    }
}

#[tokio::test]
#[ignore = "makes a real network call"]
async fn coingecko_batches_a_watchlist_into_one_request() {
    let ids = vec![
        "crypto:cg:bitcoin".to_string(),
        "crypto:cg:ethereum".to_string(),
        "crypto:cg:solana".to_string(),
    ];

    let quotes = provider()
        .quotes(&ids)
        .await
        .expect("CoinGecko quotes failed");

    assert_eq!(quotes.len(), 3, "one call should return all three");
    let symbols: Vec<&str> = quotes.iter().map(|q| q.symbol.as_str()).collect();
    println!("batched quotes: {symbols:?}");
}

#[tokio::test]
#[ignore = "makes a real network call"]
async fn coingecko_search_finds_a_known_coin() {
    let results = provider()
        .search_assets("bitcoin", 5)
        .await
        .expect("CoinGecko search failed");

    assert!(!results.is_empty());
    assert!(results.iter().any(|r| r.asset.id == "crypto:cg:bitcoin"));
    println!(
        "search returned: {:?}",
        results
            .iter()
            .map(|r| r.asset.symbol.as_str())
            .collect::<Vec<_>>()
    );
}

#[tokio::test]
#[ignore = "makes a real network call"]
async fn coingecko_rejects_a_wrong_asset_type_rather_than_returning_nothing() {
    // Asking a crypto provider for equities is a caller bug; it must not look like "no data".
    let result = provider().market_list(AssetType::Stock, "us", 5).await;
    assert!(result.is_err());
}

#[tokio::test]
#[ignore = "makes a real network call"]
async fn coingecko_chart_returns_a_renderable_series() {
    use brew_terminal_lib::models::ChartRange;

    for range in [ChartRange::Day, ChartRange::Month, ChartRange::Year] {
        let points = provider()
            .chart("crypto:cg:bitcoin", range)
            .await
            .unwrap_or_else(|e| panic!("chart {range:?} failed: {e:?}"));

        println!(
            "{range:?}: {} points, {} .. {}",
            points.len(),
            points.first().map(|p| p.time).unwrap_or(0),
            points.last().map(|p| p.time).unwrap_or(0)
        );

        assert!(!points.is_empty(), "{range:?} returned nothing");
        assert!(points.len() <= 750, "series was not capped");

        for pair in points.windows(2) {
            assert!(
                pair[0].time < pair[1].time,
                "{range:?} points must strictly ascend for the renderer"
            );
        }
        for point in &points {
            assert!(point.close > 0.0 && point.close.is_finite());
            // Seconds, not the milliseconds the API sends.
            assert!((1_000_000_000..=4_102_444_800).contains(&point.time));
        }
    }
}

#[tokio::test]
#[ignore = "makes a real network call"]
async fn coingecko_does_not_offer_a_range_it_cannot_serve() {
    use brew_terminal_lib::models::ChartRange;

    // The public and Demo tiers cap history at 365 days, so Max is deliberately absent from
    // `capabilities().charts` — asking for it anyway must fail rather than silently succeed.
    let caps = provider().capabilities();
    assert!(!caps.charts.contains(&ChartRange::Max));

    assert!(provider()
        .chart("crypto:cg:bitcoin", ChartRange::Max)
        .await
        .is_err());
}

// ---------------------------------------------------------------------------------------
// Fear & Greed
// ---------------------------------------------------------------------------------------

use brew_terminal_lib::models::{SentimentBand, SentimentBasis, SentimentMarket};
use brew_terminal_lib::state::AppState;

fn state(dir: &std::path::Path) -> AppState {
    AppState::bootstrap(dir.to_path_buf()).expect("bootstrap failed")
}

/// Checks that hold for either index, whoever computed it.
fn assert_internally_consistent(index: &brew_terminal_lib::models::SentimentIndex) {
    assert!(
        (0..=100).contains(&index.value),
        "value {} is off the scale",
        index.value
    );
    assert_eq!(
        index.band,
        SentimentBand::of(index.value),
        "the band does not match the value it is supposed to describe"
    );
    assert!(!index.methodology.is_empty(), "no methodology to render");

    assert!(
        index.history.windows(2).all(|w| w[0].time < w[1].time),
        "history must be oldest-first and strictly increasing"
    );
    if let Some(last) = index.history.last() {
        assert_eq!(last.time, index.as_of, "the newest point is not the reading");
        assert_eq!(last.value, index.value);
    }

    // A reading stamped in the future would mean a timestamp unit was misread — the exact
    // mistake the CoinGecko adapter's milliseconds-versus-seconds note describes.
    let now = chrono::Utc::now().timestamp();
    assert!(
        index.as_of <= now + 86_400,
        "as_of {} is in the future (now {now}) — check the timestamp unit",
        index.as_of
    );
    assert!(
        index.as_of > now - 30 * 86_400,
        "the newest reading is over a month old"
    );
}

#[tokio::test]
#[ignore = "makes a real network call"]
async fn crypto_fear_and_greed_returns_a_usable_reading() {
    let dir = tempfile::tempdir().expect("tempdir");
    let envelope = brew_terminal_lib::services::sentiment::crypto_index(&state(dir.path()))
        .await
        .expect("crypto sentiment failed");

    let index = envelope.data.clone().unwrap_or_else(|| {
        panic!(
            "no reading and nothing cached — degraded: {:?}",
            envelope.meta.degraded
        )
    });
    println!(
        "crypto: {} ({}) as_of={} history={} publisher={:?}",
        index.value,
        index.band.label(),
        index.as_of,
        index.history.len(),
        index.publisher_label
    );

    assert_internally_consistent(&index);
    assert_eq!(index.market, SentimentMarket::Crypto);
    assert_eq!(index.basis, SentimentBasis::Published);
    assert!(
        index.components.is_empty(),
        "a published index must not carry components this app invented"
    );
    assert!(
        index.history.len() > 30,
        "expected roughly a quarter of daily history, got {}",
        index.history.len()
    );
}

#[tokio::test]
#[ignore = "makes a real network call"]
async fn stock_fear_and_greed_computes_from_live_fred_series() {
    let dir = tempfile::tempdir().expect("tempdir");
    let envelope = brew_terminal_lib::services::sentiment::stock_index(&state(dir.path()))
        .await
        .expect("stock sentiment failed");

    let index = envelope.data.clone().unwrap_or_else(|| {
        panic!(
            "no reading and nothing cached — degraded: {:?}",
            envelope.meta.degraded
        )
    });
    println!(
        "stocks: {} ({}) as_of={} history={}",
        index.value,
        index.band.label(),
        index.as_of,
        index.history.len()
    );
    for component in &index.components {
        println!(
            "  {:<18} score={:>3} raw={:>8.3}{} inverted={} — {}",
            component.id,
            component.score,
            component.raw_value,
            component.raw_unit,
            component.inverted,
            component.reading
        );
    }

    assert_internally_consistent(&index);
    assert_eq!(index.market, SentimentMarket::Stocks);
    assert_eq!(index.basis, SentimentBasis::Computed);
    assert_eq!(index.components.len(), 4, "all four components are required");

    // The composite's one published claim about itself.
    let sum: i32 = index.components.iter().map(|c| c.score).sum();
    let mean = (sum as f64 / index.components.len() as f64).round() as i32;
    assert_eq!(index.value, mean, "the composite is not the mean it claims");

    for component in &index.components {
        assert!(
            component.raw_value.is_finite(),
            "{} produced a non-finite reading from live data",
            component.id
        );
        assert!((0..=100).contains(&component.score), "{}", component.id);
        assert!(!component.reading.is_empty(), "{}", component.id);
    }

    assert!(
        index.history.len() > 60,
        "expected a usable trend line, got {} points",
        index.history.len()
    );
}

#[tokio::test]
#[ignore = "makes a real network call"]
async fn the_computed_index_survives_a_second_run_from_cache() {
    // The second call is served from the durable cache. It must deserialize back into the
    // same reading — a payload that round-trips wrong would show a different number on the
    // next launch than the one just fetched.
    let dir = tempfile::tempdir().expect("tempdir");
    let state = state(dir.path());

    let first = brew_terminal_lib::services::sentiment::stock_index(&state)
        .await
        .expect("first fetch failed")
        .data
        .expect("no reading");

    let second = brew_terminal_lib::services::sentiment::stock_index(&state)
        .await
        .expect("second fetch failed")
        .data
        .expect("no reading");

    assert_eq!(first.value, second.value);
    assert_eq!(first.as_of, second.as_of);
    assert_eq!(first.components.len(), second.components.len());
}
