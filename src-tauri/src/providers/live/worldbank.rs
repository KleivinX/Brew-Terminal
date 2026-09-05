//! World Bank Indicators API — country macroeconomic series.
//!
//! Keyless, documented, global, and covers the four indicators this feature needs in a single
//! request. The World Bank publishes its data under CC BY 4.0, which permits use with
//! attribution.
//!
//! Chosen over the IMF, which covers the same ground. The IMF retired its legacy SDMX JSON
//! service on 5 November 2025 and its replacement is an SDMX 3.0 API requiring dataflow
//! discovery and key construction before a single figure comes back. That is a lot of moving
//! parts for indicators the World Bank returns from one URL, and the migration is recent
//! enough that the endpoint's stability is not yet established. Recorded in PROVIDERS.md.
//!
//! Response shape and the multi-indicator query verified against live calls on 2026-09-05.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::models::CountryIndicator;
use crate::providers::http;

pub const WORLDBANK_ID: &str = "worldbank";
pub const WORLDBANK_NAME: &str = "World Bank Open Data";
pub const WORLDBANK_ATTRIBUTION: &str =
    "Macroeconomic indicators from World Bank Open Data, licensed CC BY 4.0.";
pub const WORLDBANK_DOCS: &str =
    "https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation";

const BASE: &str = "https://api.worldbank.org/v2";

/// How stale an observation may be before it is dropped.
///
/// This exists because of a specific, checkable falsehood. `mrnev=1` asks for the most recent
/// *non-empty* value, and it will happily reach back decades to find one: on 2026-09-05 the
/// most recent central government debt figure the World Bank held for Germany was **1990, at
/// 20.9% of GDP**. Germany's debt today is roughly three times that. Rendering it in a row
/// beside 2025 inflation would put a thirty-six-year-old number on screen under a heading that
/// implies it is current — the exact failure this app's provenance rules exist to prevent.
///
/// Five years is generous for annual national accounts, which are typically published with a
/// one to two year lag. Anything older is dropped, and the scorecard shows one fewer row
/// rather than a wrong one.
const MAX_OBSERVATION_AGE_YEARS: i64 = 5;

/// The indicators requested, in the order the scorecard lists them.
///
/// Four of the five are near-complete across major economies; central government debt is the
/// ragged one, and is kept because when it *is* current it is the single most useful figure
/// here. The age gate above is what makes keeping it safe.
pub const INDICATORS: &[Indicator] = &[
    Indicator {
        code: "FP.CPI.TOTL.ZG",
        label: "Inflation",
        unit: "%",
        description: "Consumer prices, annual change.",
    },
    Indicator {
        code: "NY.GDP.MKTP.KD.ZG",
        label: "GDP growth",
        unit: "%",
        description: "Real gross domestic product, annual change.",
    },
    Indicator {
        code: "GC.DOD.TOTL.GD.ZS",
        label: "Govt debt",
        unit: "% of GDP",
        description: "Central government debt as a share of GDP.",
    },
    Indicator {
        code: "BN.CAB.XOKA.GD.ZS",
        label: "Current account",
        unit: "% of GDP",
        description: "Current account balance as a share of GDP. Negative means the country \
                      buys more from abroad than it sells.",
    },
    Indicator {
        code: "SL.UEM.TOTL.ZS",
        label: "Unemployment",
        unit: "%",
        description: "Share of the labour force without work, ILO modelled estimate.",
    },
];

#[derive(Debug, Clone, Copy)]
pub struct Indicator {
    pub code: &'static str,
    pub label: &'static str,
    pub unit: &'static str,
    pub description: &'static str,
}

pub fn indicator_by_code(code: &str) -> Option<&'static Indicator> {
    INDICATORS.iter().find(|i| i.code == code)
}

