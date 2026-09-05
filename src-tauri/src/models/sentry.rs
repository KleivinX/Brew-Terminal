//! Sentry — the domain types for the global trade and macro monitor.
//!
//! Sentry watches the physical and economic conditions that move goods, not the goods
//! themselves: where the ground shook, where the weather is closing a port, what a country's
//! inflation and debt look like, what the currencies did today.
//!
//! Two rules shape every type here.
//!
//! **Every figure carries its own vintage.** Not the screen's, not the layer's. The World Bank
//! returns 2025 inflation for Germany and 2024 for the United States in the same response, and
//! a scorecard that prints both under one "as of" heading is lying about one of them. So
//! `CountryIndicator` has its own `year`, and `EconomyScore` has no single date at all.
//!
//! **Proximity is a fact; consequence is not.** `Proximity` says a magnitude 6.1 earthquake was
//! 140 km from a named port. It does not say the port is closed, that shipping will be
//! disrupted, or what to trade. Ranking hazards by distance is arithmetic. Ranking them by
//! predicted economic damage is a model, and this app reports published figures rather than
//! running models over them — see ADR-022 and ADR-035.

use serde::{Deserialize, Serialize};

use super::EnvelopeMeta;

/// The map layers Sentry can draw.
///
/// A closed enum rather than strings because the frontend switches on it for symbol shape,
/// and a typo would produce an invisible marker rather than a compile error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum SentryLayer {
    /// Earthquakes worldwide. USGS, keyless.
    Seismic,
    /// Severe weather. NWS, keyless, **United States only** — the layer says so on screen.
    Weather,
    /// Country-level macro indicators. World Bank, keyless.
    Economy,
    /// Reference exchange rates. Frankfurter over central bank publications, keyless.
    Rates,
    /// Straits, canals and container ports. Shipped reference geography, not a feed.
    Chokepoints,
    /// Freight aircraft in the air. OpenSky, and only with the user's own credentials —
    /// see `providers::live::opensky` for why this one cannot ship enabled.
    Flights,
}

impl SentryLayer {
    /// The stable string the frontend and the preference store use.
    pub fn id(self) -> &'static str {
        match self {
            Self::Seismic => "seismic",
            Self::Weather => "weather",
            Self::Economy => "economy",
            Self::Rates => "rates",
            Self::Chokepoints => "chokepoints",
            Self::Flights => "flights",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "seismic" => Self::Seismic,
            "weather" => Self::Weather,
            "economy" => Self::Economy,
            "rates" => Self::Rates,
            "chokepoints" => Self::Chokepoints,
            "flights" => Self::Flights,
            _ => return None,
        })
    }

    /// Every layer, in the order the sidebar draws them.
    pub const ALL: &'static [Self] = &[
        Self::Chokepoints,
        Self::Seismic,
        Self::Weather,
        Self::Economy,
        Self::Rates,
        Self::Flights,
    ];
}

/// How loudly a marker should present.
///
/// Three levels, not five: the map has to stay readable at a glance, and a scale finer than
/// this would be inventing precision the sources do not carry. Rendered with a shape, a glyph
/// and a text label as well as a colour — never colour alone. See UI_MAP.md §6.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum MarkerSeverity {
    /// Reference geography and routine observations.
    Info,
    /// Worth looking at.
    Notable,
    /// The source itself called this severe or extreme.
    Severe,
}

