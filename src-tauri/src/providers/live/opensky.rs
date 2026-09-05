//! OpenSky Network — aircraft state vectors, for the freight flight layer.
//!
//! # Why this one cannot ship enabled
//!
//! Every other source in Sentry is public-domain or openly licensed and runs keyless. OpenSky
//! is neither, and the reason is in its own terms rather than in its pricing. The licence
//! grants use for "non-profit research, non-profit education, commercial internal testing and
//! evaluation, or government purposes", and states that use of the REST API **in any
//! operational capacity — including integration into a live product, service, or automated
//! system — requires a previous written agreement**, explicitly including non-profit and
//! governmental users.
//!
//! A distributed desktop application polling on a timer is an automated system integrated into
//! a live product. Shipping this layer on by default would put every user of Brew Terminal
//! outside those terms without their knowledge, which is exactly the outcome ADR-008 exists to
//! prevent.
//!
//! So the layer ships **off**, needs the user's own OAuth2 client credentials, and the settings
//! copy states the restriction rather than burying it. A user with their own research or
//! institutional arrangement can switch it on; nobody switches it on by accident.
//!
//! # What it actually shows
//!
//! Aircraft **operated by dedicated freight carriers**, identified by the ICAO airline
//! designator at the start of the callsign. That is a claim about the operator, not about the
//! cargo: it does not know what is in the hold, and a passenger airline's belly freight — a
//! large share of world air cargo — is not in this layer at all. `FREIGHT_DESIGNATORS` says so
//! too, in the place someone would go to add one.
//!
//! Endpoint shape, authentication flow and response size verified against live calls on
//! 2026-09-05.

use std::sync::Mutex;

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::models::{MapMarker, MarkerFact, MarkerSeverity, SentryLayer};
use crate::providers::http::{self, AuthHeader};

pub const OPENSKY_ID: &str = "opensky";
pub const OPENSKY_NAME: &str = "OpenSky Network";
pub const OPENSKY_ATTRIBUTION: &str =
    "Flight data from the OpenSky Network. Non-commercial use; operational use requires a \
     written agreement with OpenSky.";
pub const OPENSKY_DOCS: &str = "https://openskynetwork.github.io/opensky-api/rest.html";

const STATES_URL: &str = "https://opensky-network.org/api/states/all";
const TOKEN_URL: &str = "https://auth.opensky-network.org/auth/realms/opensky-network\
                         /protocol/openid-connect/token";

/// Body cap for the state vector response.
///
/// Measured: 1.13 MB for 9,024 aircraft on 2026-09-05, against a 2 MB default. Air traffic is
/// diurnal and the daily peak carries substantially more, so this call gets its own headroom.
/// See `http::get_json_capped`.
const STATES_MAX_BYTES: usize = 4 * 1024 * 1024;

/// Seconds of margin before a token's stated expiry at which it is treated as expired.
///
/// OpenSky issues 30-minute tokens. Refreshing a minute early costs one extra token exchange
/// per half hour and removes the race where a token that was valid when the request was built
/// has expired by the time it arrives.
const TOKEN_SKEW_SECS: i64 = 60;

/// ICAO airline designators for dedicated freight operators.
///
/// **This identifies the operator, not the cargo.** A flight is included because the callsign
/// begins with the designator of an airline whose business is freight — not because anything
/// here knows what it is carrying. Two consequences worth stating plainly:
///
/// - Belly freight on passenger airlines, which carries a large share of world air cargo, is
///   not in this layer at all.
/// - The list is hand-maintained and necessarily incomplete. A missing operator means missing
///   aircraft, never a wrong position for the ones that are shown.
const FREIGHT_DESIGNATORS: &[(&str, &str)] = &[
    ("FDX", "FedEx Express"),
    ("UPS", "UPS Airlines"),
    ("GTI", "Atlas Air"),
    ("PAC", "Polar Air Cargo"),
    ("CLX", "Cargolux"),
    ("CKS", "Kalitta Air"),
    ("ABX", "ABX Air"),
    ("ATN", "Air Transport International"),
    ("GEC", "Lufthansa Cargo"),
    ("BOX", "AeroLogic"),
    ("BCS", "European Air Transport (DHL)"),
    ("DHK", "DHL Air UK"),
    ("NCA", "Nippon Cargo Airlines"),
    ("CAO", "Air China Cargo"),
    ("CKK", "China Cargo Airlines"),
    ("CSS", "SF Airlines"),
    ("SQC", "Singapore Airlines Cargo"),
    ("MPH", "Martinair"),
    ("AZG", "Silk Way West Airlines"),
    ("TAY", "ASL Airlines Ireland"),
    ("SOO", "Southern Air"),
    ("WGN", "Western Global Airlines"),
    ("CJT", "Cargojet"),
    ("ABW", "AirBridgeCargo"),
];

