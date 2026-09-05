//! USGS earthquake feeds.
//!
//! The one hazard source that is genuinely global, genuinely free, needs no credential, and
//! publishes in a documented machine format. It updates every minute, and the whole magnitude
//! 4.5+ day feed is a few tens of kilobytes — small enough to poll without apology.
//!
//! Data produced by the U.S. Geological Survey is in the public domain (17 U.S.C. §105). The
//! attribution below is courtesy rather than obligation; the app renders it anyway, because
//! the rule here is that no figure appears without its source.
//!
//! Response shape verified against a live call on 2026-09-05.

use serde::Deserialize;

use crate::error::AppResult;
use crate::models::{MapMarker, MarkerFact, MarkerSeverity, SentryLayer};
use crate::providers::http;

pub const USGS_ID: &str = "usgs";
pub const USGS_NAME: &str = "USGS Earthquake Hazards";
pub const USGS_ATTRIBUTION: &str =
    "Earthquake data from the U.S. Geological Survey. USGS output is in the public domain.";
pub const USGS_DOCS: &str = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php";

/// Magnitude 4.5 and above, past 24 hours.
///
/// Chosen over the 2.5+ and "all" feeds on grounds of signal rather than size. The all-day feed
/// runs to several hundred events, nearly all of them too small to be felt, and a world map
/// covered in them shows nothing. 4.5+ is roughly the threshold at which a quake is widely felt
/// and infrastructure is worth checking, and the feed holds a few dozen entries.
const FEED: &str = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";

/// Magnitude at or above which the marker presents as severe.
///
/// 6.0 is where damage to engineered structures becomes usual rather than exceptional. It is a
/// display threshold for symbol weight, not a claim about any particular building.
const SEVERE_MAGNITUDE: f64 = 6.0;
const NOTABLE_MAGNITUDE: f64 = 5.0;

#[derive(Debug, Deserialize)]
struct FeatureCollection {
    #[serde(default)]
    features: Vec<Feature>,
}

#[derive(Debug, Deserialize)]
struct Feature {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    properties: Option<Properties>,
    #[serde(default)]
    geometry: Option<Geometry>,
}

