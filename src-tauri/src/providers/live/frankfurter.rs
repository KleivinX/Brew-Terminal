//! Frankfurter — reference exchange rates published by central banks.
//!
//! Keyless, no quota, and open source. It aggregates official reference rates rather than
//! quoting a market, which is exactly the right shape for this app: a published daily figure
//! with a date on it, not a tradeable price implied to be live.
//!
//! What that means on screen, and the reason it is said there too: **these are not dealing
//! rates.** A central bank publishes a reference rate once per working day. Over a weekend the
//! newest figure is Friday's, and the ticker shows Friday's date rather than pretending
//! otherwise.
//!
//! Response shape verified against live calls on 2026-09-05.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::models::RateQuote;
use crate::providers::http;

pub const FRANKFURTER_ID: &str = "frankfurter";
pub const FRANKFURTER_NAME: &str = "Frankfurter (central bank reference rates)";
pub const FRANKFURTER_ATTRIBUTION: &str =
    "Exchange rates from Frankfurter, aggregating official central bank reference rates. \
     Reference rates, not dealing rates.";
pub const FRANKFURTER_DOCS: &str = "https://frankfurter.dev";

const BASE: &str = "https://api.frankfurter.dev/v2/rates";

/// The base currency for the ticker.
///
/// Fixed rather than taken from the display-currency preference. Every pair on the bottom bar
/// has to share a base or the row is not comparable, and USD is the base the published
/// cross-rates are most legible against.
pub const BASE_CURRENCY: &str = "USD";

/// The pairs on the bottom ticker.
///
/// Chosen for trade weight rather than for volatility: these are the currencies the largest
/// share of world merchandise trade is invoiced or settled in.
pub const TICKER_QUOTES: &[&str] = &["EUR", "JPY", "GBP", "CNY", "CHF", "CAD", "INR", "BRL"];

/// How far back to ask, to be sure of finding a previous publication.
///
/// Seven days rather than one. Reference rates are published on working days only, so a Monday
/// request with a one-day window can return a single observation and no change at all — and a
/// long weekend can stretch that to three. A week always spans at least two publications.
const LOOKBACK_DAYS: i64 = 7;

#[derive(Debug, Deserialize)]
struct Observation {
    date: String,
    base: String,
    quote: String,
    rate: f64,
}

pub struct FrankfurterProvider {
    client: reqwest::Client,
}

impl FrankfurterProvider {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    /// The latest published rate for each ticker pair, with its change on the previous
    /// publication.
    ///
    /// One request. The time-series form returns every working day in the window, and the last
    /// two observations per pair give both the rate and the change — which a `latest` call
    /// could not, without a second request per pair.
    pub async fn ticker(&self, today: chrono::NaiveDate) -> AppResult<Vec<RateQuote>> {
        let from = today - chrono::Duration::days(LOOKBACK_DAYS);
        let quotes = TICKER_QUOTES.join(",");
        let url = format!(
            "{BASE}?base={BASE_CURRENCY}&quotes={quotes}&from={}",
            from.format("%Y-%m-%d")
        );

        let observations: Vec<Observation> =
            http::get_json(&self.client, FRANKFURTER_ID, &url, None).await?;

        let rates = to_quotes(observations);
        if rates.is_empty() {
            return Err(AppError::InvalidResponse {
                provider_id: FRANKFURTER_ID.to_string(),
                detail: "no observations in the response".into(),
            });
        }
        Ok(rates)
    }
}