/// Metres per second to kilometres per hour.
const MS_TO_KMH: f64 = 3.6;
/// Metres to feet, for the altitude readout.
const M_TO_FT: f64 = 3.280_84;

#[derive(Debug, Deserialize)]
struct StatesResponse {
    /// Epoch seconds for the whole snapshot; individual vectors carry their own `last_contact`.
    #[serde(default)]
    time: i64,
    /// Null rather than empty when the network has nothing, which is why it is an `Option`.
    #[serde(default)]
    states: Option<Vec<Vec<serde_json::Value>>>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: i64,
}

struct CachedToken {
    value: String,
    expires_at: i64,
}

pub struct OpenSkyProvider {
    client: reqwest::Client,
    /// The bearer token and its expiry. Held across calls because the exchange is a second
    /// round trip, and OpenSky's tokens last half an hour.
    token: Mutex<Option<CachedToken>>,
}

impl OpenSkyProvider {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            token: Mutex::new(None),
        }
    }

    /// Splits the stored credential into client id and secret.
    ///
    /// One keychain entry holds both as `client_id:client_secret`, because the credential
    /// store is keyed by provider and the settings screen offers one field per provider.
    /// Split on the **first** colon: a secret containing one is fine, an id containing one is
    /// not, and the error says which half is wrong rather than failing at the token endpoint
    /// with an opaque 401.
    fn credentials(&self) -> AppResult<(String, String)> {
        let raw = crate::security::secrets::read(OPENSKY_ID).ok_or(AppError::NotConfigured {
            provider_id: OPENSKY_ID.to_string(),
        })?;

        let (id, secret) = raw.trim().split_once(':').ok_or(AppError::Validation {
            field: "apiKey".into(),
            detail: "OpenSky needs both halves, entered as client-id:client-secret".into(),
        })?;

        if id.trim().is_empty() || secret.trim().is_empty() {
            return Err(AppError::Validation {
                field: "apiKey".into(),
                detail: "OpenSky needs both halves, entered as client-id:client-secret".into(),
            });
        }
        Ok((id.trim().to_string(), secret.trim().to_string()))
    }

    /// A valid bearer token, exchanging for a new one only when the cached one is spent.
    async fn bearer(&self, now: i64) -> AppResult<String> {
        if let Some(cached) = self.token.lock().ok().and_then(|guard| {
            guard
                .as_ref()
                .filter(|token| token.expires_at > now)
                .map(|token| token.value.clone())
        }) {
            return Ok(cached);
        }

        let (client_id, client_secret) = self.credentials()?;

        // Client credentials go in the form body, per RFC 6749 §4.4.2 and OpenSky's own
        // documentation. They are never logged: this is the one request in the app that does
        // not go through `http::get_json`, so the redaction that module performs does not
        // apply, and nothing here writes the body anywhere.
        //
        // Encoded with `url`, which is already a direct dependency, rather than by turning on
        // reqwest's `urlencoded` feature for this single call. Hand-concatenating the body
        // would be the actual bug risk: a `+` or `&` in a generated client secret would
        // silently truncate it and the failure would present as a wrong password.
        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("grant_type", "client_credentials")
            .append_pair("client_id", &client_id)
            .append_pair("client_secret", &client_secret)
            .finish();

        let response = self
            .client
            .post(TOKEN_URL)
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body(body)
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() || error.is_connect() {
                    AppError::Network {
                        provider_id: OPENSKY_ID.to_string(),
                    }
                } else {
                    tracing::warn!(provider = OPENSKY_ID, "token exchange failed");
                    AppError::ProviderError {
                        provider_id: OPENSKY_ID.to_string(),
                        status: None,
                    }
                }
            })?;

        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            // Routed to Settings rather than reported as a provider outage: this one the user
            // can actually fix.
            return Err(AppError::NotConfigured {
                provider_id: OPENSKY_ID.to_string(),
            });
        }
        if !status.is_success() {
            return Err(AppError::ProviderError {
                provider_id: OPENSKY_ID.to_string(),
                status: Some(status.as_u16()),
            });
        }

        let token: TokenResponse =
            response
                .json()
                .await
                .map_err(|_| AppError::InvalidResponse {
                    provider_id: OPENSKY_ID.to_string(),
                    detail: "the token response could not be read".into(),
                })?;

        // Treat a missing or absurd lifetime as the documented 30 minutes rather than as
        // "expires immediately", which would exchange a token on every single request.
        let lifetime = if token.expires_in > 0 {
            token.expires_in
        } else {
            1_800
        };

        if let Ok(mut guard) = self.token.lock() {
            *guard = Some(CachedToken {
                value: token.access_token.clone(),
                expires_at: now + lifetime - TOKEN_SKEW_SECS,
            });
        }
        Ok(token.access_token)
    }

    /// Freight aircraft currently in the air.
    pub async fn freight_flights(&self, now: i64) -> AppResult<Vec<MapMarker>> {
        let token = self.bearer(now).await?;

        let body: StatesResponse = http::get_json_capped(
            &self.client,
            OPENSKY_ID,
            STATES_URL,
            Some(AuthHeader {
                name: "Authorization",
                value: format!("Bearer {token}"),
            }),
            STATES_MAX_BYTES,
        )
        .await?;

        Ok(to_markers(body))
    }
}