#[derive(Debug, Deserialize)]
struct Row {
    indicator: Named,
    country: Named,
    /// The observation year as a string, e.g. `"2025"`.
    date: String,
    /// Null wherever the World Bank has no observation, which is common.
    value: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct Named {
    id: String,
    value: String,
}

pub struct WorldBankProvider {
    client: reqwest::Client,
}

impl WorldBankProvider {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    /// Every indicator for every requested country, in one call.
    ///
    /// Returns `(country_code, country_name, indicators)` per country. Countries the World Bank
    /// had nothing recent for are simply absent — the caller keeps its own list and can say so.
    pub async fn indicators(
        &self,
        country_codes: &[&str],
        this_year: i64,
    ) -> AppResult<Vec<(String, String, Vec<CountryIndicator>)>> {
        if country_codes.is_empty() {
            return Ok(Vec::new());
        }

        // Both halves of the path are built from constants and a caller-supplied allowlist of
        // ISO codes, never from user text. `assert_iso_codes` is what keeps that true.
        assert_iso_codes(country_codes)?;

        let countries = country_codes.join(";");
        let codes: Vec<&str> = INDICATORS.iter().map(|i| i.code).collect();
        let indicators = codes.join(";");

        // `source=2` selects the World Development Indicators database, and is what makes the
        // semicolon-separated multi-indicator form work at all — without it the API returns
        // only the first indicator. `mrnev=1` is most-recent-non-empty-value per series.
        let url = format!(
            "{BASE}/country/{countries}/indicator/{indicators}\
             ?source=2&format=json&mrnev=1&per_page=500"
        );

        let body: serde_json::Value =
            http::get_json(&self.client, WORLDBANK_ID, &url, None).await?;
        parse(body, this_year)
    }
}

/// Rejects anything that is not a plain ISO 3166-1 alpha-2 code.
///
/// The country list is a shipped constant today, so this cannot currently fail. It exists so
/// that it still cannot fail the day someone wires a country picker to it — a semicolon or a
/// slash in a country code would otherwise reshape the request path.
fn assert_iso_codes(codes: &[&str]) -> AppResult<()> {
    for code in codes {
        if code.len() != 2 || !code.bytes().all(|b| b.is_ascii_alphabetic()) {
            return Err(AppError::Validation {
                field: "countryCode".into(),
                detail: "country codes must be two ASCII letters".into(),
            });
        }
    }
    Ok(())
}

/// Parses the `[metadata, rows]` pair the API returns.
///
/// The shape is a two-element heterogeneous array, and on an error it is a *one*-element array
/// holding a message object instead. Indexing straight to `[1]` would panic on exactly the
/// responses that most need handling, so the length is checked first.
fn parse(
    body: serde_json::Value,
    this_year: i64,
) -> AppResult<Vec<(String, String, Vec<CountryIndicator>)>> {
    let invalid = || AppError::InvalidResponse {
        provider_id: WORLDBANK_ID.to_string(),
        detail: "unexpected response shape".into(),
    };

    let array = body.as_array().ok_or_else(invalid)?;
    // One element means the API answered with a `message` object — a bad indicator code, or
    // a country it does not know.
    let rows_value = array.get(1).ok_or_else(invalid)?;
    let rows: Vec<Row> = serde_json::from_value(rows_value.clone()).map_err(|_| invalid())?;

    // Insertion-ordered so countries come back in the order the World Bank listed them, and
    // two runs produce the same order.
    let mut by_country: Vec<(String, String, Vec<CountryIndicator>)> = Vec::new();

    for row in rows {
        let Some(value) = row.value.filter(|v| v.is_finite()) else {
            continue;
        };
        let Ok(year) = row.date.parse::<i64>() else {
            continue;
        };
        // The Germany-1990 guard. See `MAX_OBSERVATION_AGE_YEARS`.
        if this_year - year > MAX_OBSERVATION_AGE_YEARS {
            continue;
        }
        let Some(indicator) = indicator_by_code(&row.indicator.id) else {
            continue;
        };

        let entry = match by_country
            .iter_mut()
            .find(|(id, _, _)| *id == row.country.id)
        {
            Some(entry) => entry,
            None => {
                by_country.push((
                    row.country.id.clone(),
                    row.country.value.clone(),
                    Vec::new(),
                ));
                by_country.last_mut().expect("just pushed")
            }
        };

        entry.2.push(CountryIndicator {
            code: indicator.code.to_string(),
            label: indicator.label.to_string(),
            value,
            unit: indicator.unit.to_string(),
            year,
        });
    }

    // Within a country, list indicators in the shipped order rather than whatever order the
    // API happened to return, so the scorecard rows line up between countries.
    let order = |code: &str| {
        INDICATORS
            .iter()
            .position(|i| i.code == code)
            .unwrap_or(usize::MAX)
    };
    for (_, _, indicators) in &mut by_country {
        indicators.sort_by_key(|i| order(&i.code));
    }

    Ok(by_country)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real values from a live call on 2026-09-05, including the Germany debt vintage that
    /// made the age gate necessary.
    const SAMPLE: &str = r#"[
      {"page":1,"pages":1,"per_page":500,"total":5,"sourceid":null,"lastupdated":"2026-07-13"},
      [
        {"indicator":{"id":"NY.GDP.MKTP.KD.ZG","value":"GDP growth (annual %)"},
         "country":{"id":"DE","value":"Germany"},"countryiso3code":"DEU",
         "date":"2025","value":0.239578342117881,"obs_status":"","decimal":1},
        {"indicator":{"id":"FP.CPI.TOTL.ZG","value":"Inflation, consumer prices (annual %)"},
         "country":{"id":"DE","value":"Germany"},"countryiso3code":"DEU",
         "date":"2025","value":2.17178770949721,"obs_status":"","decimal":1},
        {"indicator":{"id":"GC.DOD.TOTL.GD.ZS","value":"Central government debt"},
         "country":{"id":"DE","value":"Germany"},"countryiso3code":"DEU",
         "date":"1990","value":20.9,"obs_status":"","decimal":1},
        {"indicator":{"id":"FP.CPI.TOTL.ZG","value":"Inflation, consumer prices (annual %)"},
         "country":{"id":"US","value":"United States"},"countryiso3code":"USA",
         "date":"2024","value":2.94952520485207,"obs_status":"","decimal":1},
        {"indicator":{"id":"GC.DOD.TOTL.GD.ZS","value":"Central government debt"},
         "country":{"id":"US","value":"United States"},"countryiso3code":"USA",
         "date":"2024","value":115.8,"obs_status":"","decimal":1}
      ]
    ]"#;

