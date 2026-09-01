//! FRED — macroeconomic series from the St. Louis Fed.
//!
//! Notable for needing **no credential at all**. FRED's JSON API wants a key, but its CSV
//! download endpoint does not, and the data is US federal government output in the public
//! domain. So unlike every other keyed provider here this one ships enabled: macro context is
//! available on first run without the user signing up for anything.
//!
//! What it is for: the numbers everything else moves against. A crypto chart with no idea what
//! the 10-year did is missing the most important thing on the screen.
//!
//! This provider deliberately serves *only* series data. It is not a `MarketDataProvider` — a
//! Treasury yield is not an asset with a market cap and a 24-hour change, and squeezing it into
//! `Quote` would produce a row of empty columns pretending otherwise.

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::models::ChartPoint;
use crate::providers::http;

pub const FRED_ID: &str = "fred";
pub const FRED_NAME: &str = "FRED (St. Louis Fed)";
pub const FRED_ATTRIBUTION: &str =
    "Data from FRED, Federal Reserve Bank of St. Louis. Series are US government output in the \
     public domain.";

const BASE: &str = "https://fred.stlouisfed.org/graph/fredgraph.csv";

/// One macro series the app offers.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct MacroSeries {
    /// The FRED series id, e.g. `DGS10`.
    pub id: &'static str,
    pub name: &'static str,
    /// What it is, for a reader who has not met it.
    pub description: &'static str,
    /// `%`, `index`, or empty.
    pub unit: &'static str,
    /// How often FRED updates it — daily series and monthly series behave very differently on
    /// a chart, and the reader should not have to infer which they are looking at.
    pub frequency: &'static str,
}

/// The offered series.
///
/// A small, deliberately un-clever list: rates, inflation, employment and the dollar. No
/// composite "recession probability" or similar — those are models, and this app reports
/// published figures rather than running models over them.
pub const SERIES: &[MacroSeries] = &[
    MacroSeries {
        id: "DGS10",
        name: "10-year Treasury yield",
        description: "What the US government pays to borrow for ten years. The number most other \
                      assets are priced against.",
        unit: "%",
        frequency: "Daily",
    },
    MacroSeries {
        id: "DGS2",
        name: "2-year Treasury yield",
        description: "The two-year equivalent, which tracks expectations for short-term rates.",
        unit: "%",
        frequency: "Daily",
    },
    MacroSeries {
        id: "T10Y2Y",
        name: "10-year minus 2-year",
        description: "The gap between the two yields above. It goes negative when short-term \
                      borrowing costs more than long-term.",
        unit: "%",
        frequency: "Daily",
    },
    MacroSeries {
        id: "FEDFUNDS",
        name: "Federal funds rate",
        description: "The rate the US central bank targets. Moves in steps, on scheduled dates.",
        unit: "%",
        frequency: "Monthly",
    },
    MacroSeries {
        id: "CPIAUCSL",
        name: "Consumer price index",
        description: "The standard US measure of consumer prices. An index, not a percentage — \
                      inflation is its rate of change.",
        unit: "index",
        frequency: "Monthly",
    },
    MacroSeries {
        id: "UNRATE",
        name: "Unemployment rate",
        description: "The share of the US labour force without work and looking for it.",
        unit: "%",
        frequency: "Monthly",
    },
    MacroSeries {
        id: "DTWEXBGS",
        name: "US dollar index",
        description: "The dollar against a trade-weighted basket of other currencies.",
        unit: "index",
        frequency: "Daily",
    },
];

pub fn series_by_id(id: &str) -> Option<&'static MacroSeries> {
    SERIES.iter().find(|s| s.id == id)
}

pub struct FredProvider {
    client: reqwest::Client,
}

