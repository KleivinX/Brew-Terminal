//! Shipped reference geography, and the distance arithmetic over it.
//!
//! Everything in this file is a constant on purpose. The Strait of Hormuz does not move on a
//! polling interval, and turning a stable published fact into a network dependency would mean
//! the map is empty exactly when the network is down — which is when someone is most likely
//! to be looking at it.
//!
//! # Where the numbers come from
//!
//! Oil transit volumes are the EIA's, from *World Oil Transit Chokepoints*, last updated
//! **3 March 2026** and reporting the **first half of 2025**. They are quoted with that period
//! attached rather than as a standing figure, because they move a great deal: Suez and Bab
//! el-Mandeb are both roughly half their 2023 levels after traffic diverted around Africa, and
//! the Cape of Good Hope is up by a third. A map that showed 2023 numbers as current would
//! misrepresent the single largest shift in the data.
//!
//! Container ports carry a throughput figure only where this project has verified one. Most do
//! not, and they render with their role and no number. Inventing a plausible TEU count would
//! be worse than showing none, and it is the kind of thing nobody would ever catch.
//!
//! # Re-checking
//!
//! These are numbers with dates on them, in source code. `docs/PROVIDERS.md` carries them in
//! the release re-review checklist for that reason.

use crate::models::{Chokepoint, ChokepointKind};

/// Mean Earth radius in kilometres (IUGG).
const EARTH_RADIUS_KM: f64 = 6371.0088;

/// A quoted figure and the publisher it came from, which travel together or not at all.
///
/// One `Option` over a pair rather than two `Option`s side by side. It is a small thing, but it
/// makes "a throughput figure with no source" unrepresentable at the only place these are
/// written, rather than something a test has to catch afterwards.
type Figure<'a> = Option<(&'a str, &'a str)>;

fn point(
    id: &str,
    name: &str,
    lat: f64,
    lon: f64,
    kind: ChokepointKind,
    figure: Figure<'_>,
    note: &str,
) -> Chokepoint {
    Chokepoint {
        id: id.to_string(),
        name: name.to_string(),
        lat,
        lon,
        kind,
        throughput: figure.map(|(value, _)| value.to_string()),
        source: figure.map(|(_, source)| source.to_string()),
        note: note.to_string(),
    }
}

/// EIA's attribution line for the transit volumes.
const EIA_SOURCE: &str = "U.S. Energy Information Administration, World Oil Transit Chokepoints \
                          (updated 3 March 2026), first half of 2025";

