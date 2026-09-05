//! National Weather Service active alerts.
//!
//! **United States only.** This is the honest limitation of the layer and it is stated on the
//! sidebar toggle rather than left for the reader to discover from an empty Pacific. There is
//! no equivalent free, keyless, documented, global severe-weather alert feed: the WMO's
//! register federates national services that each publish under their own terms, and stitching
//! them together is a project rather than an adapter.
//!
//! No credential. The published requirement is a User-Agent identifying the client with a
//! contact address, which `providers::http::USER_AGENT` already satisfies for FRED's WAF and
//! satisfies here for the same reason.
//!
//! Response shape and query parameters verified against live calls on 2026-09-05.

use serde::Deserialize;

use crate::error::AppResult;
use crate::models::{MapMarker, MarkerFact, MarkerSeverity, SentryLayer};
use crate::providers::http;

pub const NWS_ID: &str = "nws";
pub const NWS_NAME: &str = "NOAA / National Weather Service";
pub const NWS_ATTRIBUTION: &str =
    "Severe weather alerts from the NOAA National Weather Service (United States only). NWS \
     output is in the public domain.";
pub const NWS_DOCS: &str = "https://www.weather.gov/documentation/services-web-api";

/// Active alerts, severe and above, original messages only.
///
/// Each filter earns its place:
///
/// - `severity=Extreme,Severe` — the two levels the service itself calls significant. Including
///   Moderate roughly triples the volume with advisories that are not trade-relevant.
/// - `status=actual` — excludes exercise, system test and draft messages. Without it a
///   scheduled NWS test broadcast would render as a live warning on the map.
/// - `message_type=alert` — original issuances only, dropping Update and Cancel notices for
///   alerts already on the board. Measured on 2026-09-05 this took the response from 61
///   features and 387 KB down to 35 features and 212 KB, and removed the duplicate markers
///   that updates would otherwise have produced.
const FEED: &str = "https://api.weather.gov/alerts/active\
                    ?severity=Extreme,Severe&status=actual&message_type=alert";

#[derive(Debug, Deserialize)]
struct AlertCollection {
    #[serde(default)]
    features: Vec<AlertFeature>,
}