/// Reduces a time series to one row per pair: the newest rate, and its change on the one
/// before it.
fn to_quotes(observations: Vec<Observation>) -> Vec<RateQuote> {
    // Group by quote currency, preserving the order the pairs were requested in so the ticker
    // does not reshuffle itself between refreshes.
    let mut out: Vec<RateQuote> = Vec::new();

    for symbol in TICKER_QUOTES {
        let mut series: Vec<&Observation> = observations
            .iter()
            .filter(|o| o.quote == *symbol && o.rate.is_finite() && o.rate > 0.0)
            .collect();

        if series.is_empty() {
            continue;
        }

        // Ascending by date. ISO dates sort correctly as strings, which is the one thing
        // `YYYY-MM-DD` is for.
        series.sort_by(|a, b| a.date.cmp(&b.date));

        let latest = series[series.len() - 1];
        let previous = series.len().checked_sub(2).map(|i| series[i]);

        // `None` rather than zero where there is nothing to compare against. "Unchanged" and
        // "we do not know" are different claims and the ticker renders them differently.
        let change_pct = previous
            .map(|prior| (latest.rate - prior.rate) / prior.rate * 100.0)
            .filter(|change| change.is_finite());

        out.push(RateQuote {
            base: latest.base.clone(),
            quote: latest.quote.clone(),
            rate: latest.rate,
            date: latest.date.clone(),
            change_pct,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real values from a live call on 2026-09-05.
    const SAMPLE: &str = r#"[
      {"date":"2026-09-03","base":"USD","quote":"EUR","rate":0.8617},
      {"date":"2026-09-03","base":"USD","quote":"JPY","rate":157.89},
      {"date":"2026-09-04","base":"USD","quote":"EUR","rate":0.86012},
      {"date":"2026-09-04","base":"USD","quote":"JPY","rate":156.68},
      {"date":"2026-09-05","base":"USD","quote":"EUR","rate":0.86006},
      {"date":"2026-09-05","base":"USD","quote":"JPY","rate":156.61}
    ]"#;

    fn parse(json: &str) -> Vec<RateQuote> {
        to_quotes(serde_json::from_str(json).unwrap())
    }

    #[test]
    fn reduces_a_series_to_the_newest_rate_per_pair() {
        let quotes = parse(SAMPLE);
        assert_eq!(quotes.len(), 2);

        let eur = quotes.iter().find(|q| q.quote == "EUR").unwrap();
        assert_eq!(eur.date, "2026-09-05");
        assert!((eur.rate - 0.86006).abs() < 1e-9);
        assert_eq!(eur.base, "USD");
    }

    #[test]
    fn the_change_is_against_the_previous_publication() {
        let quotes = parse(SAMPLE);
        let jpy = quotes.iter().find(|q| q.quote == "JPY").unwrap();
        // 156.61 from 156.68 is a touch under a twentieth of a percent, negative.
        let expected = (156.61 - 156.68) / 156.68 * 100.0;
        assert!((jpy.change_pct.unwrap() - expected).abs() < 1e-9);
        assert!(jpy.change_pct.unwrap() < 0.0);
    }

    /// Zero would read as "unchanged", which is a claim. With one observation there is
    /// nothing to compare against and the ticker must show a dash.
    #[test]
    fn a_single_observation_has_no_change_rather_than_a_zero_change() {
        let quotes = parse(r#"[{"date":"2026-09-05","base":"USD","quote":"EUR","rate":0.86}]"#);
        assert_eq!(quotes.len(), 1);
        assert_eq!(quotes[0].change_pct, None);
    }

    /// Observations arrive grouped by date, not by pair, and nothing promises they are
    /// ordered. Taking the last row seen for a pair would be wrong on a reordered response.
    #[test]
    fn out_of_order_observations_still_yield_the_newest() {
        let json = r#"[
          {"date":"2026-09-05","base":"USD","quote":"EUR","rate":0.86006},
          {"date":"2026-09-03","base":"USD","quote":"EUR","rate":0.8617},
          {"date":"2026-09-04","base":"USD","quote":"EUR","rate":0.86012}
        ]"#;
        let eur = &parse(json)[0];
        assert_eq!(eur.date, "2026-09-05");
        let expected = (0.86006 - 0.86012) / 0.86012 * 100.0;
        assert!((eur.change_pct.unwrap() - expected).abs() < 1e-9);
    }

    #[test]
    fn pairs_keep_the_shipped_order_so_the_ticker_does_not_reshuffle() {
        // The sample lists EUR and JPY interleaved; TICKER_QUOTES puts EUR first.
        let quotes = parse(SAMPLE);
        assert_eq!(quotes[0].quote, "EUR");
        assert_eq!(quotes[1].quote, "JPY");
    }

    #[test]
    fn a_zero_or_negative_rate_is_discarded() {
        // A rate of zero would make the change calculation divide by zero on the next tick.
        let json = r#"[
          {"date":"2026-09-04","base":"USD","quote":"EUR","rate":0.0},
          {"date":"2026-09-05","base":"USD","quote":"EUR","rate":0.86}
        ]"#;
        let eur = &parse(json)[0];
        assert!((eur.rate - 0.86).abs() < 1e-9);
        assert_eq!(eur.change_pct, None, "the zero must not become a divisor");
    }

    #[test]
    fn a_currency_that_was_not_requested_is_ignored() {
        let json = r#"[{"date":"2026-09-05","base":"USD","quote":"XYZ","rate":1.0}]"#;
        assert!(parse(json).is_empty());
    }

    #[test]
    fn an_empty_response_yields_nothing() {
        assert!(parse("[]").is_empty());
    }

    #[test]
    fn the_ticker_pairs_are_unique_and_exclude_the_base() {
        // Requesting USD against USD returns nothing from the API and would leave a blank
        // cell on the bar.
        let mut seen = std::collections::HashSet::new();
        for quote in TICKER_QUOTES {
            assert!(seen.insert(*quote), "duplicate pair {quote}");
            assert_ne!(*quote, BASE_CURRENCY);
            assert_eq!(quote.len(), 3, "{quote} is not an ISO 4217 code");
        }
    }
}
