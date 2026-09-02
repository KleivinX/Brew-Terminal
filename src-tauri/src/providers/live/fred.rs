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

/// Series fetched only as inputs to the computed stock sentiment index.
///
/// Deliberately separate from `SERIES`: that list is the macro picker, chosen to be short and
/// legible, and a credit-spread option-adjusted spread is not something to put in a dropdown
/// next to the unemployment rate. These are still allowlisted the same way, so the request
/// builder's guarantee — no user-supplied text ever reaches the query string — is unchanged.
///
/// Every one is daily. A weekly series mixed into a daily composite would make the index jump
/// on whichever weekday that series updates, which reads as a market event and is not one.
pub const INDEX_INPUTS: &[MacroSeries] = &[
    MacroSeries {
        id: "SP500",
        name: "S&P 500",
        description: "The S&P 500 index level.",
        unit: "index",
        frequency: "Daily",
    },
    MacroSeries {
        id: "VIXCLS",
        name: "VIX",
        description: "The CBOE volatility index — the option market's expectation of how much \
                      the S&P 500 will move over the next 30 days.",
        unit: "index",
        frequency: "Daily",
    },
    MacroSeries {
        id: "BAMLH0A0HYM2",
        name: "High-yield spread",
        description: "The extra yield investors demand to lend to below-investment-grade US \
                      companies, over Treasuries.",
        unit: "%",
        frequency: "Daily",
    },
    MacroSeries {
        id: "BAMLC0A0CM",
        name: "Investment-grade spread",
        description: "The same measure for investment-grade US companies.",
        unit: "%",
        frequency: "Daily",
    },
    MacroSeries {
        id: "BAMLCC0A0CMTRIV",
        name: "Corporate bond total return",
        description: "Total return index for US investment-grade corporate bonds — price and \
                      coupon together, which is what a bondholder actually earns.",
        unit: "index",
        frequency: "Daily",
    },
];

/// Looks up any series this app is allowed to request, offered or internal.
pub fn series_by_id(id: &str) -> Option<&'static MacroSeries> {
    SERIES
        .iter()
        .chain(INDEX_INPUTS.iter())
        .find(|s| s.id == id)
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

    #[test]
    fn the_index_inputs_are_described_and_do_not_collide_with_the_picker() {
        // Two lists, one namespace. A duplicate id would make `series_by_id` return whichever
        // list came first, and the picker would quietly gain or lose an entry.
        let offered: Vec<&str> = SERIES.iter().map(|s| s.id).collect();
        for input in INDEX_INPUTS {
            assert!(!input.description.is_empty(), "{}", input.id);
            assert!(!input.name.is_empty(), "{}", input.id);
            assert!(
                !offered.contains(&input.id),
                "{} appears in both the picker and the index inputs",
                input.id
            );
        }

        let mut ids: Vec<&str> = INDEX_INPUTS.iter().map(|s| s.id).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "duplicate id among the index inputs");
    }

    #[test]
    fn index_inputs_are_fetchable_but_stay_out_of_the_picker() {
        // The whole point of the second list: requestable, not offered. If these leaked into
        // `catalogue()` the macro dropdown would start offering option-adjusted spreads.
        for input in INDEX_INPUTS {
            assert!(
                series_by_id(input.id).is_some(),
                "{} must be requestable",
                input.id
            );
        }
        assert!(
            !SERIES.iter().any(|s| s.id == "BAMLC0A0CM"),
            "an index input reached the offered catalogue"
        );
    }

    #[test]
    fn every_index_input_is_daily() {
        // A weekly series in a daily composite makes the index step on whichever weekday that
        // series updates, which reads as a market event and is not one.
        for input in INDEX_INPUTS {
            assert_eq!(input.frequency, "Daily", "{} is not a daily series", input.id);
        }
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
