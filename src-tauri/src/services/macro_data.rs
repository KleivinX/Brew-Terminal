//! Macro series, and the multi-asset history the comparison and correlation views need.

use crate::error::AppResult;
use crate::models::{ChartPoint, ChartRange, Envelope};
use crate::providers::live::fred::{
    FredProvider, MacroSeries, FRED_ATTRIBUTION, FRED_ID, FRED_NAME, SERIES,
};
use crate::state::AppState;

/// How far back each range asks FRED for.
fn start_for(range: ChartRange) -> &'static str {
    match range {
        ChartRange::Day | ChartRange::Week | ChartRange::Month => "2024-01-01",
        ChartRange::Quarter => "2023-01-01",
        ChartRange::Year => "2021-01-01",
        // Monetary history is only interesting over decades.
        ChartRange::Max => "1990-01-01",
    }
}

pub fn catalogue() -> &'static [MacroSeries] {
    SERIES
}

pub async fn series(
    state: &AppState,
    id: String,
    range: ChartRange,
) -> AppResult<Envelope<Vec<ChartPoint>>> {
    let provider = FredProvider::new(state.registry.http_client());
    let points = provider.series(&id, start_for(range)).await?;
    Ok(Envelope::fresh(
        points,
        FRED_ID,
        FRED_NAME,
        crate::models::EnvelopeSource::Live,
    ))
}

/// Chart history for several assets at once.
///
/// Failures are per asset rather than for the whole request: comparing four things when one
/// provider is down should show three, not nothing. The caller is told which are missing.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct MultiSeries {
    pub series: Vec<AssetSeries>,
    /// Assets that could not be fetched, so the UI can name them rather than silently dropping
    /// them from a comparison.
    pub unavailable: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct AssetSeries {
    pub asset_id: String,
    pub symbol: String,
    pub points: Vec<ChartPoint>,
}

/// The most assets a comparison will fetch at once.
///
/// Matched to the categorical palette, which has six validated slots. A seventh series would
/// need a colour the palette does not have, and generating one is exactly what the design rules
/// forbid.
pub const MAX_COMPARE: usize = 6;

pub async fn multi_series(
    state: &AppState,
    asset_ids: Vec<String>,
    range: ChartRange,
) -> AppResult<MultiSeries> {
    let mut series = Vec::new();
    let mut unavailable = Vec::new();

    for asset_id in asset_ids.into_iter().take(MAX_COMPARE) {
        match super::market::get_chart(state, asset_id.clone(), range).await {
            Ok(envelope) if !envelope.data.is_empty() => {
                let symbol = asset_id
                    .rsplit(':')
                    .next()
                    .unwrap_or(&asset_id)
                    .to_uppercase();
                series.push(AssetSeries {
                    asset_id,
                    symbol,
                    points: envelope.data,
                });
            }
            _ => unavailable.push(asset_id),
        }
    }

    Ok(MultiSeries {
        series,
        unavailable,
    })
}

pub fn attribution() -> &'static str {
    FRED_ATTRIBUTION
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    #[test]
    fn the_catalogue_is_not_empty_and_every_entry_is_described() {
        assert!(!catalogue().is_empty());
        assert!(catalogue().iter().all(|s| !s.description.is_empty()));
    }

    #[test]
    fn longer_ranges_reach_further_back() {
        // A decade of monetary policy is the point of the MAX range.
        assert!(start_for(ChartRange::Max) < start_for(ChartRange::Year));
        assert!(start_for(ChartRange::Year) < start_for(ChartRange::Month));
    }

    #[tokio::test]
    async fn a_comparison_is_capped_at_the_palette_size() {
        let (state, _dir) = state();
        let many: Vec<String> = (0..20).map(|i| format!("crypto:cg:asset-{i}")).collect();

        let result = multi_series(&state, many, ChartRange::Month).await.unwrap();
        assert!(result.series.len() + result.unavailable.len() <= MAX_COMPARE);
    }

    #[tokio::test]
    async fn an_asset_that_cannot_be_fetched_is_named_rather_than_dropped() {
        let (state, _dir) = state();
        let result = multi_series(
            &state,
            vec!["crypto:cg:definitely-not-real".to_string()],
            ChartRange::Month,
        )
        .await
        .unwrap();

        assert!(result.series.is_empty());
        assert_eq!(result.unavailable, vec!["crypto:cg:definitely-not-real"]);
    }
}
