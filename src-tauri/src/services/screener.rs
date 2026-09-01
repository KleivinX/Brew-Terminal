//! Running a screen over the market.
//!
//! Filtering happens in Rust rather than the browser so the semantics have one definition and
//! one set of tests. The list it filters is the same cached market list the Pulse table uses, so
//! adjusting a filter costs no request — the provider is asked once and screened repeatedly.

use crate::error::AppResult;
use crate::models::{screen, AssetType, Envelope, Quote, ScreenerFilter};
use crate::state::AppState;

/// How many rows a screen pulls before filtering.
///
/// Deliberately larger than the Pulse table's page: a filter that only ever saw the top 50 by
/// market cap would silently make "small caps down 20%" impossible to ask for.
const UNIVERSE: usize = 250;

pub async fn run(state: &AppState, filter: ScreenerFilter) -> AppResult<Envelope<Vec<Quote>>> {
    // Absent means everything the enabled providers cover, so both lists are pulled and merged.
    let types: Vec<AssetType> = match filter.asset_type {
        Some(one) => vec![one],
        None => vec![AssetType::Crypto, AssetType::Stock],
    };

    let mut envelopes = Vec::new();
    for asset_type in types {
        // A provider that is not configured contributes nothing rather than failing the screen:
        // someone with only a CoinGecko key should still be able to screen crypto.
        match super::market::get_market_list(state, asset_type, "global".to_string(), UNIVERSE)
            .await
        {
            Ok(envelope) => envelopes.push(envelope),
            Err(error) => {
                tracing::debug!(
                    ?error,
                    ?asset_type,
                    "a provider contributed nothing to the screen"
                );
            }
        }
    }

    if envelopes.is_empty() {
        return Ok(super::market::not_configured("market data"));
    }

    let mut quotes: Vec<Quote> = Vec::new();
    for envelope in &envelopes {
        quotes.extend(envelope.data.iter().cloned());
    }

    let meta = super::market::merge_meta(envelopes.iter().map(|e| e.meta.clone()).collect());
    Ok(Envelope {
        data: screen(quotes, &filter),
        meta,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Range, ScreenerSort};

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    #[tokio::test]
    async fn an_empty_filter_returns_the_universe() {
        let (state, _dir) = state();
        let out = run(&state, ScreenerFilter::default()).await.unwrap();
        // The fixture provider is enabled in debug builds, so there is something to screen.
        assert!(!out.data.is_empty());
    }

    #[tokio::test]
    async fn a_filter_narrows_the_result() {
        let (state, _dir) = state();
        let all = run(&state, ScreenerFilter::default()).await.unwrap();

        let expensive = run(
            &state,
            ScreenerFilter {
                price: Range {
                    min: Some(1_000_000.0),
                    max: None,
                },
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert!(expensive.data.len() < all.data.len());
    }

    #[tokio::test]
    async fn restricting_the_asset_type_excludes_the_others() {
        let (state, _dir) = state();
        let out = run(
            &state,
            ScreenerFilter {
                asset_type: Some(AssetType::Crypto),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert!(out.data.iter().all(|q| q.asset_type == AssetType::Crypto));
    }

    #[tokio::test]
    async fn the_requested_sort_is_the_order_returned() {
        let (state, _dir) = state();
        let out = run(
            &state,
            ScreenerFilter {
                sort: ScreenerSort::Price,
                descending: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();

        for pair in out.data.windows(2) {
            assert!(
                pair[0].price >= pair[1].price,
                "descending price order was not preserved"
            );
        }
    }

    #[tokio::test]
    async fn the_envelope_still_carries_provenance() {
        let (state, _dir) = state();
        let out = run(&state, ScreenerFilter::default()).await.unwrap();
        // A screened list is still provider data and must say where it came from.
        assert!(!out.meta.provider_name.is_empty());
    }
}