#[derive(Debug, Deserialize)]
struct AlertFeature {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    properties: Option<AlertProperties>,
    #[serde(default)]
    geometry: Option<AlertGeometry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlertProperties {
    #[serde(default)]
    event: Option<String>,
    #[serde(default)]
    area_desc: Option<String>,
    #[serde(default)]
    severity: Option<String>,
    #[serde(default)]
    certainty: Option<String>,
    #[serde(default)]
    urgency: Option<String>,
    #[serde(default)]
    headline: Option<String>,
    #[serde(default)]
    sender_name: Option<String>,
    /// ISO 8601 with a UTC offset, e.g. `2026-09-05T17:41:00-04:00`.
    #[serde(default)]
    effective: Option<String>,
    #[serde(default)]
    expires: Option<String>,
}

/// Alert geometry is a `Polygon` or a `MultiPolygon`, and is frequently `null`.
///
/// Roughly half of active alerts carry no geometry at all — they are scoped to named forecast
/// zones instead, resolvable only by a further request per zone. Those are counted and reported
/// rather than plotted; see `Parsed::unmapped`.
#[derive(Debug, Deserialize)]
struct AlertGeometry {
    /// Left as raw JSON because the nesting depth differs between Polygon and MultiPolygon,
    /// and `representative_point` walks it generically rather than needing two typed shapes.
    #[serde(default)]
    coordinates: serde_json::Value,
}

/// What one fetch produced.
pub struct Parsed {
    pub markers: Vec<MapMarker>,
    /// Alerts that were active but had no coordinates to place them at. Reported so the layer
    /// can say "12 more not mapped" instead of quietly showing fewer alerts than exist.
    pub unmapped: i64,
}

pub struct NwsProvider {
    client: reqwest::Client,
}

impl NwsProvider {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    pub async fn active_alerts(&self) -> AppResult<Parsed> {
        let body: AlertCollection = http::get_json(&self.client, NWS_ID, FEED, None).await?;
        Ok(to_markers(body))
    }
}

fn to_markers(body: AlertCollection) -> Parsed {
    let mut markers = Vec::new();
    let mut unmapped = 0_i64;

    for feature in body.features {
        let Some(properties) = feature.properties else {
            continue;
        };

        let point = feature
            .geometry
            .as_ref()
            .and_then(|geometry| representative_point(&geometry.coordinates));

        let Some((lat, lon)) = point else {
            unmapped += 1;
            continue;
        };

        let event = properties
            .event
            .clone()
            .unwrap_or_else(|| "Weather alert".to_string());
        let area = properties
            .area_desc
            .clone()
            .unwrap_or_else(|| "Area not given".to_string());

        let mut facts = vec![MarkerFact::new("Event", event.clone())];
        facts.push(MarkerFact::new("Areas", area.clone()));
        if let Some(severity) = properties.severity.as_deref() {
            facts.push(MarkerFact::new("Severity", severity.to_string()));
        }
        if let Some(urgency) = properties.urgency.as_deref() {
            facts.push(MarkerFact::new("Urgency", urgency.to_string()));
        }
        if let Some(certainty) = properties.certainty.as_deref() {
            facts.push(MarkerFact::new("Certainty", certainty.to_string()));
        }
        if let Some(expires) = properties.expires.as_deref() {
            facts.push(MarkerFact::new("Expires", expires.to_string()));
        }
        if let Some(sender) = properties.sender_name.as_deref() {
            facts.push(MarkerFact::new("Issued by", sender.to_string()));
        }

        let id = feature
            .id
            .clone()
            .unwrap_or_else(|| format!("{lat:.3},{lon:.3},{event}"));

        markers.push(MapMarker {
            id: format!("weather:{id}"),
            layer: SentryLayer::Weather,
            lat,
            lon,
            label: event.clone(),
            // The headline is the service's own one-line summary and reads better than
            // anything assembled here; the area list is the fallback.
            summary: properties.headline.clone().unwrap_or(area),
            severity: severity_for(properties.severity.as_deref()),
            scale: None,
            observed_at: properties.effective.as_deref().and_then(parse_iso8601),
            facts,
            // Deliberately no link. The per-alert URL is a JSON document, not a page a reader
            // would want opened in their browser.
            source_url: None,
        });
    }

    Parsed { markers, unmapped }
}

/// A point standing in for an alert area.
///
/// The mean of the polygon's vertices, not a true centroid — and named `representative_point`
/// rather than `centroid` because the difference is real and the honest name is the one that
/// does not overclaim. At the zoom a world map is drawn at, an alert area is a few pixels
/// across, so the distinction is invisible; calling it a centroid would still be wrong.
///
/// Walks the nesting generically so `Polygon` (`[[[lon, lat], …]]`) and `MultiPolygon`
/// (one level deeper) both work without two typed shapes.
fn representative_point(coordinates: &serde_json::Value) -> Option<(f64, f64)> {
    let mut lat_total = 0.0;
    let mut lon_total = 0.0;
    let mut count = 0_u32;

    collect_positions(coordinates, &mut |lon, lat| {
        lon_total += lon;
        lat_total += lat;
        count += 1;
    });

    if count == 0 {
        return None;
    }

    let lat = lat_total / f64::from(count);
    let lon = lon_total / f64::from(count);

    // A NaN here would poison every distance calculation downstream, and an out-of-range
    // latitude means the source nested its arrays differently than assumed.
    if !lat.is_finite() || !lon.is_finite() || !(-90.0..=90.0).contains(&lat) {
        return None;
    }
    Some((lat, lon))
}

/// Finds every `[lon, lat]` pair at any depth, counting a closed ring's shared vertex once.
///
/// A position is the innermost array of numbers, so recursing until that shape is found is
/// what makes one function serve both geometry types.
///
/// The closing vertex is the subtlety. A GeoJSON linear ring repeats its first position as its
/// last (RFC 7946 §3.1.6), so a naive mean counts that corner twice and pulls the result
/// toward it — for a rectangle over Georgia, 0.02° north and 0.02° west of where it belongs.
/// Small, but it is a bias rather than noise: it always drags the point toward the same
/// corner, and it feeds a distance calculation. Rings are detected by their children being
/// positions, and the duplicate is dropped.
fn collect_positions(value: &serde_json::Value, visit: &mut impl FnMut(f64, f64)) {
    let Some(array) = value.as_array() else {
        return;
    };

    if let Some((lon, lat)) = as_position(value) {
        visit(lon, lat);
        return;
    }

    // A ring is an array whose every element is a position.
    let is_ring = !array.is_empty() && array.iter().all(|entry| as_position(entry).is_some());
    if is_ring {
        let closed = array.len() >= 2 && array.first() == array.last();
        let vertices = if closed {
            &array[..array.len() - 1]
        } else {
            &array[..]
        };
        for entry in vertices {
            if let Some((lon, lat)) = as_position(entry) {
                visit(lon, lat);
            }
        }
        return;
    }

    for entry in array {
        collect_positions(entry, visit);
    }
}

/// `[lon, lat, …]` — at least two numbers, longitude first.
fn as_position(value: &serde_json::Value) -> Option<(f64, f64)> {
    let array = value.as_array()?;
    let lon = array.first()?.as_f64()?;
    let lat = array.get(1)?.as_f64()?;
    Some((lon, lat))
}

/// NWS publishes with an offset, e.g. `2026-09-05T17:41:00-04:00`.
fn parse_iso8601(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp())
}

