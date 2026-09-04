//! Alternative.me — the published crypto Fear & Greed Index.
//!
//! This adapter reports a figure someone else computes. That is the whole of its job: it does
//! not re-weight, re-band or otherwise improve on the published number, because a reported
//! figure that has been quietly adjusted is no longer a reported figure.
//!
//! Terms, limits and attribution: `docs/PROVIDERS.md`. The one rule worth repeating here is
//! theirs: attribution must sit *next to the display of the data*, which is what the provider
//! badge does.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::models::{
    SentimentBand, SentimentBasis, SentimentIndex, SentimentMarket, SentimentPoint,
};
use crate::providers::http;

pub const FNG_ID: &str = "alternative-me";
pub const FNG_NAME: &str = "Alternative.me";
pub const FNG_ATTRIBUTION: &str =
    "Crypto Fear & Greed Index by Alternative.me (alternative.me/crypto/fear-and-greed-index/).";

const BASE: &str = "https://api.alternative.me/fng/";

/// How many daily readings to ask for.
///
/// A quarter is enough for the trend line and the month-ago comparison, and the response is
/// one small JSON object per day — asking for the full history back to 2018 would be several
/// thousand entries to render a 90-point sparkline.
const HISTORY_DAYS: usize = 90;

/// What the publisher says goes into the number.
///
/// Quoted here because the app's rule is that a figure arrives with its provenance, and for a
/// published composite the provenance *is* the methodology. Weights are theirs, as documented
/// on the page above; the survey component is listed there as paused, which is why the live
/// number is five inputs rather than six.
pub const FNG_METHODOLOGY: &str = "Published daily by Alternative.me from Bitcoin volatility \
     (25%), market momentum and volume (25%), social media activity (15%), BTC dominance (10%) \
     and Google Trends (10%). Their survey input (15%) is documented as paused. It describes \
     Bitcoin, which the rest of the crypto market usually but does not always follow.";

/// The API's envelope. Every scalar arrives as a JSON **string**, including the numbers —
/// verified against a live response, not assumed — so nothing here is typed as `i32`.
#[derive(Debug, Deserialize)]
struct FngResponse {
    #[serde(default)]
    data: Vec<FngEntry>,
    #[serde(default)]
    metadata: Option<FngMetadata>,
}

#[derive(Debug, Deserialize)]
struct FngMetadata {
    /// Null on success. Populated with a message on failure — and served with HTTP 200, so
    /// this field is the only signal that the request did not work.
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FngEntry {
    value: String,
    #[serde(default)]
    value_classification: Option<String>,
    /// Unix epoch **seconds**, as a string. The `date_format` parameter would change this to a
    /// locale-shaped date; it is deliberately not sent, so this is never ambiguous.
    timestamp: String,
}

pub struct AlternativeMeProvider {
    client: reqwest::Client,
}

impl AlternativeMeProvider {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    pub async fn fear_and_greed(&self) -> AppResult<SentimentIndex> {
        let url = format!("{BASE}?limit={HISTORY_DAYS}");
        let response: FngResponse = http::get_json(&self.client, FNG_ID, &url, None).await?;
        parse(response)
    }
}

/// Turns the response into an index, or says why it could not.
///
/// Split from the request so the shapes below can be tested without a network — including the
/// ones this app would rather not meet.
fn parse(response: FngResponse) -> AppResult<SentimentIndex> {
    // Checked before the data: they answer errors with HTTP 200 and an error string, so
    // trusting the status code alone would turn an outage into a parse failure.
    if let Some(message) = response.metadata.as_ref().and_then(|m| m.error.as_ref()) {
        tracing::warn!(provider = FNG_ID, error = %message, "provider reported an error");
        return Err(AppError::ProviderError {
            provider_id: FNG_ID.to_string(),
            status: None,
        });
    }

    let mut history: Vec<SentimentPoint> = response
        .data
        .iter()
        .filter_map(|entry| {
            let value = entry.value.trim().parse::<i32>().ok()?;
            let time = entry.timestamp.trim().parse::<i64>().ok()?;
            // A value outside the published 0–100 scale is a malformed record, not a reading
            // to clamp: clamping would invent a number the publisher never issued.
            if !(0..=100).contains(&value) {
                return None;
            }
            Some(SentimentPoint { time, value })
        })
        .collect();

    if history.is_empty() {
        return Err(AppError::InvalidResponse {
            provider_id: FNG_ID.to_string(),
            detail: "no readings in the response".into(),
        });
    }

    // They send newest first; everything downstream — sparklines, the month-ago lookup — reads
    // oldest first.
    history.sort_by_key(|point| point.time);

    let latest = history.last().copied().expect("checked non-empty above");

    // Matched by timestamp rather than by taking the first entry, because the sort above may
    // have moved it and a mismatched label would be worse than none.
    let publisher_label = response
        .data
        .iter()
        .find(|entry| entry.timestamp.trim().parse::<i64>() == Ok(latest.time))
        .and_then(|entry| entry.value_classification.clone())
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty());