#[derive(Debug, Deserialize)]
struct Properties {
    #[serde(default)]
    mag: Option<f64>,
    #[serde(default)]
    place: Option<String>,
    /// Epoch **milliseconds**, not seconds. Reading it as seconds puts every quake in 1970.
    #[serde(default)]
    time: Option<i64>,
    #[serde(default)]
    tsunami: Option<i64>,
    /// The PAGER alert level — `green`, `yellow`, `orange`, `red` — present only once USGS has
    /// run an impact assessment, which is a minority of events.
    #[serde(default)]
    alert: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

/// GeoJSON position: `[longitude, latitude, depth_km]`. Longitude first, per RFC 7946 §3.1.1.
#[derive(Debug, Deserialize)]
struct Geometry {
    #[serde(default)]
    coordinates: Vec<f64>,
}

pub struct UsgsProvider {
    client: reqwest::Client,
}

impl UsgsProvider {
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    pub async fn recent_quakes(&self) -> AppResult<Vec<MapMarker>> {
        let body: FeatureCollection = http::get_json(&self.client, USGS_ID, FEED, None).await?;
        Ok(to_markers(body))
    }
}

/// Turns the feed into markers, dropping anything unplottable.
///
/// A feature with no coordinates is skipped rather than defaulted to `0, 0` — the Gulf of
/// Guinea is a real place and putting phantom earthquakes there would be worse than showing
/// one fewer.
fn to_markers(body: FeatureCollection) -> Vec<MapMarker> {
    let mut out = Vec::new();

    for feature in body.features {
        let Some(properties) = feature.properties else {
            continue;
        };
        let Some(geometry) = feature.geometry else {
            continue;
        };
        // `[lon, lat]` at minimum; depth is optional and often absent for shallow events.
        let (Some(&lon), Some(&lat)) = (geometry.coordinates.first(), geometry.coordinates.get(1))
        else {
            continue;
        };
        if !lat.is_finite() || !lon.is_finite() || !(-90.0..=90.0).contains(&lat) {
            continue;
        }

        let magnitude = properties.mag.filter(|m| m.is_finite());
        let place = properties
            .place
            .clone()
            .unwrap_or_else(|| "Location not given".to_string());

        let tsunami = properties.tsunami.unwrap_or(0) == 1;
        let severity = severity_for(magnitude, tsunami, properties.alert.as_deref());

        let mut facts = vec![MarkerFact::new(
            "Magnitude",
            magnitude
                .map(|m| format!("{m:.1}"))
                .unwrap_or_else(|| "not reported".to_string()),
        )];

        if let Some(&depth) = geometry.coordinates.get(2) {
            if depth.is_finite() {
                facts.push(MarkerFact::new("Depth", format!("{depth:.0} km")));
            }
        }

        facts.push(MarkerFact::new("Region", place.clone()));

        if let Some(level) = properties.alert.as_deref() {
            // USGS's own impact assessment, passed through in its own words rather than
            // reinterpreted into something this app made up.
            facts.push(MarkerFact::new("USGS PAGER level", level.to_string()));
        }
        if tsunami {
            facts.push(MarkerFact::new(
                "Tsunami",
                "USGS flagged this event for tsunami evaluation",
            ));
        }

        let id = feature
            .id
            .clone()
            .unwrap_or_else(|| format!("{lat:.3},{lon:.3}"));

        out.push(MapMarker {
            id: format!("seismic:{id}"),
            layer: SentryLayer::Seismic,
            lat,
            lon,
            label: magnitude
                .map(|m| format!("M{m:.1}"))
                .unwrap_or_else(|| "Quake".to_string()),
            summary: place,
            severity,
            scale: magnitude,
            // Milliseconds in the feed, seconds everywhere in this codebase.
            observed_at: properties.time.map(|ms| ms / 1000),
            facts,
            source_url: properties.url,
        });
    }

    // Strongest first: on a board where the reader looks at the top of a list, that is the
    // order that puts the largest event where it will be seen.
    out.sort_by(|a, b| {
        b.scale
            .unwrap_or(0.0)
            .partial_cmp(&a.scale.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

fn severity_for(magnitude: Option<f64>, tsunami: bool, alert: Option<&str>) -> MarkerSeverity {
    // The source's own judgement wins where it has made one. An orange or red PAGER level is
    // USGS saying it expects significant casualties or economic loss, which outranks anything
    // inferred from the magnitude alone.
    if tsunami || matches!(alert, Some("orange") | Some("red")) {
        return MarkerSeverity::Severe;
    }
    match magnitude {
        Some(m) if m >= SEVERE_MAGNITUDE => MarkerSeverity::Severe,
        Some(m) if m >= NOTABLE_MAGNITUDE => MarkerSeverity::Notable,
        _ => MarkerSeverity::Info,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed from a real response captured on 2026-09-05.
    const SAMPLE: &str = r#"{
      "type": "FeatureCollection",
      "metadata": { "count": 2 },
      "features": [
        {
          "type": "Feature",
          "id": "us7000tel1",
          "properties": {
            "mag": 4.7, "place": "95 km ESE of Isangel, Vanuatu",
            "time": 1788642361351, "updated": 1788644342040,
            "tsunami": 0, "sig": 340, "alert": null,
            "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000tel1",
            "type": "earthquake"
          },
          "geometry": { "type": "Point", "coordinates": [170.104, -19.914, 10] }
        },
        {
          "type": "Feature",
          "id": "us7000tek7",
          "properties": {
            "mag": 6.4, "place": "80 km SSW of Nikolski, Alaska",
            "time": 1788631209215, "tsunami": 1, "alert": "yellow",
            "url": "https://earthquake.usgs.gov/earthquakes/eventpage/us7000tek7"
          },
          "geometry": { "type": "Point", "coordinates": [-169.3, 52.4, 33.2] }
        }
      ]
    }"#;

    fn parse(json: &str) -> Vec<MapMarker> {
        to_markers(serde_json::from_str(json).unwrap())
    }

    #[test]
    fn reads_the_published_feed_shape() {
        let markers = parse(SAMPLE);
        assert_eq!(markers.len(), 2);

        // Sorted strongest first, so the Alaska 6.4 leads.
        assert_eq!(markers[0].label, "M6.4");
        assert_eq!(markers[1].label, "M4.7");
    }

    /// GeoJSON is `[lon, lat]`. Reading it in the other order is the classic bug and puts
    /// every marker in the wrong hemisphere, so it gets its own test.
    #[test]
    fn coordinates_are_read_longitude_first() {
        let vanuatu = &parse(SAMPLE)[1];
        assert!(
            (vanuatu.lat - -19.914).abs() < 1e-9,
            "latitude came from the wrong index: {}",
            vanuatu.lat
        );
        assert!((vanuatu.lon - 170.104).abs() < 1e-9);
    }

    /// The feed publishes milliseconds; everything else in this app is seconds.
    #[test]
    fn the_timestamp_is_converted_from_milliseconds() {
        let marker = &parse(SAMPLE)[1];
        assert_eq!(marker.observed_at, Some(1788642361));

        // Sanity: seconds put this in 2026, milliseconds would put it in the year 58699.
        let year = chrono::DateTime::from_timestamp(marker.observed_at.unwrap(), 0)
            .unwrap()
            .format("%Y")
            .to_string();
        assert_eq!(year, "2026");
    }

    #[test]
    fn a_tsunami_flag_makes_an_event_severe_whatever_the_magnitude() {
        let json = r#"{"features":[{"id":"x","properties":{"mag":4.1,"tsunami":1,"time":1000},
                       "geometry":{"coordinates":[10.0,20.0]}}]}"#;
        assert_eq!(parse(json)[0].severity, MarkerSeverity::Severe);
    }

    /// USGS running an impact assessment and calling it orange outranks the magnitude scale.
    #[test]
    fn an_orange_pager_level_outranks_a_modest_magnitude() {
        let json = r#"{"features":[{"id":"x","properties":{"mag":5.2,"alert":"orange","time":1000},
                       "geometry":{"coordinates":[10.0,20.0]}}]}"#;
        let marker = &parse(json)[0];
        assert_eq!(marker.severity, MarkerSeverity::Severe);
        assert!(marker
            .facts
            .iter()
            .any(|f| f.label == "USGS PAGER level" && f.value == "orange"));
    }

    #[test]
    fn a_green_pager_level_does_not_promote_a_small_quake() {
        let json = r#"{"features":[{"id":"x","properties":{"mag":4.6,"alert":"green","time":1000},
                       "geometry":{"coordinates":[10.0,20.0]}}]}"#;
        assert_eq!(parse(json)[0].severity, MarkerSeverity::Info);
    }

    #[test]
    fn magnitude_thresholds_map_to_the_three_levels() {
        assert_eq!(severity_for(Some(6.0), false, None), MarkerSeverity::Severe);
        assert_eq!(
            severity_for(Some(5.9), false, None),
            MarkerSeverity::Notable
        );
        assert_eq!(
            severity_for(Some(5.0), false, None),
            MarkerSeverity::Notable
        );
        assert_eq!(severity_for(Some(4.9), false, None), MarkerSeverity::Info);
        assert_eq!(severity_for(None, false, None), MarkerSeverity::Info);
    }

    /// A feature with no usable position is dropped. Defaulting to `0, 0` would put phantom
    /// earthquakes in the Gulf of Guinea, which is a real place.
    #[test]
    fn a_feature_without_coordinates_is_dropped_not_placed_at_null_island() {
        let json = r#"{"features":[
            {"id":"a","properties":{"mag":5.0,"time":1},"geometry":{"coordinates":[]}},
            {"id":"b","properties":{"mag":5.0,"time":1}},
            {"id":"c","properties":{"mag":5.0,"time":1},"geometry":{"coordinates":[1.0,2.0]}}
        ]}"#;
        let markers = parse(json);
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].id, "seismic:c");
    }

    #[test]
    fn an_impossible_latitude_is_rejected() {
        // Latitude beyond the poles means the axes were swapped upstream, not that a quake
        // happened somewhere new.
        let json = r#"{"features":[{"id":"x","properties":{"mag":5.0,"time":1},
                       "geometry":{"coordinates":[10.0,120.0]}}]}"#;
        assert!(parse(json).is_empty());
    }

    #[test]
    fn an_empty_feed_is_not_an_error() {
        // A quiet day is a normal outcome, and an empty map is the correct rendering of it.
        assert!(parse(r#"{"type":"FeatureCollection","features":[]}"#).is_empty());
    }

    #[test]
    fn a_missing_magnitude_still_plots_without_claiming_a_number() {
        let json = r#"{"features":[{"id":"x","properties":{"time":1},
                       "geometry":{"coordinates":[10.0,20.0]}}]}"#;
        let marker = &parse(json)[0];
        assert_eq!(marker.label, "Quake");
        assert_eq!(marker.scale, None);
        assert!(marker
            .facts
            .iter()
            .any(|f| f.label == "Magnitude" && f.value == "not reported"));
    }

    #[test]
    fn marker_ids_are_namespaced_so_two_layers_cannot_collide() {
        assert!(parse(SAMPLE).iter().all(|m| m.id.starts_with("seismic:")));
    }
}