/// The airline whose designator a callsign starts with, if it is a freight operator.
fn freight_operator(callsign: &str) -> Option<&'static str> {
    let trimmed = callsign.trim();
    if trimmed.len() < 3 {
        return None;
    }
    // Designators are the first three characters and are uppercase in the feed; compared
    // case-insensitively anyway so a lowercase callsign does not silently drop a flight.
    let prefix = &trimmed[..3];
    FREIGHT_DESIGNATORS
        .iter()
        .find(|(code, _)| code.eq_ignore_ascii_case(prefix))
        .map(|(_, name)| *name)
}

/// Reads the positional state vectors and keeps the freight ones.
///
/// The vector is a heterogeneous array addressed by index, which is fragile by nature — so
/// every field is read through a helper that returns `None` rather than panicking, and a
/// vector that is too short is skipped whole.
fn to_markers(body: StatesResponse) -> Vec<MapMarker> {
    let mut out = Vec::new();

    for state in body.states.unwrap_or_default() {
        // Index 16 is the last field of the standard vector. Anything shorter has a shape
        // this adapter was not written against, and guessing at it would misplace aircraft.
        if state.len() < 17 {
            continue;
        }

        let Some(callsign) = state[1].as_str() else {
            continue;
        };
        let Some(operator) = freight_operator(callsign) else {
            continue;
        };

        // Position is nullable in the feed — an aircraft can be tracked without a fix.
        let (Some(lon), Some(lat)) = (state[5].as_f64(), state[6].as_f64()) else {
            continue;
        };
        if !lat.is_finite() || !lon.is_finite() || !(-90.0..=90.0).contains(&lat) {
            continue;
        }

        let icao24 = state[0].as_str().unwrap_or("unknown").to_string();
        let flight = callsign.trim().to_string();
        let on_ground = state[8].as_bool().unwrap_or(false);

        let mut facts = vec![
            MarkerFact::new("Operator", operator),
            MarkerFact::new("Callsign", flight.clone()),
            MarkerFact::new("Registered in", state[2].as_str().unwrap_or("not given")),
        ];

        if let Some(velocity) = state[9].as_f64().filter(|v| v.is_finite()) {
            facts.push(MarkerFact::new(
                "Ground speed",
                format!("{:.0} km/h", velocity * MS_TO_KMH),
            ));
        }
        // Geometric altitude where the aircraft reports it, barometric otherwise — the two
        // differ by a few hundred feet and the label says which is being shown.
        if let Some(altitude) = state[13].as_f64().filter(|v| v.is_finite()) {
            facts.push(MarkerFact::new(
                "Altitude (geometric)",
                format!("{:.0} ft", altitude * M_TO_FT),
            ));
        } else if let Some(altitude) = state[7].as_f64().filter(|v| v.is_finite()) {
            facts.push(MarkerFact::new(
                "Altitude (barometric)",
                format!("{:.0} ft", altitude * M_TO_FT),
            ));
        }
        if let Some(track) = state[10].as_f64().filter(|v| v.is_finite()) {
            facts.push(MarkerFact::new(
                "Heading",
                format!("{track:.0}° from north"),
            ));
        }
        if on_ground {
            facts.push(MarkerFact::new("Status", "On the ground"));
        }

        out.push(MapMarker {
            id: format!("flights:{icao24}"),
            layer: SentryLayer::Flights,
            lat,
            lon,
            label: flight,
            summary: operator.to_string(),
            // Aircraft are reference traffic, not hazards. Nothing about a freighter being
            // where freighters go warrants a warning colour.
            severity: MarkerSeverity::Info,
            scale: None,
            // `last_contact` for this aircraft, not the snapshot time — they differ, and the
            // per-aircraft one is the honest age of this marker.
            observed_at: state[4].as_i64().filter(|t| *t > 0).or(Some(body.time)),
            facts,
            source_url: None,
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shape taken from a live anonymous call on 2026-09-05: seventeen fields, positions
    /// nullable, callsigns space-padded to eight characters.
    const SAMPLE: &str = r#"{
      "time": 1788645070,
      "states": [
        ["a1b2c3","FDX1234 ","United States",1788645070,1788645069,-90.1,35.0,10972.8,false,
         245.72,304.42,0,null,11689.08,"3536",true,0],
        ["801640","AIC2387 ","India",1788645070,1788645070,82.0264,26.266,10972.8,false,
         245.72,304.42,0,null,11689.08,"3536",true,0],
        ["d4e5f6","GEC8801 ","Germany",1788645070,1788645060,8.57,50.03,null,true,
         0.0,null,0,null,null,"1000",false,0]
      ]
    }"#;

    fn parse(json: &str) -> Vec<MapMarker> {
        to_markers(serde_json::from_str(json).unwrap())
    }

    #[test]
    fn keeps_freight_operators_and_drops_passenger_traffic() {
        let markers = parse(SAMPLE);
        assert_eq!(markers.len(), 2, "AIC (Air India) should not be here");
        assert_eq!(markers[0].label, "FDX1234");
        assert_eq!(markers[0].summary, "FedEx Express");
        assert_eq!(markers[1].summary, "Lufthansa Cargo");
    }

    /// Index 5 is longitude and index 6 is latitude — the opposite of the order this
    /// codebase stores them in.
    #[test]
    fn longitude_and_latitude_are_read_from_the_right_indices() {
        let fedex = &parse(SAMPLE)[0];
        assert!((fedex.lat - 35.0).abs() < 1e-9, "lat was {}", fedex.lat);
        assert!((fedex.lon - -90.1).abs() < 1e-9, "lon was {}", fedex.lon);
    }

    #[test]
    fn callsign_padding_is_trimmed_before_matching_and_display() {
        assert_eq!(freight_operator("FDX1234 "), Some("FedEx Express"));
        assert_eq!(parse(SAMPLE)[0].label, "FDX1234");
    }

    #[test]
    fn a_lowercase_callsign_still_matches() {
        assert_eq!(freight_operator("ups2201"), Some("UPS Airlines"));
    }

    #[test]
    fn a_short_or_empty_callsign_matches_nothing() {
        assert_eq!(freight_operator(""), None);
        assert_eq!(freight_operator("FD"), None);
        assert_eq!(freight_operator("   "), None);
    }

    /// An aircraft can be tracked without a position fix. Those must be skipped, not placed
    /// at the origin.
    #[test]
    fn an_aircraft_with_no_position_is_skipped() {
        let json = r#"{"time":1,"states":[
          ["a1","FDX1 ","US",1,1,null,null,1000.0,false,200.0,90.0,0,null,1000.0,"1",false,0]
        ]}"#;
        assert!(parse(json).is_empty());
    }

    /// The vector is addressed by index, so a shorter one has a shape this adapter was not
    /// written against. Reading it anyway would put aircraft in the wrong places.
    #[test]
    fn a_truncated_state_vector_is_skipped_rather_than_misread() {
        let json = r#"{"time":1,"states":[["a1","FDX1 ","US",1,1,10.0,20.0]]}"#;
        assert!(parse(json).is_empty());
    }

    #[test]
    fn a_null_states_array_is_not_an_error() {
        // The network returns null rather than [] when it has nothing.
        assert!(parse(r#"{"time":1,"states":null}"#).is_empty());
        assert!(parse(r#"{"time":1}"#).is_empty());
    }

    #[test]
    fn the_marker_carries_this_aircrafts_contact_time_not_the_snapshot_time() {
        // last_contact is 1788645069 for the FedEx vector while the snapshot is 1788645070.
        assert_eq!(parse(SAMPLE)[0].observed_at, Some(1788645069));
    }

    #[test]
    fn geometric_altitude_is_preferred_and_labelled_as_such() {
        let fedex = &parse(SAMPLE)[0];
        assert!(fedex
            .facts
            .iter()
            .any(|f| f.label == "Altitude (geometric)"));
        assert!(!fedex
            .facts
            .iter()
            .any(|f| f.label == "Altitude (barometric)"));
    }

    #[test]
    fn barometric_altitude_is_used_when_geometric_is_missing_and_says_so() {
        let json = r#"{"time":1,"states":[
          ["a1","UPS9 ","US",1,1,10.0,20.0,3000.0,false,200.0,90.0,0,null,null,"1",false,0]
        ]}"#;
        let facts = &parse(json)[0].facts;
        assert!(facts.iter().any(|f| f.label == "Altitude (barometric)"));
    }

    #[test]
    fn speed_is_converted_from_metres_per_second() {
        // 245.72 m/s is 885 km/h — a plausible cruise. Left in m/s it would read as 246.
        let facts = &parse(SAMPLE)[0].facts;
        let speed = facts.iter().find(|f| f.label == "Ground speed").unwrap();
        assert_eq!(speed.value, "885 km/h");
    }

    #[test]
    fn an_aircraft_on_the_ground_is_marked_as_such() {
        let facts = &parse(SAMPLE)[1].facts;
        assert!(facts.iter().any(|f| f.value == "On the ground"));
    }

    #[test]
    fn flights_are_never_drawn_as_hazards() {
        // A freighter flying a freight route is not an event, and colouring it like one would
        // make the map's severity channel meaningless.
        assert!(parse(SAMPLE)
            .iter()
            .all(|m| m.severity == MarkerSeverity::Info));
    }

    #[test]
    fn designators_are_unique_and_well_formed() {
        let mut seen = std::collections::HashSet::new();
        for (code, name) in FREIGHT_DESIGNATORS {
            assert!(seen.insert(*code), "duplicate designator {code}");
            assert_eq!(code.len(), 3, "{code} is not an ICAO designator");
            assert!(code.chars().all(|c| c.is_ascii_uppercase()), "{code}");
            assert!(!name.is_empty());
        }
    }

    #[test]
    fn marker_ids_are_namespaced_so_two_layers_cannot_collide() {
        assert!(parse(SAMPLE).iter().all(|m| m.id.starts_with("flights:")));
    }

    #[test]
    fn the_token_url_survived_its_line_continuation() {
        assert!(TOKEN_URL.starts_with("https://auth.opensky-network.org/"));
        assert!(TOKEN_URL.ends_with("/protocol/openid-connect/token"));
        assert!(!TOKEN_URL.contains(' '));
    }
}
