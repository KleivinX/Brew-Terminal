//! Sentry — the global trade and macro monitor.
//!
//! Fans out across several unrelated public sources, each on its own terms, and returns one
//! board. Three things shape how that is done.
//!
//! **A layer fails alone.** Every source is fetched independently and wrapped in its own
//! envelope, so the World Bank being slow does not cost you the earthquake feed. A layer that
//! fails keeps whatever it last had, marked stale, with the reason attached — never a blank
//! panel and never a silent gap.
//!
//! **The fan-out is concurrent.** Five sequential HTTP calls at a second each is five seconds
//! of an empty map. They are independent, so they run together and the board arrives at the
//! speed of the slowest one.
//!
//! **Nothing is combined except distance.** The layers are drawn side by side and left that
//! way. The one exception is `watch::proximities`, which reports how far a hazard is from a
//! port — arithmetic over two published facts, and deliberately nothing more. See that module.

pub mod geography;
pub mod watch;

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use chrono::Datelike;

use crate::error::AppResult;
use crate::models::{
    now_epoch_secs, EconomyScore, Envelope, EnvelopeMeta, EnvelopeSource, LayerStatus, MapMarker,
    MarkerFact, MarkerSeverity, RateQuote, SentryLayer, SentrySnapshot,
};
use crate::providers::cache::{cache_key, CacheKind};
use crate::providers::live::{frankfurter, nws, opensky, usgs, worldbank};
use crate::services::market::cached_or_degraded;
use crate::state::AppState;

/// One refresh of the whole board.
pub async fn snapshot(state: &AppState) -> AppResult<SentrySnapshot> {
    let registry = &state.registry;

    let seismic_on = registry.sentry_enabled(usgs::USGS_ID);
    let weather_on = registry.sentry_enabled(nws::NWS_ID);
    let economy_on = registry.sentry_enabled(worldbank::WORLDBANK_ID);
    let rates_on = registry.sentry_enabled(frankfurter::FRANKFURTER_ID);
    let flights_on = registry.sentry_enabled(opensky::OPENSKY_ID);

    // How many active alerts had no coordinates to place them at. Set inside the fetch
    // closure, which is why it is shared rather than returned: the cache helper's signature
    // carries a list, and threading a second value through it would change every caller.
    // Negative means "we did not get a fresh answer", which is different from zero.
    let unmapped = Arc::new(AtomicI64::new(-1));

    // Independent sources, so they run together. Sequentially this is the sum of five round
    // trips; concurrently it is the slowest one.
    let (seismic, weather, economy, rates, flights) = tokio::join!(
        fetch_seismic(state, seismic_on),
        fetch_weather(state, weather_on, unmapped.clone()),
        fetch_economy(state, economy_on),
        fetch_rates(state, rates_on),
        fetch_flights(state, flights_on),
    );

    let sites = geography::chokepoints();

    // Reference geography first so it draws underneath the hazards.
    let mut markers: Vec<MapMarker> = sites.iter().map(site_marker).collect();

    let economies = economy
        .as_ref()
        .map(|envelope| envelope.data.clone())
        .unwrap_or_default();
    markers.extend(economies.iter().map(economy_marker));

    for envelope in [&seismic, &weather, &flights].into_iter().flatten() {
        markers.extend(envelope.data.iter().cloned());
    }

    let proximities = watch::proximities(&markers, &sites);

    let unmapped_count = unmapped.load(Ordering::Relaxed);
    let layers = vec![
        LayerStatus {
            layer: SentryLayer::Chokepoints,
            label: "Chokepoints and ports".into(),
            description: "Straits, canals and container ports, with the transit volumes their \
                          publishers report."
                .into(),
            // No source to switch: this one ships with the app.
            provider_id: None,
            enabled: true,
            needs_credential: false,
            // Said plainly rather than left to be inferred from a map that never changes.
            coverage_note: Some(
                "Shipped reference geography, not a live feed. Figures carry their own source \
                 and period."
                    .into(),
            ),
            count: sites.len() as i64,
            meta: None,
        },
        status(
            SentryLayer::Seismic,
            "Earthquakes",
            "Magnitude 4.5 and above worldwide, past 24 hours.",
            usgs::USGS_ID,
            seismic_on,
            false,
            None,
            &seismic,
        ),
        status(
            SentryLayer::Weather,
            "Severe weather",
            "Active severe and extreme weather warnings.",
            nws::NWS_ID,
            weather_on,
            false,
            Some(weather_coverage(unmapped_count)),
            &weather,
        ),
        status(
            SentryLayer::Economy,
            "Economies",
            "Inflation, growth, debt, current account and unemployment by country.",
            worldbank::WORLDBANK_ID,
            economy_on,
            false,
            Some(
                "Annual national accounts. Each figure is shown with the year it belongs to, \
                 which differs between countries."
                    .into(),
            ),
            &economy,
        ),
        status(
            SentryLayer::Rates,
            "Exchange rates",
            "Central bank reference rates against the US dollar.",
            frankfurter::FRANKFURTER_ID,
            rates_on,
            false,
            Some("Reference rates published once a working day, not dealing rates.".into()),
            &rates,
        ),
        status(
            SentryLayer::Flights,
            "Freight aircraft",
            "Aircraft operated by dedicated cargo airlines, in the air now.",
            opensky::OPENSKY_ID,
            flights_on,
            !crate::security::secrets::exists(opensky::OPENSKY_ID),
            Some(
                "Needs your own OpenSky credentials. Their licence covers non-profit research \
                 and education; operational use requires a written agreement with OpenSky."
                    .into(),
            ),
            &flights,
        ),
    ];

    Ok(SentrySnapshot {
        layers,
        markers,
        economies,
        rates: rates.map(|envelope| envelope.data).unwrap_or_default(),
        proximities,
    })
}