/// The straits, canals and ports the map anchors on.
pub fn chokepoints() -> Vec<Chokepoint> {
    use ChokepointKind::{Canal, Port, Strait};

    vec![
        // --- Straits and canals, with EIA transit volumes for 1H2025 ---
        point(
            "strait-malacca",
            "Strait of Malacca",
            2.5,
            101.3,
            Strait,
            Some(("23.2 million barrels per day", EIA_SOURCE)),
            "The largest oil chokepoint in the world by volume, and the shortest sea route \
             between the Indian and Pacific oceans.",
        ),
        point(
            "strait-hormuz",
            "Strait of Hormuz",
            26.57,
            56.25,
            Strait,
            Some(("20.9 million barrels per day", EIA_SOURCE)),
            "The only sea route out of the Persian Gulf. Roughly a fifth of world petroleum \
             liquids consumption passes through it.",
        ),
        point(
            "cape-good-hope",
            "Cape of Good Hope",
            -34.36,
            18.47,
            Strait,
            Some(("9.1 million barrels per day", EIA_SOURCE)),
            "Not a narrow, but a route: the long way round Africa, and the diversion traffic \
             takes when the Red Sea is avoided.",
        ),
        point(
            "suez-canal",
            "Suez Canal and SUMED",
            30.02,
            32.35,
            Canal,
            Some(("4.9 million barrels per day", EIA_SOURCE)),
            "The short route between Europe and Asia. Volumes are roughly half their 2023 \
             level after traffic diverted around Africa.",
        ),
        point(
            "danish-straits",
            "Danish Straits",
            55.70,
            12.70,
            Strait,
            Some(("4.9 million barrels per day", EIA_SOURCE)),
            "The way out of the Baltic, and the route most Russian seaborne crude takes to \
             reach world markets.",
        ),
        point(
            "bab-el-mandeb",
            "Bab el-Mandeb",
            12.58,
            43.33,
            Strait,
            Some(("4.2 million barrels per day", EIA_SOURCE)),
            "The southern gate of the Red Sea. Traffic here and through Suez rises and falls \
             together.",
        ),
        point(
            "turkish-straits",
            "Turkish Straits",
            41.12,
            29.07,
            Strait,
            Some(("3.7 million barrels per day", EIA_SOURCE)),
            "The Bosphorus and the Dardanelles, connecting the Black Sea to the Mediterranean. \
             Narrow, winding, and running through a city of 15 million.",
        ),
        point(
            "panama-canal",
            "Panama Canal",
            9.08,
            -79.68,
            Canal,
            Some(("2.3 million barrels per day", EIA_SOURCE)),
            "Atlantic to Pacific without rounding South America. Its capacity depends on \
             rainfall, because each transit spends fresh water from a lake.",
        ),
        // --- Container ports. A throughput figure only where one has been verified ---
        point(
            "port-shanghai",
            "Port of Shanghai",
            30.63,
            122.06,
            Port,
            Some((
                "51.5 million TEU (2024)",
                "Lloyd's List One Hundred Container Ports",
            )),
            "The world's busiest container port, and has been for more than a decade.",
        ),
        point(
            "port-singapore",
            "Port of Singapore",
            1.26,
            103.82,
            Port,
            Some((
                "41.1 million TEU (2024)",
                "Lloyd's List One Hundred Container Ports",
            )),
            "The world's largest transhipment hub, at the eastern mouth of the Malacca Strait.",
        ),
        point(
            "port-ningbo",
            "Ningbo-Zhoushan",
            29.87,
            121.98,
            Port,
            None,
            "China's second container port and, by tonnage, the largest cargo port anywhere.",
        ),
        point(
            "port-shenzhen",
            "Port of Shenzhen",
            22.58,
            114.27,
            Port,
            None,
            "The Pearl River Delta's main container gateway, serving southern China's \
             manufacturing belt.",
        ),
        point(
            "port-busan",
            "Port of Busan",
            35.10,
            129.04,
            Port,
            None,
            "North-east Asia's principal transhipment port.",
        ),
        point(
            "port-rotterdam",
            "Port of Rotterdam",
            51.95,
            4.14,
            Port,
            None,
            "Europe's largest port, and the entry point for much of the continent's crude and \
             container traffic.",
        ),
        point(
            "port-antwerp",
            "Antwerp-Bruges",
            51.26,
            4.40,
            Port,
            None,
            "Europe's second container port and its largest chemical cluster.",
        ),
        point(
            "port-jebel-ali",
            "Jebel Ali",
            25.01,
            55.06,
            Port,
            None,
            "The Middle East's largest container port, just outside the Strait of Hormuz.",
        ),
        point(
            "port-la-long-beach",
            "Los Angeles and Long Beach",
            33.74,
            -118.26,
            Port,
            None,
            "The main gateway for trans-Pacific container traffic into North America.",
        ),
        point(
            "port-santos",
            "Port of Santos",
            -23.96,
            -46.30,
            Port,
            None,
            "Latin America's busiest container port, and Brazil's main agricultural export \
             terminal.",
        ),
    ]
}

/// A country the economy layer covers, and where to draw it.
///
/// Coordinates are a representative interior point rather than a true centroid — for several
/// of these the centroid is in the sea or in another country, and a scorecard pin in the wrong
/// country is worse than one a few hundred kilometres off centre.
pub struct CountryPoint {
    pub code: &'static str,
    pub lat: f64,
    pub lon: f64,
}