    Ok(SentimentIndex {
        // Set by `remember_and_extend` once the stored series is merged in. At construction
        // every point here came from this source, and `None` says exactly that.
        provider_history_since: None,
        market: SentimentMarket::Crypto,
        basis: SentimentBasis::Published,
        value: latest.value,
        band: SentimentBand::of(latest.value),
        as_of: latest.time,
        publisher_label,
        // A published composite is reported, not decomposed. Their inputs are described in
        // `FNG_METHODOLOGY`; inventing per-component scores for them would be fabrication.
        components: Vec::new(),
        history,
        methodology: FNG_METHODOLOGY.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn from_json(body: &str) -> AppResult<SentimentIndex> {
        parse(serde_json::from_str(body).expect("test fixture must be valid JSON"))
    }

    /// Trimmed from a real response captured on 2026-09-01.
    const LIVE_SHAPE: &str = r#"{
        "name": "Fear and Greed Index",
        "data": [
            {"value": "69", "value_classification": "Greed", "timestamp": "1788220800", "time_until_update": "23301"},
            {"value": "62", "value_classification": "Greed", "timestamp": "1788134400"},
            {"value": "24", "value_classification": "Extreme Fear", "timestamp": "1788048000"}
        ],
        "metadata": {"error": null}
    }"#;

    #[test]
    fn parses_the_published_shape() {
        let index = from_json(LIVE_SHAPE).unwrap();
        assert_eq!(index.value, 69);
        assert_eq!(index.as_of, 1_788_220_800);
        assert_eq!(index.market, SentimentMarket::Crypto);
        assert_eq!(index.basis, SentimentBasis::Published);
        assert_eq!(index.history.len(), 3);
    }

    #[test]
    fn numbers_arriving_as_strings_are_still_numbers() {
        // The whole reason this adapter exists rather than a generic JSON one: every scalar
        // in this API is quoted, so a struct typed with `i32` would fail on every response.
        let index = from_json(LIVE_SHAPE).unwrap();
        assert_eq!(index.value, 69);
        assert!(index.history.iter().all(|p| p.time > 1_700_000_000));
    }

    #[test]
    fn history_is_reordered_oldest_first() {
        let index = from_json(LIVE_SHAPE).unwrap();
        let times: Vec<i64> = index.history.iter().map(|p| p.time).collect();
        let mut sorted = times.clone();
        sorted.sort_unstable();
        assert_eq!(times, sorted, "the provider sends newest first");
        assert_eq!(index.history[0].value, 24);
    }

    #[test]
    fn the_latest_reading_is_the_newest_not_the_first_listed() {
        // Guards the sort: taking `data[0]` happens to be right today and would break the
        // day they change their ordering.
        let index = from_json(LIVE_SHAPE).unwrap();
        assert_eq!(index.value, index.history.last().unwrap().value);
        assert_eq!(index.as_of, index.history.last().unwrap().time);
    }

    #[test]
    fn the_publishers_own_label_is_kept() {
        let index = from_json(LIVE_SHAPE).unwrap();
        assert_eq!(index.publisher_label.as_deref(), Some("Greed"));
    }

    #[test]
    fn the_label_is_taken_from_the_newest_entry_after_sorting() {
        // Ordered oldest-first by the provider, with different labels at each end. Reading
        // `data[0]` would attach "Extreme Fear" to a value of 69.
        let body = r#"{
            "data": [
                {"value": "12", "value_classification": "Extreme Fear", "timestamp": "1788048000"},
                {"value": "69", "value_classification": "Greed", "timestamp": "1788220800"}
            ],
            "metadata": {"error": null}
        }"#;
        let index = from_json(body).unwrap();
        assert_eq!(index.value, 69);
        assert_eq!(index.publisher_label.as_deref(), Some("Greed"));
    }

