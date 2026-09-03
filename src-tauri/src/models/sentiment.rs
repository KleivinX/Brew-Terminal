//! Market sentiment — the two Fear & Greed indices.
//!
//! The two are built very differently, and the difference is not an implementation detail the
//! reader should have to discover:
//!
//! - **Crypto** is a *published figure*. Alternative.me computes it and this app reports it,
//!   the same way it reports a price. Their inputs and weights are documented, so the app
//!   quotes them — but it does not reconstruct per-component scores it was never given.
//! - **Stocks** is *computed here*, from public Federal Reserve series, because no free and
//!   documented equity sentiment index exists to report (ADR-008 rules out the undocumented
//!   endpoint behind the well-known one). Every component, every input series and the exact
//!   arithmetic is carried in the payload so the number can be checked by hand.
//!
//! `basis` on `SentimentIndex` is what tells them apart, and the UI is required to render it.

use serde::{Deserialize, Serialize};

/// Which market an index describes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "lowercase")]
pub enum SentimentMarket {
    Crypto,
    Stocks,
}

/// Whether the number was published by someone else or computed here.
///
/// This is deliberately part of the payload rather than a UI-side lookup: an index reported
/// from a publisher and an index computed from raw series carry different warranties, and the
/// component that renders one should not be able to render it without saying which it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum SentimentBasis {
    /// Fetched as-is from a provider that publishes the index.
    Published,
    /// Computed by this app from primary series. `components` is then non-empty.
    Computed,
}

/// The five bands, applied identically to both indices so the two gauges are comparable.
///
/// The cut points are the conventional ones. They are a presentation choice, not a finding —
/// nothing in the data says 55 and 56 are different states of the world, and the UI says so.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum SentimentBand {
    ExtremeFear,
    Fear,
    Neutral,
    Greed,
    ExtremeGreed,
}

impl SentimentBand {
    /// Values are clamped into 0–100 by the callers that build them, so the two open ends here
    /// are unreachable in practice and present only to make the match total.
    pub fn of(value: i32) -> Self {
        match value {
            ..=24 => Self::ExtremeFear,
            25..=44 => Self::Fear,
            45..=55 => Self::Neutral,
            56..=75 => Self::Greed,
            76.. => Self::ExtremeGreed,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::ExtremeFear => "Extreme fear",
            Self::Fear => "Fear",
            Self::Neutral => "Neutral",
            Self::Greed => "Greed",
            Self::ExtremeGreed => "Extreme greed",
        }
    }
}

/// One input to a computed index.
///
/// Everything needed to check the score by hand is here: what was measured, the number that
/// came out, the series it came from, and what the score means. A component the reader cannot
/// audit would make the composite a black box, which is the thing this feature is not.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct SentimentComponent {
    /// Stable key, for React lists and for tests that assert on a specific component.
    pub id: String,
    pub name: String,
    /// What this component measures, for a reader who has not met it.
    pub description: String,
    /// 0–100 after any inversion. Directly comparable to the composite.
    pub score: i32,
    pub band: SentimentBand,
    /// The measured quantity before it was ranked — e.g. `+4.2` for "4.2% above the average".
    pub raw_value: f64,
    /// How to read `raw_value`: `%`, `pp` (percentage points), or empty.
    pub raw_unit: String,
    /// Plain-language statement of the raw reading, so the figure is never bare.
    pub reading: String,
    /// The source series ids, e.g. `["SP500"]`. Named so the reader can go and look.
    pub source_series: Vec<String>,
    /// The arithmetic, in words. Short enough to render under the component.
    pub method: String,
    /// True where a high raw value means fear and the score was flipped. Without this the
    /// reader cannot reconcile a high VIX with a low score.
    pub inverted: bool,
}

/// One historical reading, for the trend line.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct SentimentPoint {
    /// Unix epoch seconds, UTC.
    #[cfg_attr(test, ts(type = "number"))]
    pub time: i64,
    pub value: i32,
}

/// A Fear & Greed index reading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct SentimentIndex {
    pub market: SentimentMarket,
    pub basis: SentimentBasis,
    /// 0 = maximum fear, 100 = maximum greed.
    pub value: i32,
    pub band: SentimentBand,
    /// When the reading is for. Distinct from the envelope's `fetchedAt`, which is when it was
    /// retrieved: a daily index fetched at noon is still yesterday's close.
    #[cfg_attr(test, ts(type = "number"))]
    pub as_of: i64,
    /// The publisher's own wording, where there is a publisher and it differs from this app's
    /// band. Shown so the app's relabelling never quietly overwrites theirs.
    pub publisher_label: Option<String>,
    /// Empty for a published index — see the module note.
    pub components: Vec<SentimentComponent>,
    /// Oldest first. May be empty if only the current reading is available.
    pub history: Vec<SentimentPoint>,
    /// One sentence on where the number comes from, rendered next to it.
    pub methodology: String,
}

