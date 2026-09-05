//! The proximity engine.
//!
//! The only thing in Sentry that combines two sources, and therefore the only thing that could
//! invent something neither of them said. So its output is deliberately thin: **a hazard, a
//! place, and the distance between them.** Nothing about closure, disruption, delay, cost, or
//! what any of it means for a price.
//!
//! That restraint is the design, not a gap in it. "Magnitude 6.1, 140 km from the Port of
//! Kaohsiung" is arithmetic over two published facts and a reader can check every part of it.
//! "Expect container delays" is a forecast, and this app does not make those — see ADR-022 and
//! ADR-035. The screen says the same thing in the copy above the list.
//!
//! Pure and clock-free: the inputs are slices and the output is a vector, so every rule here is
//! testable without a network, a database or a `now`.

use crate::models::{Chokepoint, MapMarker, MarkerSeverity, Proximity, SentryLayer};

use super::geography::distance_km;

/// How near a hazard has to be to a site before it is worth a row.
///
/// Five hundred kilometres. Chosen so the list stays rare enough to mean something: on a
/// typical day the magnitude 4.5+ feed holds a few dozen events worldwide and this yields
/// none or one. A radius wide enough to catch something every day would train the reader to
/// ignore it, which is the failure mode every alerting system eventually finds.
///
/// It is a single flat radius rather than one scaled by magnitude, because scaling it would be
/// this file deciding how far a given earthquake "matters", which is the judgement it exists
/// not to make.
pub const WATCH_RADIUS_KM: f64 = 500.0;

/// The most rows the panel will show.
pub const MAX_PROXIMITIES: usize = 12;

/// Layers whose markers count as hazards.
///
/// Flights and the reference geography are excluded, and the reason is worth stating: a
/// freighter near a port is what freighters do, and a port near a strait is where ports are
/// built. Either would fill the panel with things that are true and mean nothing.
fn is_hazard(layer: SentryLayer) -> bool {
    matches!(layer, SentryLayer::Seismic | SentryLayer::Weather)
}

/// Hazards within `WATCH_RADIUS_KM` of a site, nearest site per hazard.
///
/// One row per hazard, not one per pair. An earthquake in the Gulf is within range of Hormuz,
/// Jebel Ali and possibly a third site, and listing all three would treble the panel without
/// adding a fact — the nearest is the one that says the most.
pub fn proximities(markers: &[MapMarker], sites: &[Chokepoint]) -> Vec<Proximity> {
    let mut out = Vec::new();

    for marker in markers.iter().filter(|m| is_hazard(m.layer)) {
        let nearest = sites
            .iter()
            .map(|site| {
                (
                    site,
                    distance_km(marker.lat, marker.lon, site.lat, site.lon),
                )
            })
            // `partial_cmp` rather than `total_cmp` would need an unwrap here; distances from
            // `distance_km` are always finite, and `total_cmp` says so without one.
            .min_by(|a, b| a.1.total_cmp(&b.1));

        let Some((site, distance)) = nearest else {
            // No geography loaded at all. Nothing to be near.
            break;
        };

        if distance > WATCH_RADIUS_KM {
            continue;
        }

        out.push(Proximity {
            marker_id: marker.id.clone(),
            hazard_label: marker.label.clone(),
            hazard_layer: marker.layer,
            chokepoint_id: site.id.clone(),
            chokepoint_name: site.name.clone(),
            // Whole kilometres. The hazard is a point standing in for an area, so a decimal
            // place here would be precision the input does not have.
            distance_km: distance.round(),
            severity: marker.severity,
            observed_at: marker.observed_at,
        });
    }

    // Severe first, then nearest. Severity leads because it is the property the reader is
    // scanning for; distance breaks ties within a level.
    out.sort_by(|a, b| {
        severity_rank(b.severity)
            .cmp(&severity_rank(a.severity))
            .then(a.distance_km.total_cmp(&b.distance_km))
    });

    out.truncate(MAX_PROXIMITIES);
    out
}