/// The weather layer's coverage line.
///
/// Two facts, both of which the reader would otherwise have to infer from an empty map: the
/// feed is American, and about half of its alerts are scoped to named forecast zones with no
/// coordinates and cannot be drawn.
fn weather_coverage(unmapped: i64) -> String {
    let base = "United States only — no equivalent free global alert feed exists.";
    if unmapped > 0 {
        format!(
            "{base} {unmapped} more active warnings cover named forecast zones with no \
                 coordinates, so they are not on the map."
        )
    } else {
        base.to_string()
    }
}

/// Builds a layer's status row from whatever its fetch produced.
#[allow(clippy::too_many_arguments)]
fn status(
    layer: SentryLayer,
    label: &str,
    description: &str,
    provider_id: &str,
    enabled: bool,
    needs_credential: bool,
    coverage_note: Option<String>,
    result: &Option<Envelope<Vec<impl Clone>>>,
) -> LayerStatus {
    LayerStatus {
        layer,
        label: label.to_string(),
        description: description.to_string(),
        provider_id: Some(provider_id.to_string()),
        enabled,
        needs_credential,
        coverage_note,
        count: result.as_ref().map(|e| e.data.len() as i64).unwrap_or(0),
        meta: result.as_ref().map(|e| e.meta.clone()),
    }
}

/// A shared shape for the four list fetches: `None` when the layer is off, an envelope
/// otherwise — including when the request failed, because a failed layer still has a provider,
/// an age and a reason, and the sidebar renders all three.
macro_rules! layer_fetch {
    ($state:expr, $enabled:expr, $kind:expr, $key:expr, $id:expr, $name:expr, $fetch:expr) => {{
        if !$enabled {
            return None;
        }
        cached_or_degraded(
            $state,
            $kind,
            $key,
            $id,
            $name,
            EnvelopeSource::Live,
            $fetch,
        )
        .await
        .ok()
    }};
}