impl FredProvider {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    /// Fetches a series from `start` (an ISO date) to today.
    pub async fn series(&self, id: &str, start: &str) -> AppResult<Vec<ChartPoint>> {
        // Only ids from the shipped list are ever requested, so nothing user-supplied reaches
        // the query string.
        let Some(series) = series_by_id(id) else {
            return Err(AppError::NotFound);
        };

        let url = format!("{BASE}?id={}&cosd={start}", series.id);
        let bytes = http::get_bytes(&self.client, FRED_ID, &url).await?;

        let text = String::from_utf8(bytes).map_err(|_| AppError::InvalidResponse {
            provider_id: FRED_ID.to_string(),
            detail: "the series was not readable text".into(),
        })?;

        let points = parse_csv(&text);
        if points.is_empty() {
            return Err(AppError::InvalidResponse {
                provider_id: FRED_ID.to_string(),
                detail: "no observations in the response".into(),
            });
        }
        Ok(points)
    }
}

/// Parses FRED's two-column CSV.
///
/// The format is `observation_date,VALUE` with a header row. Missing observations are written
/// as `.` — a real convention in this data, not a parse failure — and are skipped rather than
/// read as zero, because a zero unemployment rate would be quite a claim.
fn parse_csv(text: &str) -> Vec<ChartPoint> {
    let mut out = Vec::new();

    for line in text.lines().skip(1) {
        let mut parts = line.split(',');
        let (Some(date), Some(raw)) = (parts.next(), parts.next()) else {
            continue;
        };

        let raw = raw.trim();
        if raw.is_empty() || raw == "." {
            continue;
        }

        let Ok(value) = raw.parse::<f64>() else {
            continue;
        };
        if !value.is_finite() {
            continue;
        }

        let Ok(parsed) = chrono::NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d") else {
            continue;
        };
        let Some(time) = parsed
            .and_hms_opt(12, 0, 0)
            .map(|dt| dt.and_utc().timestamp())
        else {
            continue;
        };

        out.push(ChartPoint { time, close: value });
    }

    out.sort_by_key(|p| p.time);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_published_csv_shape() {
        let csv = "observation_date,DGS10\n2026-01-02,4.06\n2026-01-03,4.03\n";
        let points = parse_csv(csv);

        assert_eq!(points.len(), 2);
        assert_eq!(points[0].close, 4.06);
        assert!(points[0].time < points[1].time);
    }

    /// FRED writes a missing observation as a full stop. Reading that as zero would put a 0%
    /// unemployment rate on a chart.
    #[test]
    fn a_missing_observation_is_skipped_not_read_as_zero() {
        let csv = "observation_date,UNRATE\n2026-01-01,4.1\n2026-01-02,.\n2026-01-03,4.2\n";
        let points = parse_csv(csv);

        assert_eq!(points.len(), 2);
        assert!(points.iter().all(|p| p.close > 0.0));
    }

    #[test]
    fn negative_values_are_kept_because_some_series_go_below_zero() {
        // The 10-year minus 2-year spread is negative for long stretches.
        let csv = "observation_date,T10Y2Y\n2026-01-01,-0.42\n";
        assert_eq!(parse_csv(csv)[0].close, -0.42);
    }

    #[test]
    fn junk_rows_are_dropped_without_losing_the_good_ones() {
        let csv = "observation_date,X\n2026-01-01,1.0\nnot-a-date,2.0\n2026-01-02,not-a-number\n2026-01-03,3.0\n";
        let points = parse_csv(csv);

        assert_eq!(points.len(), 2);
        assert_eq!(points[0].close, 1.0);
        assert_eq!(points[1].close, 3.0);
    }

    #[test]
    fn an_empty_or_header_only_response_yields_nothing() {
        assert!(parse_csv("").is_empty());
        assert!(parse_csv("observation_date,DGS10\n").is_empty());
    }

    #[test]
    fn every_offered_series_is_described_and_unique() {
        let mut seen = std::collections::HashSet::new();
        for series in SERIES {
            assert!(seen.insert(series.id), "duplicate series id {}", series.id);
            assert!(!series.name.is_empty());
            assert!(
                !series.description.is_empty(),
                "{} has no description",
                series.id
            );
            assert!(!series.frequency.is_empty());
        }
        assert!(SERIES.len() >= 5);
    }

    #[tokio::test]
    async fn an_unknown_series_is_refused_before_a_request_is_built() {
        let provider = FredProvider::new(reqwest::Client::new());
        // Only ids from the shipped list ever reach the query string.
        assert!(matches!(
            provider.series("../../etc/passwd", "2024-01-01").await,
            Err(AppError::NotFound)
        ));
    }
}