/// One thing drawn on the globe.
///
/// Deliberately flat and provider-agnostic: an earthquake, a storm warning, a container port
/// and a freighter all arrive here in the same shape, so the renderer has one code path and
/// the inspector has one card. What differs between them is `layer`, the symbol it picks, and
/// the free-form `facts` the HUD lists.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct MapMarker {
    /// Unique within a snapshot. Prefixed by layer so two providers cannot collide.
    pub id: String,
    pub layer: SentryLayer,
    /// WGS-84 degrees. Latitude first here, unlike GeoJSON, because every consumer in this
    /// codebase reads it in that order and the flip is the classic way to put Paris in the
    /// Indian Ocean.
    pub lat: f64,
    pub lon: f64,
    /// Short enough to sit next to the symbol.
    pub label: String,
    /// One line, for the marker's tooltip and the inspector's subtitle.
    pub summary: String,
    pub severity: MarkerSeverity,
    /// Drives symbol size where the source has a scale — earthquake magnitude, for instance.
    /// `None` means "draw it at the base size", not zero.
    pub scale: Option<f64>,
    /// When the observation was made, epoch seconds. `None` for reference geography, which
    /// has no observation time and must not be shown as freshly measured.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub observed_at: Option<i64>,
    /// The inspector's body: ordered label/value pairs, already formatted for display.
    ///
    /// Free-form rather than typed per layer because the HUD renders whatever the source
    /// actually gave — a flight has a heading and an altitude, a quake has a depth, and a
    /// union type covering all of them would be a large enum whose only consumer prints it.
    pub facts: Vec<MarkerFact>,
    /// Where the reader can go to check this themselves, when the source publishes a page
    /// for it. Opened in the system browser, never in the webview.
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct MarkerFact {
    pub label: String,
    pub value: String,
}

impl MarkerFact {
    pub fn new(label: &str, value: impl Into<String>) -> Self {
        Self {
            label: label.to_string(),
            value: value.into(),
        }
    }
}

/// A strait, canal or container port.
///
/// Shipped as a constant rather than fetched. The geography of the Strait of Hormuz does not
/// change on a polling interval, and turning a stable published fact into a network dependency
/// would mean the map is empty when the network is down. The volumes are quoted with their
/// year and source in `services::sentry::geography`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct Chokepoint {
    pub id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub kind: ChokepointKind,
    /// What passes through, in the publisher's own units — "20.9 million barrels per day".
    ///
    /// A string because the units differ by site and by source, and an `Option` because this
    /// project only states a figure it has actually checked. Several major ports here have no
    /// throughput published under terms this app can quote, and they render with their role
    /// and no number rather than with a plausible-looking one. Same rule as everywhere else:
    /// no figure without a source.
    pub throughput: Option<String>,
    /// Who published the figure, and for what period. Always present when `throughput` is.
    pub source: Option<String>,
    /// Why this place matters, in a sentence.
    pub note: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum ChokepointKind {
    /// A natural narrow — Hormuz, Malacca, Bab el-Mandeb.
    Strait,
    /// A cut canal — Suez, Panama.
    Canal,
    /// A container or bulk port.
    Port,
}

/// A country's macro picture, one indicator per row.
///
/// There is deliberately no composite score. A single "instability index" would be this app
/// inventing a number and presenting it with the same authority as the published ones it is
/// derived from, which is exactly what ADR-022 rules out. The scorecard shows the indicators
/// side by side and lets the reader do the comparing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct EconomyScore {
    /// ISO 3166-1 alpha-2, matching what the World Bank returns.
    pub country_code: String,
    pub country_name: String,
    pub lat: f64,
    pub lon: f64,
    pub indicators: Vec<CountryIndicator>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct CountryIndicator {
    /// The World Bank series code, e.g. `FP.CPI.TOTL.ZG`.
    pub code: String,
    /// Short enough for a scorecard row.
    pub label: String,
    pub value: f64,
    pub unit: String,
    /// The observation year — **per indicator**, because the World Bank's most recent
    /// non-empty value is a different year for different countries in the same response.
    #[cfg_attr(test, ts(type = "number"))]
    pub year: i64,
}

/// One reference exchange rate for the bottom ticker.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct RateQuote {
    pub base: String,
    pub quote: String,
    pub rate: f64,
    /// The publication date, `YYYY-MM-DD`. Central banks publish once a working day, so this
    /// is frequently yesterday and the ticker says so rather than implying a live cross.
    pub date: String,
    /// Change against the previous published rate, in percent. `None` on the first fetch of a
    /// session, when there is no earlier rate to compare against — rendered as a dash, never
    /// as zero, because "unchanged" and "unknown" are different claims.
    pub change_pct: Option<f64>,
}