    fn parsed() -> Vec<(String, String, Vec<CountryIndicator>)> {
        parse(serde_json::from_str(SAMPLE).unwrap(), 2026).unwrap()
    }

    #[test]
    fn groups_rows_by_country() {
        let result = parsed();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].0, "DE");
        assert_eq!(result[0].1, "Germany");
    }

    /// The reason `MAX_OBSERVATION_AGE_YEARS` exists, pinned with the real figure that
    /// prompted it. Germany's most recent World Bank debt observation is from 1990 and is
    /// roughly a third of the true current level.
    #[test]
    fn a_thirty_six_year_old_observation_is_dropped_not_shown_as_current() {
        let germany = &parsed()[0].2;
        assert!(
            !germany.iter().any(|i| i.code == "GC.DOD.TOTL.GD.ZS"),
            "the 1990 debt figure reached the scorecard: {germany:?}"
        );
        // The rest of Germany's row survives — one stale series does not discard a country.
        assert_eq!(germany.len(), 2);
    }

    #[test]
    fn a_recent_observation_of_the_same_indicator_is_kept() {
        let us = &parsed()[1].2;
        let debt = us.iter().find(|i| i.code == "GC.DOD.TOTL.GD.ZS").unwrap();
        assert_eq!(debt.year, 2024);
        assert!((debt.value - 115.8).abs() < 1e-9);
    }

    /// Different countries get different vintages of the same indicator in one response, so
    /// the year has to travel with the value rather than with the screen.
    #[test]
    fn each_value_carries_its_own_year() {
        let result = parsed();
        let de = result[0]
            .2
            .iter()
            .find(|i| i.code == "FP.CPI.TOTL.ZG")
            .unwrap();
        let us = result[1]
            .2
            .iter()
            .find(|i| i.code == "FP.CPI.TOTL.ZG")
            .unwrap();
        assert_eq!(de.year, 2025);
        assert_eq!(us.year, 2024);
    }

    #[test]
    fn the_boundary_year_is_kept_and_one_year_older_is_not() {
        let row = |year: &str| {
            format!(
                r#"[{{"page":1}},[{{"indicator":{{"id":"FP.CPI.TOTL.ZG","value":"x"}},
                   "country":{{"id":"US","value":"United States"}},
                   "date":"{year}","value":3.0}}]]"#
            )
        };
        // Exactly at the limit is still shown.
        let kept = parse(serde_json::from_str(&row("2021")).unwrap(), 2026).unwrap();
        assert_eq!(kept[0].2.len(), 1);

        let dropped = parse(serde_json::from_str(&row("2020")).unwrap(), 2026).unwrap();
        assert!(dropped.is_empty());
    }

    #[test]
    fn indicators_come_back_in_the_shipped_order_not_the_api_order() {
        // The sample lists GDP growth before inflation; the scorecard wants inflation first
        // so rows line up between countries.
        let germany = &parsed()[0].2;
        assert_eq!(germany[0].code, "FP.CPI.TOTL.ZG");
        assert_eq!(germany[1].code, "NY.GDP.MKTP.KD.ZG");
    }

    /// The API answers errors with a one-element array. Indexing to `[1]` unguarded would
    /// panic on precisely those responses.
    #[test]
    fn an_error_response_is_an_error_not_a_panic() {
        let body = serde_json::json!([{ "message": [{ "id": "120", "value": "Invalid value" }] }]);
        assert!(matches!(
            parse(body, 2026),
            Err(AppError::InvalidResponse { .. })
        ));
    }

    #[test]
    fn a_null_value_is_skipped_rather_than_read_as_zero() {
        // Zero inflation and no data are very different claims.
        let body = serde_json::json!([
            {"page": 1},
            [{"indicator": {"id": "FP.CPI.TOTL.ZG", "value": "x"},
              "country": {"id": "US", "value": "United States"},
              "date": "2025", "value": null}]
        ]);
        assert!(parse(body, 2026).unwrap().is_empty());
    }

    #[test]
    fn an_indicator_this_app_does_not_ship_is_ignored() {
        let body = serde_json::json!([
            {"page": 1},
            [{"indicator": {"id": "SOMETHING.ELSE", "value": "x"},
              "country": {"id": "US", "value": "United States"},
              "date": "2025", "value": 1.0}]
        ]);
        assert!(parse(body, 2026).unwrap().is_empty());
    }

    #[test]
    fn every_shipped_indicator_is_described_and_unique() {
        let mut seen = std::collections::HashSet::new();
        for indicator in INDICATORS {
            assert!(seen.insert(indicator.code), "duplicate {}", indicator.code);
            assert!(!indicator.label.is_empty());
            assert!(!indicator.description.is_empty(), "{}", indicator.code);
        }
    }

    /// Country codes are interpolated into the request path, so the one shape that could
    /// reshape a URL is refused before a request is built.
    #[tokio::test]
    async fn a_country_code_that_could_reshape_the_path_is_refused() {
        let provider = WorldBankProvider::new(reqwest::Client::new());
        for bad in ["US;DE", "../../", "USA", "u", ""] {
            assert!(
                matches!(
                    provider.indicators(&[bad], 2026).await,
                    Err(AppError::Validation { .. })
                ),
                "{bad:?} was not refused"
            );
        }
    }

    #[tokio::test]
    async fn an_empty_country_list_makes_no_request() {
        let provider = WorldBankProvider::new(reqwest::Client::new());
        assert!(provider.indicators(&[], 2026).await.unwrap().is_empty());
    }
}