/// Maps the CAP severity vocabulary onto the three levels the map draws.
fn severity_for(severity: Option<&str>) -> MarkerSeverity {
    match severity {
        Some("Extreme") | Some("Severe") => MarkerSeverity::Severe,
        Some("Moderate") => MarkerSeverity::Notable,
        _ => MarkerSeverity::Info,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed from a real response captured on 2026-09-05.
    const SAMPLE: &str = r#"{
      "type": "FeatureCollection",
      "features": [
        {
          "id": "urn:oid:2.49.0.1.840.0.9bfc97c4.001.1",
          "properties": {
            "event": "Severe Thunderstorm Warning",
            "areaDesc": "Greene, GA; Oglethorpe, GA",
            "sent": "2026-09-05T17:41:00-04:00",
            "effective": "2026-09-05T17:41:00-04:00",
            "expires": "2026-09-05T18:15:00-04:00",
            "status": "Actual", "messageType": "Alert",
            "severity": "Severe", "certainty": "Observed", "urgency": "Immediate",
            "headline": "Severe Thunderstorm Warning issued September 5 at 5:41PM EDT",
            "senderName": "NWS Peachtree City GA"
          },
          "geometry": {
            "type": "Polygon",
            "coordinates": [[[-83.2, 33.4], [-83.0, 33.4], [-83.0, 33.6], [-83.2, 33.6], [-83.2, 33.4]]]
          }
        },
        {
          "id": "urn:oid:2.49.0.1.840.0.zone-only.001.1",
          "properties": {
            "event": "Extreme Heat Warning", "areaDesc": "Maricopa, AZ",
            "severity": "Extreme", "urgency": "Expected",
            "effective": "2026-09-05T04:00:00-07:00"
          },
          "geometry": null
        }
      ]
    }"#;

    fn parse(json: &str) -> Parsed {
        to_markers(serde_json::from_str(json).unwrap())
    }

    #[test]
    fn reads_the_published_alert_shape() {
        let parsed = parse(SAMPLE);
        assert_eq!(parsed.markers.len(), 1);

        let marker = &parsed.markers[0];
        assert_eq!(marker.label, "Severe Thunderstorm Warning");
        assert_eq!(marker.severity, MarkerSeverity::Severe);
        assert!(marker
            .summary
            .starts_with("Severe Thunderstorm Warning issued"));
    }

    /// About half of active alerts are scoped to forecast zones and carry no geometry. They
    /// are counted rather than dropped silently, so the layer can say how many are missing.
    #[test]
    fn an_alert_with_no_geometry_is_counted_not_silently_dropped() {
        let parsed = parse(SAMPLE);
        assert_eq!(parsed.unmapped, 1);
    }

    #[test]
    fn the_representative_point_falls_inside_the_polygon() {
        let marker = &parse(SAMPLE).markers[0];
        assert!((marker.lat - 33.5).abs() < 1e-9, "lat was {}", marker.lat);
        assert!((marker.lon - -83.1).abs() < 1e-9, "lon was {}", marker.lon);
    }

    /// RFC 7946 rings repeat their first vertex as their last. Counting it twice biases the
    /// point toward that one corner every time, which then feeds the chokepoint distances.
    #[test]
    fn a_closed_rings_repeated_vertex_is_counted_once() {
        // A unit square whose first corner is repeated to close the ring. The honest centre
        // is (0.5, 0.5); counting the corner twice gives (0.4, 0.4).
        let ring =
            serde_json::json!([[[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.0, 0.0]]]);
        let (lat, lon) = representative_point(&ring).unwrap();
        assert!((lat - 0.5).abs() < 1e-9, "lat was {lat}");
        assert!((lon - 0.5).abs() < 1e-9, "lon was {lon}");
    }

    /// An unclosed ring keeps every vertex — the de-duplication must be conditional, not a
    /// blanket "always drop the last one".
    #[test]
    fn an_unclosed_ring_keeps_all_of_its_vertices() {
        let ring = serde_json::json!([[[0.0, 0.0], [2.0, 0.0], [1.0, 3.0]]]);
        let (lat, lon) = representative_point(&ring).unwrap();
        assert!((lat - 1.0).abs() < 1e-9, "lat was {lat}");
        assert!((lon - 1.0).abs() < 1e-9, "lon was {lon}");
    }

    /// The same walker has to handle the deeper nesting of a MultiPolygon without a second
    /// typed shape, or half the alerts would land at the wrong depth and be discarded.
    #[test]
    fn a_multipolygon_is_averaged_at_the_right_depth() {
        let multi: serde_json::Value = serde_json::from_str(
            r#"[[[[-10.0, 20.0], [-10.0, 22.0]]], [[[-12.0, 20.0], [-12.0, 22.0]]]]"#,
        )
        .unwrap();
        let (lat, lon) = representative_point(&multi).unwrap();
        assert!((lat - 21.0).abs() < 1e-9);
        assert!((lon - -11.0).abs() < 1e-9);
    }

    #[test]
    fn empty_or_malformed_geometry_yields_no_point() {
        assert_eq!(representative_point(&serde_json::json!([])), None);
        assert_eq!(representative_point(&serde_json::json!(null)), None);
        assert_eq!(representative_point(&serde_json::json!("nonsense")), None);
    }

    /// Nesting the arrays differently upstream would produce a latitude past the pole. That
    /// is a parse failure, not a new place, and it must not reach a distance calculation.
    #[test]
    fn an_out_of_range_latitude_is_rejected() {
        let bad = serde_json::json!([[[10.0, 120.0], [10.0, 130.0]]]);
        assert_eq!(representative_point(&bad), None);
    }

    #[test]
    fn the_cap_severity_vocabulary_maps_to_three_levels() {
        assert_eq!(severity_for(Some("Extreme")), MarkerSeverity::Severe);
        assert_eq!(severity_for(Some("Severe")), MarkerSeverity::Severe);
        assert_eq!(severity_for(Some("Moderate")), MarkerSeverity::Notable);
        assert_eq!(severity_for(Some("Minor")), MarkerSeverity::Info);
        assert_eq!(severity_for(Some("Unknown")), MarkerSeverity::Info);
        assert_eq!(severity_for(None), MarkerSeverity::Info);
    }

    #[test]
    fn offset_timestamps_are_normalised_to_utc_seconds() {
        // 17:41 at UTC-4 is 21:41 UTC.
        let parsed = parse_iso8601("2026-09-05T17:41:00-04:00").unwrap();
        let utc = chrono::DateTime::from_timestamp(parsed, 0).unwrap();
        assert_eq!(
            utc.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            "2026-09-05T21:41:00Z"
        );
    }

    #[test]
    fn an_unparseable_timestamp_does_not_lose_the_alert() {
        let json = r#"{"features":[{"id":"x","properties":{"event":"Flood Warning",
                       "severity":"Severe","effective":"not a date"},
                       "geometry":{"coordinates":[[[1.0,2.0],[1.0,3.0]]]}}]}"#;
        let parsed = parse(json);
        assert_eq!(parsed.markers.len(), 1);
        assert_eq!(parsed.markers[0].observed_at, None);
    }

    #[test]
    fn an_empty_feed_is_not_an_error() {
        let parsed = parse(r#"{"features":[]}"#);
        assert!(parsed.markers.is_empty());
        assert_eq!(parsed.unmapped, 0);
    }

    #[test]
    fn marker_ids_are_namespaced_so_two_layers_cannot_collide() {
        assert!(parse(SAMPLE)
            .markers
            .iter()
            .all(|m| m.id.starts_with("weather:")));
    }

    /// Every filter in the query string is load-bearing, and dropping one is a silent
    /// regression: without `status=actual` a scheduled NWS test broadcast renders as a live
    /// warning, and without `message_type=alert` every update duplicates a marker.
    #[test]
    fn the_feed_url_keeps_the_filters_that_make_it_correct() {
        assert!(FEED.contains("status=actual"));
        assert!(FEED.contains("message_type=alert"));
        assert!(FEED.contains("severity=Extreme,Severe"));
        assert!(FEED.starts_with("https://"));
        assert!(
            !FEED.contains(' '),
            "the line continuation leaked whitespace into the URL"
        );
    }
}