async fn fetch_seismic(state: &AppState, enabled: bool) -> Option<Envelope<Vec<MapMarker>>> {
    let provider = state.registry.usgs();
    layer_fetch!(
        state,
        enabled,
        CacheKind::Hazard,
        cache_key(usgs::USGS_ID, "quakes", &[]),
        usgs::USGS_ID,
        usgs::USGS_NAME,
        || async move { provider.recent_quakes().await }
    )
}

async fn fetch_weather(
    state: &AppState,
    enabled: bool,
    unmapped: Arc<AtomicI64>,
) -> Option<Envelope<Vec<MapMarker>>> {
    let provider = state.registry.nws();
    layer_fetch!(
        state,
        enabled,
        CacheKind::Hazard,
        cache_key(nws::NWS_ID, "alerts", &[]),
        nws::NWS_ID,
        nws::NWS_NAME,
        || async move {
            let parsed = provider.active_alerts().await?;
            // Only recorded on a successful fetch. Serving a cached list alongside a count
            // from a different request would be a small, plausible, untraceable lie.
            unmapped.store(parsed.unmapped, Ordering::Relaxed);
            Ok(parsed.markers)
        }
    )
}

async fn fetch_economy(state: &AppState, enabled: bool) -> Option<Envelope<Vec<EconomyScore>>> {
    let provider = state.registry.worldbank();
    let year = chrono::Utc::now().year() as i64;

    layer_fetch!(
        state,
        enabled,
        CacheKind::Reference,
        cache_key(worldbank::WORLDBANK_ID, "indicators", &[]),
        worldbank::WORLDBANK_ID,
        worldbank::WORLDBANK_NAME,
        || async move {
            let rows = provider
                .indicators(&geography::country_codes(), year)
                .await?;

            Ok(rows
                .into_iter()
                .filter_map(|(code, name, indicators)| {
                    // A country with no placeable point is dropped rather than pinned
                    // somewhere arbitrary. In practice this cannot happen — the codes come
                    // from the same table as the coordinates — but the alternative to
                    // dropping is guessing.
                    let point = geography::country_point(&code)?;
                    Some(EconomyScore {
                        country_code: code,
                        country_name: name,
                        lat: point.lat,
                        lon: point.lon,
                        indicators,
                    })
                })
                .collect())
        }
    )
}

async fn fetch_rates(state: &AppState, enabled: bool) -> Option<Envelope<Vec<RateQuote>>> {
    let provider = state.registry.frankfurter();
    let today = chrono::Utc::now().date_naive();

    layer_fetch!(
        state,
        enabled,
        CacheKind::Reference,
        cache_key(frankfurter::FRANKFURTER_ID, "ticker", &[]),
        frankfurter::FRANKFURTER_ID,
        frankfurter::FRANKFURTER_NAME,
        || async move { provider.ticker(today).await }
    )
}

async fn fetch_flights(state: &AppState, enabled: bool) -> Option<Envelope<Vec<MapMarker>>> {
    let provider = state.registry.opensky();
    let now = now_epoch_secs();

    layer_fetch!(
        state,
        enabled,
        CacheKind::Hazard,
        cache_key(opensky::OPENSKY_ID, "freight", &[]),
        opensky::OPENSKY_ID,
        opensky::OPENSKY_NAME,
        || async move { provider.freight_flights(now).await }
    )
}

/// A chokepoint as a map marker.
fn site_marker(site: &crate::models::Chokepoint) -> MapMarker {
    let mut facts = vec![MarkerFact::new(
        "Type",
        match site.kind {
            crate::models::ChokepointKind::Strait => "Strait",
            crate::models::ChokepointKind::Canal => "Canal",
            crate::models::ChokepointKind::Port => "Port",
        },
    )];

    if let Some(throughput) = &site.throughput {
        facts.push(MarkerFact::new("Throughput", throughput.clone()));
    }
    if let Some(source) = &site.source {
        facts.push(MarkerFact::new("Source", source.clone()));
    }
    facts.push(MarkerFact::new("About", site.note.clone()));

    MapMarker {
        id: format!("chokepoints:{}", site.id),
        layer: SentryLayer::Chokepoints,
        lat: site.lat,
        lon: site.lon,
        label: site.name.clone(),
        summary: site.note.clone(),
        severity: MarkerSeverity::Info,
        scale: None,
        // Reference geography has no observation time, and giving it one would present a
        // shipped constant as a fresh measurement.
        observed_at: None,
        facts,
        source_url: None,
    }
}