/// The countries the scorecards cover.
///
/// Selected for weight in world merchandise trade, plus the states that host the chokepoints
/// above. Seventeen keeps one World Bank request under its page limit and keeps the sidebar
/// scannable.
pub const COUNTRIES: &[CountryPoint] = &[
    CountryPoint {
        code: "US",
        lat: 39.0,
        lon: -98.0,
    },
    CountryPoint {
        code: "CN",
        lat: 35.0,
        lon: 105.0,
    },
    CountryPoint {
        code: "DE",
        lat: 51.0,
        lon: 10.0,
    },
    CountryPoint {
        code: "JP",
        lat: 36.0,
        lon: 138.0,
    },
    CountryPoint {
        code: "IN",
        lat: 22.0,
        lon: 79.0,
    },
    CountryPoint {
        code: "GB",
        lat: 53.0,
        lon: -1.5,
    },
    CountryPoint {
        code: "FR",
        lat: 46.5,
        lon: 2.5,
    },
    CountryPoint {
        code: "BR",
        lat: -10.0,
        lon: -52.0,
    },
    CountryPoint {
        code: "KR",
        lat: 36.5,
        lon: 127.8,
    },
    CountryPoint {
        code: "SG",
        lat: 1.35,
        lon: 103.8,
    },
    CountryPoint {
        code: "AE",
        lat: 24.0,
        lon: 54.0,
    },
    CountryPoint {
        code: "NL",
        lat: 52.2,
        lon: 5.5,
    },
    CountryPoint {
        code: "MX",
        lat: 23.5,
        lon: -102.0,
    },
    CountryPoint {
        code: "ZA",
        lat: -29.0,
        lon: 24.5,
    },
    CountryPoint {
        code: "TR",
        lat: 39.0,
        lon: 35.0,
    },
    CountryPoint {
        code: "EG",
        lat: 26.5,
        lon: 30.0,
    },
    CountryPoint {
        code: "PA",
        lat: 8.5,
        lon: -80.0,
    },
];

pub fn country_codes() -> Vec<&'static str> {
    COUNTRIES.iter().map(|c| c.code).collect()
}

pub fn country_point(code: &str) -> Option<&'static CountryPoint> {
    COUNTRIES.iter().find(|c| c.code == code)
}

