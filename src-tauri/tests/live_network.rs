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