fn severity_rank(severity: MarkerSeverity) -> u8 {
    match severity {
        MarkerSeverity::Severe => 2,
        MarkerSeverity::Notable => 1,
        MarkerSeverity::Info => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ChokepointKind;

    fn site(id: &str, name: &str, lat: f64, lon: f64) -> Chokepoint {
        Chokepoint {
            id: id.into(),
            name: name.into(),
            lat,
            lon,
            kind: ChokepointKind::Port,
            throughput: None,
            source: None,
            note: String::new(),
        }
    }

    fn hazard(
        id: &str,
        layer: SentryLayer,
        lat: f64,
        lon: f64,
        severity: MarkerSeverity,
    ) -> MapMarker {
        MapMarker {
            id: id.into(),
            layer,
            lat,
            lon,
            label: id.into(),
            summary: String::new(),
            severity,
            scale: None,
            observed_at: Some(1_788_000_000),
            facts: Vec::new(),
            source_url: None,
        }
    }

    /// Hormuz, and Jebel Ali about 190 km away inside the Gulf.
    fn gulf() -> Vec<Chokepoint> {
        vec![
            site("hormuz", "Strait of Hormuz", 26.57, 56.25),
            site("jebel", "Jebel Ali", 25.01, 55.06),
        ]
    }

    #[test]
    fn a_hazard_beside_a_site_is_reported_with_its_distance() {
        // About 55 km north-west of Hormuz.
        let markers = vec![hazard(
            "seismic:a",
            SentryLayer::Seismic,
            27.0,
            55.9,
            MarkerSeverity::Severe,
        )];
        let found = proximities(&markers, &gulf());

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].chokepoint_id, "hormuz");
        assert!(
            (30.0..90.0).contains(&found[0].distance_km),
            "got {} km",
            found[0].distance_km
        );
    }

    /// One row per hazard, not one per pair. An event in the Gulf is near several sites, and
    /// listing every pair would treble the panel without adding a fact.
    #[test]
    fn only_the_nearest_site_is_reported_for_a_hazard() {
        let markers = vec![hazard(
            "seismic:a",
            SentryLayer::Seismic,
            26.5,
            56.0,
            MarkerSeverity::Severe,
        )];
        let found = proximities(&markers, &gulf());

        assert_eq!(found.len(), 1, "one hazard must produce one row");
        assert_eq!(found[0].chokepoint_id, "hormuz");
    }

    #[test]
    fn a_hazard_beyond_the_radius_is_not_reported() {
        // The middle of the Pacific.
        let markers = vec![hazard(
            "seismic:far",
            SentryLayer::Seismic,
            0.0,
            -150.0,
            MarkerSeverity::Severe,
        )];
        assert!(proximities(&markers, &gulf()).is_empty());
    }

    #[test]
    fn the_radius_boundary_is_inclusive_and_one_step_past_it_is_not() {
        let sites = vec![site("origin", "Origin", 0.0, 0.0)];
        // Along the equator, a degree of longitude is about 111.19 km.
        let inside = hazard(
            "seismic:in",
            SentryLayer::Seismic,
            0.0,
            4.4,
            MarkerSeverity::Info,
        );
        let outside = hazard(
            "seismic:out",
            SentryLayer::Seismic,
            0.0,
            4.6,
            MarkerSeverity::Info,
        );

        assert_eq!(proximities(&[inside], &sites).len(), 1);
        assert_eq!(proximities(&[outside], &sites).len(), 0);
    }

    /// A freighter near a port is what freighters do; a port near a strait is where ports are
    /// built. Either would fill the panel with things that are true and mean nothing.
    #[test]
    fn flights_and_reference_geography_are_not_treated_as_hazards() {
        let markers = vec![
            hazard(
                "flights:a",
                SentryLayer::Flights,
                26.57,
                56.25,
                MarkerSeverity::Info,
            ),
            hazard(
                "chokepoints:b",
                SentryLayer::Chokepoints,
                26.57,
                56.25,
                MarkerSeverity::Info,
            ),
            hazard(
                "rates:c",
                SentryLayer::Rates,
                26.57,
                56.25,
                MarkerSeverity::Info,
            ),
            hazard(
                "economy:d",
                SentryLayer::Economy,
                26.57,
                56.25,
                MarkerSeverity::Info,
            ),
        ];
        assert!(proximities(&markers, &gulf()).is_empty());
    }

    #[test]
    fn weather_counts_as_a_hazard_alongside_seismic() {
        let markers = vec![hazard(
            "weather:a",
            SentryLayer::Weather,
            26.57,
            56.25,
            MarkerSeverity::Severe,
        )];
        assert_eq!(proximities(&markers, &gulf()).len(), 1);
    }

    #[test]
    fn severe_leads_and_distance_breaks_ties_within_a_level() {
        let sites = vec![site("origin", "Origin", 0.0, 0.0)];
        let markers = vec![
            // Nearest, but only informational.
            hazard(
                "seismic:near-info",
                SentryLayer::Seismic,
                0.0,
                0.1,
                MarkerSeverity::Info,
            ),
            // Furthest severe.
            hazard(
                "seismic:far-severe",
                SentryLayer::Seismic,
                0.0,
                3.0,
                MarkerSeverity::Severe,
            ),
            // Nearer severe.
            hazard(
                "seismic:mid-severe",
                SentryLayer::Seismic,
                0.0,
                1.0,
                MarkerSeverity::Severe,
            ),
        ];

        let found = proximities(&markers, &sites);
        let order: Vec<&str> = found.iter().map(|p| p.marker_id.as_str()).collect();
        assert_eq!(
            order,
            vec![
                "seismic:mid-severe",
                "seismic:far-severe",
                "seismic:near-info"
            ]
        );
    }

    #[test]
    fn the_list_is_capped() {
        let sites = vec![site("origin", "Origin", 0.0, 0.0)];
        let markers: Vec<MapMarker> = (0..40)
            .map(|i| {
                hazard(
                    &format!("seismic:{i}"),
                    SentryLayer::Seismic,
                    f64::from(i) * 0.05,
                    0.0,
                    MarkerSeverity::Notable,
                )
            })
            .collect();

        assert_eq!(proximities(&markers, &sites).len(), MAX_PROXIMITIES);
    }

    #[test]
    fn distances_are_whole_kilometres() {
        let sites = vec![site("origin", "Origin", 0.0, 0.0)];
        let markers = vec![hazard(
            "seismic:a",
            SentryLayer::Seismic,
            0.0,
            1.0,
            MarkerSeverity::Info,
        )];

        let distance = proximities(&markers, &sites)[0].distance_km;
        assert_eq!(distance, distance.round(), "got {distance}");
    }

    #[test]
    fn no_geography_yields_no_rows_rather_than_a_panic() {
        let markers = vec![hazard(
            "seismic:a",
            SentryLayer::Seismic,
            0.0,
            0.0,
            MarkerSeverity::Severe,
        )];
        assert!(proximities(&markers, &[]).is_empty());
    }

    #[test]
    fn no_hazards_yields_no_rows() {
        assert!(proximities(&[], &gulf()).is_empty());
    }

    /// The row has to point back at a marker that is on the map, or clicking it selects
    /// nothing.
    #[test]
    fn every_row_carries_the_marker_id_it_came_from() {
        let markers = vec![hazard(
            "seismic:us7000tel1",
            SentryLayer::Seismic,
            26.57,
            56.25,
            MarkerSeverity::Severe,
        )];
        let found = proximities(&markers, &gulf());
        assert_eq!(found[0].marker_id, "seismic:us7000tel1");
        assert_eq!(found[0].hazard_layer, SentryLayer::Seismic);
        assert_eq!(found[0].observed_at, Some(1_788_000_000));
    }
}