/// A country's scorecard as a map marker.
fn economy_marker(economy: &EconomyScore) -> MapMarker {
    let facts = economy
        .indicators
        .iter()
        .map(|indicator| {
            MarkerFact::new(
                &indicator.label,
                // The year travels with the value, in the same string, because these differ
                // between countries within one response.
                format!(
                    "{:.1}{} ({})",
                    indicator.value, indicator.unit, indicator.year
                ),
            )
        })
        .collect();

    MapMarker {
        id: format!("economy:{}", economy.country_code),
        layer: SentryLayer::Economy,
        lat: economy.lat,
        lon: economy.lon,
        label: economy.country_code.clone(),
        summary: economy.country_name.clone(),
        severity: MarkerSeverity::Info,
        scale: None,
        observed_at: None,
        facts,
        source_url: None,
    }
}

/// Attribution for every source that could appear on the board.
///
/// Returned to the frontend so the footer can name them without hard-coding a list that drifts
/// out of step with the registry.
pub fn attributions() -> Vec<String> {
    crate::providers::registry::SENTRY_PROVIDERS
        .iter()
        .map(|provider| provider.attribution.to_string())
        .collect()
}

/// Reads the meta off a layer, for tests and for callers that only want provenance.
pub fn layer_meta(snapshot: &SentrySnapshot, layer: SentryLayer) -> Option<&EnvelopeMeta> {
    snapshot
        .layers
        .iter()
        .find(|status| status.layer == layer)
        .and_then(|status| status.meta.as_ref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo_providers;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    /// Every layer off. Nothing should reach the network, and the board should still describe
    /// itself completely.
    fn offline_state() -> (AppState, tempfile::TempDir) {
        let (state, dir) = state();
        {
            let conn = state.pool.get().unwrap();
            for provider in crate::providers::registry::SENTRY_PROVIDERS {
                repo_providers::set_enabled(&conn, provider.id, false).unwrap();
            }
        }
        (state, dir)
    }

    #[tokio::test]
    async fn the_geography_is_there_with_every_source_switched_off() {
        // The point of shipping it as a constant: a map with no network is still a map.
        let (state, _dir) = offline_state();
        let snapshot = snapshot(&state).await.unwrap();

        assert!(!snapshot.markers.is_empty());
        assert!(snapshot
            .markers
            .iter()
            .all(|m| m.layer == SentryLayer::Chokepoints));
    }

    #[tokio::test]
    async fn every_layer_is_listed_even_when_it_is_off() {
        // A layer missing from the sidebar cannot be switched on, and nothing else would
        // report that it is absent.
        let (state, _dir) = offline_state();
        let snapshot = snapshot(&state).await.unwrap();

        assert_eq!(snapshot.layers.len(), SentryLayer::ALL.len());
        for layer in SentryLayer::ALL {
            assert!(
                snapshot.layers.iter().any(|status| status.layer == *layer),
                "{:?} is missing from the sidebar",
                layer
            );
        }
    }

    #[tokio::test]
    async fn a_disabled_layer_carries_no_provenance_and_no_count() {
        let (state, _dir) = offline_state();
        let snapshot = snapshot(&state).await.unwrap();

        for status in &snapshot.layers {
            if status.layer == SentryLayer::Chokepoints {
                continue;
            }
            assert!(!status.enabled, "{:?} should be off", status.layer);
            assert_eq!(status.count, 0);
            assert!(
                status.meta.is_none(),
                "{:?} claimed a provider it never asked",
                status.layer
            );
        }
    }

    #[tokio::test]
    async fn the_flights_layer_says_it_needs_a_credential() {
        let (state, _dir) = offline_state();
        let snapshot = snapshot(&state).await.unwrap();

        let flights = snapshot
            .layers
            .iter()
            .find(|status| status.layer == SentryLayer::Flights)
            .unwrap();
        assert!(flights.needs_credential);
        assert!(flights
            .coverage_note
            .as_deref()
            .unwrap()
            .contains("written agreement"));
    }

    /// The limitation a reader would otherwise have to infer from an empty Pacific.
    #[tokio::test]
    async fn the_weather_layer_states_its_coverage() {
        let (state, _dir) = offline_state();
        let snapshot = snapshot(&state).await.unwrap();

        let weather = snapshot
            .layers
            .iter()
            .find(|status| status.layer == SentryLayer::Weather)
            .unwrap();
        assert!(weather
            .coverage_note
            .as_deref()
            .unwrap()
            .contains("United States only"));
    }

    #[test]
    fn the_unmapped_note_is_only_added_when_there_is_something_to_report() {
        assert!(!weather_coverage(0).contains("more active warnings"));
        assert!(!weather_coverage(-1).contains("more active warnings"));
        assert!(weather_coverage(12).contains("12 more active warnings"));
    }

    #[tokio::test]
    async fn reference_geography_is_never_shown_as_freshly_measured() {
        let (state, _dir) = offline_state();
        let snapshot = snapshot(&state).await.unwrap();

        assert!(
            snapshot.markers.iter().all(|m| m.observed_at.is_none()),
            "a shipped constant claimed an observation time"
        );
    }

    #[tokio::test]
    async fn a_sites_quoted_figure_reaches_the_inspector_with_its_source() {
        let (state, _dir) = offline_state();
        let snapshot = snapshot(&state).await.unwrap();

        let hormuz = snapshot
            .markers
            .iter()
            .find(|m| m.id == "chokepoints:strait-hormuz")
            .unwrap();

        assert!(hormuz.facts.iter().any(|f| f.label == "Throughput"));
        assert!(hormuz
            .facts
            .iter()
            .any(|f| f.label == "Source" && f.value.contains("Energy Information")));
    }

    /// A port with no verified throughput shows its role and no number — and crucially, no
    /// orphan "Source" row either.
    #[tokio::test]
    async fn a_site_without_a_verified_figure_quotes_none() {
        let (state, _dir) = offline_state();
        let snapshot = snapshot(&state).await.unwrap();

        let busan = snapshot
            .markers
            .iter()
            .find(|m| m.id == "chokepoints:port-busan")
            .unwrap();

        assert!(!busan.facts.iter().any(|f| f.label == "Throughput"));
        assert!(!busan.facts.iter().any(|f| f.label == "Source"));
        assert!(busan.facts.iter().any(|f| f.label == "About"));
    }

    #[tokio::test]
    async fn marker_ids_are_unique_across_layers() {
        // Two markers sharing an id would make selection ambiguous and the proximity rows
        // point at the wrong thing.
        let (state, _dir) = offline_state();
        let snapshot = snapshot(&state).await.unwrap();

        let mut seen = std::collections::HashSet::new();
        for marker in &snapshot.markers {
            assert!(seen.insert(marker.id.clone()), "duplicate id {}", marker.id);
        }
    }

    #[tokio::test]
    async fn nothing_is_near_anything_when_there_are_no_hazards() {
        let (state, _dir) = offline_state();
        let snapshot = snapshot(&state).await.unwrap();
        assert!(snapshot.proximities.is_empty());
    }

    #[test]
    fn every_source_that_can_appear_is_attributed() {
        let attributions = attributions();
        assert_eq!(
            attributions.len(),
            crate::providers::registry::SENTRY_PROVIDERS.len()
        );
        assert!(attributions.iter().all(|a| !a.trim().is_empty()));
    }
}