    #[test]
    fn an_error_served_with_http_200_is_still_an_error() {
        let body = r#"{"data": [], "metadata": {"error": "something went wrong"}}"#;
        assert!(matches!(
            from_json(body),
            Err(AppError::ProviderError { .. })
        ));
    }

    #[test]
    fn an_error_takes_priority_over_any_data_alongside_it() {
        // Stale data served next to an error message must not be presented as a reading.
        let body = r#"{
            "data": [{"value": "50", "value_classification": "Neutral", "timestamp": "1788220800"}],
            "metadata": {"error": "rate limit"}
        }"#;
        assert!(matches!(
            from_json(body),
            Err(AppError::ProviderError { .. })
        ));
    }

    #[test]
    fn an_empty_response_is_refused_rather_than_shown_as_zero() {
        // Zero is a real reading on this scale — maximum fear — so an empty response must
        // never become one.
        let body = r#"{"data": [], "metadata": {"error": null}}"#;
        assert!(matches!(
            from_json(body),
            Err(AppError::InvalidResponse { .. })
        ));
    }

    #[test]
    fn a_reading_outside_the_scale_is_dropped_not_clamped() {
        let body = r#"{
            "data": [
                {"value": "140", "value_classification": "Greed", "timestamp": "1788220800"},
                {"value": "44", "value_classification": "Fear", "timestamp": "1788134400"}
            ],
            "metadata": {"error": null}
        }"#;
        let index = from_json(body).unwrap();
        assert_eq!(index.history.len(), 1);
        assert_eq!(index.value, 44, "the impossible reading must not survive");
    }

    #[test]
    fn unparseable_entries_are_skipped_without_losing_the_good_ones() {
        let body = r#"{
            "data": [
                {"value": "not a number", "timestamp": "1788220800"},
                {"value": "50", "timestamp": "not a timestamp"},
                {"value": "31", "value_classification": "Fear", "timestamp": "1788134400"}
            ],
            "metadata": {"error": null}
        }"#;
        let index = from_json(body).unwrap();
        assert_eq!(index.history.len(), 1);
        assert_eq!(index.value, 31);
    }

    #[test]
    fn a_missing_classification_is_absent_rather_than_guessed() {
        let body = r#"{
            "data": [{"value": "69", "timestamp": "1788220800"}],
            "metadata": {"error": null}
        }"#;
        let index = from_json(body).unwrap();
        assert_eq!(index.publisher_label, None);
        assert_eq!(
            index.band,
            SentimentBand::Greed,
            "our own band still applies"
        );
    }

    #[test]
    fn a_missing_metadata_block_is_not_treated_as_an_error() {
        let body = r#"{"data": [{"value": "69", "timestamp": "1788220800"}]}"#;
        assert!(from_json(body).is_ok());
    }

    #[test]
    fn a_published_index_carries_no_invented_components() {
        let index = from_json(LIVE_SHAPE).unwrap();
        assert!(
            index.components.is_empty(),
            "their inputs are described, never decomposed into scores this app made up"
        );
        assert!(!index.methodology.is_empty());
    }

    #[test]
    fn the_index_describes_what_it_actually_covers() {
        // The published index is Bitcoin-only. Presenting it as "crypto sentiment" without
        // that caveat is the single most misleading thing this adapter could do.
        assert!(
            FNG_METHODOLOGY.contains("Bitcoin"),
            "the Bitcoin-only scope must be stated in the methodology the UI renders"
        );
    }
}