impl SentimentIndex {
    /// The reading `days` ago, for the "a month ago it was…" comparison.
    ///
    /// Nearest point at or before the target, so a market holiday resolves to the previous
    /// session rather than to nothing. `None` when the history does not reach back that far —
    /// the UI omits the comparison rather than reaching for the oldest point it has and
    /// silently mislabelling it.
    pub fn value_days_ago(&self, days: i64) -> Option<i32> {
        let target = self.as_of - days * 86_400;

        // Strictly at or before the target, with no tolerance window. An earlier version
        // allowed a day of slack for clock drift, which let "30 days ago" resolve to a point
        // 29 days back — a comparison silently answering a question one day off from the one
        // it is labelled with. Both indices stamp their daily readings at a fixed hour, so
        // exact arithmetic lands on the right day.
        let oldest = self.history.first()?;
        if oldest.time > target {
            return None;
        }

        self.history
            .iter()
            .rev()
            .find(|point| point.time <= target)
            .map(|point| point.value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bands_cover_every_value_without_a_gap() {
        // Walking 0..=100 catches an off-by-one at any cut point, which a spot check would not.
        let mut seen = Vec::new();
        for value in 0..=100 {
            seen.push(SentimentBand::of(value));
        }
        assert_eq!(seen[0], SentimentBand::ExtremeFear);
        assert_eq!(seen[24], SentimentBand::ExtremeFear);
        assert_eq!(seen[25], SentimentBand::Fear);
        assert_eq!(seen[44], SentimentBand::Fear);
        assert_eq!(seen[45], SentimentBand::Neutral);
        assert_eq!(seen[55], SentimentBand::Neutral);
        assert_eq!(seen[56], SentimentBand::Greed);
        assert_eq!(seen[75], SentimentBand::Greed);
        assert_eq!(seen[76], SentimentBand::ExtremeGreed);
        assert_eq!(seen[100], SentimentBand::ExtremeGreed);
    }

    #[test]
    fn the_midpoint_is_neutral() {
        // 50 reading as anything but neutral would make the gauge lie at rest.
        assert_eq!(SentimentBand::of(50), SentimentBand::Neutral);
    }

    #[test]
    fn every_band_has_a_label() {
        for band in [
            SentimentBand::ExtremeFear,
            SentimentBand::Fear,
            SentimentBand::Neutral,
            SentimentBand::Greed,
            SentimentBand::ExtremeGreed,
        ] {
            assert!(!band.label().is_empty());
        }
    }

    fn index_with_history(history: Vec<SentimentPoint>, as_of: i64) -> SentimentIndex {
        SentimentIndex {
            market: SentimentMarket::Crypto,
            basis: SentimentBasis::Published,
            value: 50,
            band: SentimentBand::Neutral,
            as_of,
            publisher_label: None,
            components: Vec::new(),
            history,
            methodology: String::new(),
        }
    }

    #[test]
    fn a_past_reading_is_found_at_the_requested_offset() {
        let day = 86_400;
        let now = 30 * day;
        let history = (0..=30)
            .map(|i| SentimentPoint {
                time: i * day,
                value: i as i32,
            })
            .collect();

        let index = index_with_history(history, now);
        assert_eq!(index.value_days_ago(0), Some(30));
        assert_eq!(index.value_days_ago(7), Some(23));
        assert_eq!(index.value_days_ago(30), Some(0));
    }

    #[test]
    fn a_gap_resolves_backwards_rather_than_forwards() {
        // Weekends and holidays are gaps in every daily series. Asking for a Sunday must give
        // Friday's reading, never Monday's — a value from the future would be worse than none.
        let day = 86_400;
        let history = vec![
            SentimentPoint { time: 0, value: 10 },
            SentimentPoint {
                time: 5 * day,
                value: 90,
            },
        ];
        let index = index_with_history(history, 5 * day);
        assert_eq!(index.value_days_ago(3), Some(10));
    }

    #[test]
    fn a_comparison_beyond_the_history_is_refused_rather_than_approximated() {
        let day = 86_400;
        let history = vec![SentimentPoint {
            time: 10 * day,
            value: 42,
        }];
        let index = index_with_history(history, 10 * day);
        assert_eq!(
            index.value_days_ago(365),
            None,
            "reaching past the history must not silently return the oldest point"
        );
    }

    #[test]
    fn an_empty_history_has_nothing_to_compare_against() {
        let index = index_with_history(Vec::new(), 0);
        assert_eq!(index.value_days_ago(30), None);
    }
}