/// A hazard near a chokepoint.
///
/// The output of the only thing in Sentry that combines two sources. It states a distance and
/// nothing more: which hazard, which place, how far apart. Whether that matters is the
/// reader's call, and the copy on screen says so.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct Proximity {
    /// The `MapMarker.id` of the hazard, so clicking the row selects it on the map.
    pub marker_id: String,
    pub hazard_label: String,
    pub hazard_layer: SentryLayer,
    pub chokepoint_id: String,
    pub chokepoint_name: String,
    /// Great-circle distance in kilometres, rounded to whole kilometres. Sub-kilometre
    /// precision would be false: the hazard is a point standing in for an area.
    pub distance_km: f64,
    pub severity: MarkerSeverity,
    #[cfg_attr(test, ts(type = "number | null"))]
    pub observed_at: Option<i64>,
}

/// What one layer did on this refresh.
///
/// Carries `EnvelopeMeta` rather than inventing a parallel provenance shape, so a layer's
/// provider, age, staleness and degraded reason are the same type the rest of the app already
/// renders. `meta` is `None` only when the layer is off and was never fetched — a layer that
/// was fetched and failed has a meta with a `degraded` reason, because "we tried and it did
/// not work" is information the reader needs and blankness is not.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct LayerStatus {
    pub layer: SentryLayer,
    pub label: String,
    /// One line on what the layer shows and where it comes from.
    pub description: String,
    /// The provider this layer's toggle switches, or `None` for the shipped geography, which
    /// has no source to switch.
    ///
    /// Returned rather than hard-coded in the frontend: a layer-to-provider map written on
    /// both sides is a map that eventually disagrees with itself, and the failure would be a
    /// toggle that silently controls the wrong source.
    pub provider_id: Option<String>,
    pub enabled: bool,
    /// True when the layer needs a credential the user has not supplied. The sidebar shows a
    /// "needs a key" affordance rather than an empty toggle that silently does nothing.
    pub needs_credential: bool,
    /// Set where a layer's coverage is narrower than the map it draws on — "United States
    /// only" for the weather layer. Shown next to the toggle, not buried in a tooltip.
    pub coverage_note: Option<String>,
    #[cfg_attr(test, ts(type = "number"))]
    pub count: i64,
    /// Typed by reference to the hand-written `src/types/envelope.ts` rather than generated.
    ///
    /// `EnvelopeMeta` is one of the few shapes this project writes on both sides by hand,
    /// because `Envelope<T>` is generic and ts-rs cannot export it. Deriving `TS` here would
    /// emit a *second* TypeScript definition of the same shape, and nothing would hold the two
    /// in step — precisely the drift the generated-types gate exists to catch. The inline
    /// import keeps one definition and resolves from `src/types/generated/`.
    #[cfg_attr(test, ts(type = "import(\"../envelope\").EnvelopeMeta | null"))]
    pub meta: Option<EnvelopeMeta>,
}

/// One refresh of the whole board.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct SentrySnapshot {
    pub layers: Vec<LayerStatus>,
    pub markers: Vec<MapMarker>,
    pub economies: Vec<EconomyScore>,
    pub rates: Vec<RateQuote>,
    pub proximities: Vec<Proximity>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_layer_round_trips_through_its_id() {
        for layer in SentryLayer::ALL {
            assert_eq!(SentryLayer::parse(layer.id()), Some(*layer));
        }
    }

    #[test]
    fn all_lists_every_variant_exactly_once() {
        // A layer missing from ALL would never get a sidebar row, and nothing else would
        // notice: the enum still compiles and the fetcher still runs.
        let mut ids: Vec<&str> = SentryLayer::ALL.iter().map(|l| l.id()).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "a layer appears twice in ALL");
        assert_eq!(count, 6, "a variant was added without adding it to ALL");
    }

    #[test]
    fn an_unknown_layer_id_is_rejected() {
        assert_eq!(SentryLayer::parse("military"), None);
        assert_eq!(SentryLayer::parse(""), None);
    }
}