/// Great-circle distance in kilometres.
///
/// The haversine formula, which is the right one here for a reason worth stating: the naive
/// spherical law of cosines loses precision badly at short distances — the very case that
/// matters most, since a hazard *at* a port is the interesting one. Haversine is well
/// conditioned all the way down to zero.
///
/// A sphere, not an ellipsoid. The error against WGS-84 is a few tenths of a percent, which is
/// far inside the honesty of the inputs: a storm's representative point already stands in for
/// an area hundreds of kilometres across.
pub fn distance_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let phi1 = lat1.to_radians();
    let phi2 = lat2.to_radians();
    let delta_phi = (lat2 - lat1).to_radians();
    let delta_lambda = (lon2 - lon1).to_radians();

    let a = (delta_phi / 2.0).sin().powi(2)
        + phi1.cos() * phi2.cos() * (delta_lambda / 2.0).sin().powi(2);

    // `a` can drift a hair above 1.0 through floating-point error for antipodal points, and
    // `sqrt` of a negative would then produce NaN. Clamping keeps the result a real distance.
    2.0 * EARTH_RADIUS_KM * a.clamp(0.0, 1.0).sqrt().asin()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_coordinates_are_on_the_planet() {
        let mut seen = std::collections::HashSet::new();
        for site in chokepoints() {
            assert!(seen.insert(site.id.clone()), "duplicate id {}", site.id);
            assert!(
                (-90.0..=90.0).contains(&site.lat),
                "{} latitude {}",
                site.name,
                site.lat
            );
            assert!(
                (-180.0..=180.0).contains(&site.lon),
                "{} longitude {}",
                site.name,
                site.lon
            );
            assert!(!site.note.is_empty(), "{} has no note", site.name);
        }
    }

    /// The rule this file exists to keep. A throughput figure without a source is a number
    /// nobody can check, and this project does not render those.
    ///
    /// `Figure` makes this unrepresentable at the construction site, so this now guards the
    /// `Chokepoint` fields themselves — which are two separate `Option`s, because that is the
    /// shape the frontend needs — against anything that builds one without going through
    /// `point`.
    #[test]
    fn every_quoted_figure_names_its_publisher() {
        for site in chokepoints() {
            assert_eq!(
                site.throughput.is_some(),
                site.source.is_some(),
                "{} has a figure and a source that disagree about existing",
                site.name
            );
            if let Some(source) = &site.source {
                assert!(!source.trim().is_empty(), "{}", site.name);
            }
        }
    }

    #[test]
    fn the_oil_figures_carry_the_eia_period_they_describe() {
        // These move sharply year to year — Suez halved between 2023 and 2025 — so a figure
        // quoted without its period is misleading rather than merely imprecise.
        let sites = chokepoints();
        let hormuz = sites.iter().find(|s| s.id == "strait-hormuz").unwrap();
        assert_eq!(
            hormuz.throughput.as_deref(),
            Some("20.9 million barrels per day")
        );
        assert!(hormuz
            .source
            .as_deref()
            .unwrap()
            .contains("first half of 2025"));
    }

    #[test]
    fn both_kinds_of_site_are_present() {
        let sites = chokepoints();
        assert!(sites.iter().any(|s| s.kind == ChokepointKind::Strait));
        assert!(sites.iter().any(|s| s.kind == ChokepointKind::Canal));
        assert!(sites.iter().any(|s| s.kind == ChokepointKind::Port));
    }

    /// Spot-checks against known positions, because a transposed sign puts the Panama Canal
    /// in the Indian Ocean and nothing else in the system would notice.
    #[test]
    fn known_sites_sit_where_they_actually_are() {
        let sites = chokepoints();
        let find = |id: &str| sites.iter().find(|s| s.id == id).unwrap().clone();

        // Panama is west of Greenwich and north of the equator.
        let panama = find("panama-canal");
        assert!(panama.lon < 0.0 && panama.lat > 0.0);

        // The Cape of Good Hope is in the southern hemisphere, east of Greenwich.
        let cape = find("cape-good-hope");
        assert!(cape.lat < 0.0 && cape.lon > 0.0);

        // Santos is south-west of both.
        let santos = find("port-santos");
        assert!(santos.lat < 0.0 && santos.lon < 0.0);
    }

    #[test]
    fn country_codes_are_unique_two_letter_and_placed() {
        let mut seen = std::collections::HashSet::new();
        for country in COUNTRIES {
            assert!(seen.insert(country.code), "duplicate {}", country.code);
            assert_eq!(country.code.len(), 2);
            assert!(country.code.chars().all(|c| c.is_ascii_uppercase()));
            assert!((-90.0..=90.0).contains(&country.lat));
            assert!((-180.0..=180.0).contains(&country.lon));
        }
        assert_eq!(country_codes().len(), COUNTRIES.len());
    }

    #[test]
    fn distance_between_a_point_and_itself_is_zero() {
        // The case the law of cosines handles worst, and the one a hazard sitting on a port
        // produces.
        assert!(distance_km(51.95, 4.14, 51.95, 4.14) < 1e-9);
    }

    #[test]
    fn known_distances_come_out_right() {
        // London to Paris is about 344 km.
        let london_paris = distance_km(51.5074, -0.1278, 48.8566, 2.3522);
        assert!(
            (london_paris - 344.0).abs() < 5.0,
            "expected about 344 km, got {london_paris}"
        );

        // A quarter of the way round the planet, pole to equator, is about 10,008 km.
        let quarter = distance_km(0.0, 0.0, 90.0, 0.0);
        assert!((quarter - 10_007.5).abs() < 2.0, "got {quarter}");
    }

    #[test]
    fn the_antimeridian_is_crossed_the_short_way() {
        // Two degrees apart across the date line is a couple of hundred kilometres, not most
        // of the way round the world. Longitude arithmetic that forgets this is a classic bug.
        let across = distance_km(0.0, 179.0, 0.0, -179.0);
        assert!(across < 250.0, "expected a short hop, got {across} km");
    }

    #[test]
    fn antipodal_points_do_not_produce_a_nan() {
        // `a` can drift just past 1.0 here and `asin` of that is NaN, which would then
        // propagate through every comparison downstream as a silently false result.
        let half_way = distance_km(0.0, 0.0, 0.0, 180.0);
        assert!(half_way.is_finite(), "antipodal distance was {half_way}");
        assert!((half_way - 20_015.0).abs() < 5.0, "got {half_way}");
    }

    #[test]
    fn distance_is_symmetric() {
        let there = distance_km(26.57, 56.25, 25.01, 55.06);
        let back = distance_km(25.01, 55.06, 26.57, 56.25);
        assert!((there - back).abs() < 1e-9);
    }

    /// Jebel Ali sits just inside the Gulf from the Strait of Hormuz — about 190 km. This
    /// pins that the real geography in this file produces sensible real distances, not just
    /// that the formula works on invented inputs.
    #[test]
    fn the_shipped_geography_produces_sensible_distances() {
        let sites = chokepoints();
        let hormuz = sites.iter().find(|s| s.id == "strait-hormuz").unwrap();
        let jebel = sites.iter().find(|s| s.id == "port-jebel-ali").unwrap();

        let km = distance_km(hormuz.lat, hormuz.lon, jebel.lat, jebel.lon);
        assert!(
            (150.0..250.0).contains(&km),
            "expected about 190 km, got {km}"
        );
    }
}
