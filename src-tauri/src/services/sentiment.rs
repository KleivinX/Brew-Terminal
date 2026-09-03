//! The two Fear & Greed indices.
//!
//! ## Why the stock one is computed here and the crypto one is not
//!
//! For crypto there is a published index with a documented API, so the app reports it. For
//! equities the well-known index has no documented API — only an endpoint its own site calls,
//! which ADR-008 rules out — so there is nothing to report. The choice is between not shipping
//! an equity index and computing one from primary sources.
//!
//! Computing one sits close to a line this project draws. `providers::live::fred` says the app
//! "reports published figures rather than running models over them", and a composite sentiment
//! score is a model. What makes this one acceptable is that none of it is hidden: every
//! component ships with its input series, its raw reading, the arithmetic that produced it and
//! whether it was inverted. The reader can recompute the number from the same public data, or
//! throw away the composite and read the four components on their own. A figure you can audit
//! is a teaching instrument; the same figure with its inputs withheld would be an oracle, and
//! this app does not ship oracles.
//!
//! ## The arithmetic
//!
//! Four components, each a daily series of one measured quantity. Each is scored by its
//! **percentile rank within the trailing year** — today's reading is higher than N% of the last
//! 252 sessions — which needs no assumption about how the quantity is distributed and is
//! checkable by counting. Two components measure fear rather than greed and are flipped
//! (`100 - rank`). The composite is their **equal-weighted mean**; any other weighting would be
//! fitted to history, and a fitted weight is exactly the kind of undisclosed judgement this
//! module is trying not to make.
//!
//! ## What is missing, and why
//!
//! The published equity index also uses put/call ratios, net new 52-week highs and a breadth
//! measure. None has a free, documented, daily source that clears ADR-008, so rather than
//! approximate them this index has four components and says so.

use crate::error::{AppError, AppResult};
use crate::models::{
    ChartPoint, Envelope, EnvelopeSource, SentimentBand, SentimentBasis, SentimentComponent,
    SentimentIndex, SentimentMarket, SentimentPoint,
};
use crate::providers::cache::{cache_key, CacheKind};
use crate::providers::live::alternative_me::{AlternativeMeProvider, FNG_ID, FNG_NAME};
use crate::providers::live::fred::FredProvider;
use crate::state::AppState;

/// The computed index is this app's arithmetic over FRED's data, so it gets its own identity.
/// Attributing it to FRED would imply the Federal Reserve publishes a Fear & Greed index.
pub const STOCK_INDEX_ID: &str = "brew-stock-sentiment";
pub const STOCK_INDEX_NAME: &str = "Computed by Brew Terminal from FRED";

/// The trailing window each component is ranked against. 252 sessions ≈ one trading year.
const RANK_WINDOW: usize = 252;
/// Sessions in the momentum average.
const MOMENTUM_MA: usize = 125;
/// Sessions in the volatility average.
const VOLATILITY_MA: usize = 50;
/// Sessions in the stock-versus-bond return comparison.
const RETURN_LOOKBACK: usize = 20;
/// How many past days of the composite to return for the trend line.
const HISTORY_DAYS: usize = 90;
/// Calendar days of source data to request.
///
/// The longest chain is a 125-session average ranked over 252 sessions, plus 90 days of
/// history: ~467 sessions, about 22 calendar months. Three years leaves room for holidays and
/// for a series that publishes with a lag.
const SOURCE_LOOKBACK_DAYS: i64 = 1100;

// ---------------------------------------------------------------------------------------
// Series arithmetic
// ---------------------------------------------------------------------------------------

/// Percentile rank of `value` within `window`, 0–100.
///
/// Mid-rank convention: everything strictly below counts once, ties count half. That keeps a
/// value sitting in the middle of a flat series at 50 rather than at 0 or 100, which the
/// naive "fraction below" definition gets wrong exactly when a market is quiet.
fn percentile_rank(window: &[f64], value: f64) -> f64 {
    if window.is_empty() {
        return 50.0;
    }

    let mut below = 0.0_f64;
    let mut equal = 0.0_f64;
    for entry in window {
        if *entry < value {
            below += 1.0;
        } else if *entry == value {
            equal += 1.0;
        }
    }

    ((below + equal / 2.0) / window.len() as f64) * 100.0
}

/// Trailing simple moving average.
///
/// Output point `i` carries the timestamp of input point `i + period - 1` — the average is
/// stamped at the end of its window, never the middle. A centred average would need data from
/// after the timestamp it is labelled with, which on a live series does not exist.
fn moving_average(series: &[ChartPoint], period: usize) -> Vec<ChartPoint> {
    if period == 0 || series.len() < period {
        return Vec::new();
    }

    let mut out = Vec::with_capacity(series.len() - period + 1);
    let mut sum: f64 = series[..period].iter().map(|p| p.close).sum();
    out.push(ChartPoint {
        time: series[period - 1].time,
        close: sum / period as f64,
    });

    for i in period..series.len() {
        sum += series[i].close - series[i - period].close;
        out.push(ChartPoint {
            time: series[i].time,
            close: sum / period as f64,
        });
    }

    out
}

/// Percentage change over `lookback` observations, in percent.
fn change_over(series: &[ChartPoint], lookback: usize) -> Vec<ChartPoint> {
    if lookback == 0 || series.len() <= lookback {
        return Vec::new();
    }

    series
        .iter()
        .enumerate()
        .skip(lookback)
        .filter_map(|(i, point)| {
            let previous = series[i - lookback].close;
            if previous == 0.0 || !previous.is_finite() {
                return None;
            }
            let change = (point.close / previous - 1.0) * 100.0;
            change.is_finite().then_some(ChartPoint {
                time: point.time,
                close: change,
            })
        })
        .collect()
}

/// Inner join of two daily series on their timestamps, combined by `combine`.
///
/// Joining rather than zipping by position is not defensive coding for its own sake: the
/// Treasury and corporate-bond calendars differ from the equity calendar by a handful of days
/// a year (Good Friday, for one). Lining these up by index would silently compare a Thursday
/// with a Friday for the rest of the series after the first divergence.
fn join_with(
    a: &[ChartPoint],
    b: &[ChartPoint],
    combine: impl Fn(f64, f64) -> f64,
) -> Vec<ChartPoint> {
    let mut out = Vec::new();
    let (mut i, mut j) = (0, 0);

    while i < a.len() && j < b.len() {
        match a[i].time.cmp(&b[j].time) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                let value = combine(a[i].close, b[j].close);
                if value.is_finite() {
                    out.push(ChartPoint {
                        time: a[i].time,
                        close: value,
                    });
                }
                i += 1;
                j += 1;
            }
        }
    }

    out
}

/// Ratio of a series to its own moving average, as a percentage above or below.
fn distance_from_average(series: &[ChartPoint], period: usize) -> Vec<ChartPoint> {
    let average = moving_average(series, period);
    join_with(series, &average, |value, mean| {
        if mean == 0.0 {
            f64::NAN
        } else {
            (value / mean - 1.0) * 100.0
        }
    })
}

// ---------------------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------------------

/// The fixed description of one component. Held next to the series that produces it so the
/// two cannot drift apart.
struct ComponentSpec {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    method: &'static str,
    raw_unit: &'static str,
    /// True where a high raw reading means fear, so the rank is flipped.
    inverted: bool,
    source_series: &'static [&'static str],
}

/// The five FRED series the index reads.
const REQUIRED_SERIES: [&str; 5] = [
    "SP500",
    "VIXCLS",
    "BAMLH0A0HYM2",
    "BAMLC0A0CM",
    "BAMLCC0A0CMTRIV",
];

struct SourceData {
    sp500: Vec<ChartPoint>,
    vix: Vec<ChartPoint>,
    high_yield_spread: Vec<ChartPoint>,
    investment_grade_spread: Vec<ChartPoint>,
    bond_total_return: Vec<ChartPoint>,
}

/// Builds each component's raw daily signal, paired with its description.
fn build_components(source: &SourceData) -> Vec<(ComponentSpec, Vec<ChartPoint>)> {
    vec![
        (
            ComponentSpec {
                id: "momentum",
                name: "Market momentum",
                description: "Where the S&P 500 sits against its own recent average. Well above \
                              it, buyers have been paying up.",
                method: "S&P 500 divided by its 125-session average, then ranked against the \
                         last 252 sessions.",
                raw_unit: "%",
                inverted: false,
                source_series: &["SP500"],
            },
            distance_from_average(&source.sp500, MOMENTUM_MA),
        ),
        (
            ComponentSpec {
                id: "volatility",
                name: "Market volatility",
                description: "How much movement the options market expects, against its own \
                              recent normal. Calm markets are confident ones.",
                method: "VIX divided by its 50-session average, ranked against the last 252 \
                         sessions, then inverted — a high VIX is fear.",
                raw_unit: "%",
                inverted: true,
                source_series: &["VIXCLS"],
            },
            distance_from_average(&source.vix, VOLATILITY_MA),
        ),
        (
            ComponentSpec {
                id: "safe-haven",
                name: "Safe-haven demand",
                description: "Whether money has been going into stocks or into bonds. Bonds \
                              beating stocks is the classic flight to safety.",
                method: "20-session return on the S&P 500 minus the 20-session total return on \
                         investment-grade corporate bonds, ranked against the last 252 sessions.",
                raw_unit: "pp",
                inverted: false,
                source_series: &["SP500", "BAMLCC0A0CMTRIV"],
            },
            join_with(
                &change_over(&source.sp500, RETURN_LOOKBACK),
                &change_over(&source.bond_total_return, RETURN_LOOKBACK),
                |stocks, bonds| stocks - bonds,
            ),
        ),
        (
            ComponentSpec {
                id: "junk-bond-demand",
                name: "Junk bond demand",
                description: "The extra yield demanded to lend to the riskiest companies. When \
                              that premium is thin, lenders are relaxed about risk.",
                method: "High-yield spread minus investment-grade spread, ranked against the \
                         last 252 sessions, then inverted — a wide premium is fear.",
                raw_unit: "pp",
                inverted: true,
                source_series: &["BAMLH0A0HYM2", "BAMLC0A0CM"],
            },
            join_with(
                &source.high_yield_spread,
                &source.investment_grade_spread,
                |high_yield, investment_grade| high_yield - investment_grade,
            ),
        ),
    ]
}

/// Plain-language statement of a raw reading.
///
/// A bare `+4.2%` next to "Market momentum" leaves the reader to work out what is 4.2% of
/// what. Each component says it in a sentence instead.
fn reading_for(id: &str, raw: f64) -> String {
    let magnitude = raw.abs();
    match id {
        "momentum" => {
            if raw >= 0.0 {
                format!("The S&P 500 is {magnitude:.1}% above its 125-session average.")
            } else {
                format!("The S&P 500 is {magnitude:.1}% below its 125-session average.")
            }
        }
        "volatility" => {
            if raw >= 0.0 {
                format!("The VIX is {magnitude:.1}% above its 50-session average.")
            } else {
                format!("The VIX is {magnitude:.1}% below its 50-session average.")
            }
        }
        "safe-haven" => {
            if raw >= 0.0 {
                format!(
                    "Over 20 sessions stocks returned {magnitude:.1} percentage points more \
                     than investment-grade bonds."
                )
            } else {
                format!(
                    "Over 20 sessions bonds returned {magnitude:.1} percentage points more \
                     than stocks."
                )
            }
        }
        "junk-bond-demand" => format!(
            "Riskier borrowers are paying {magnitude:.2} percentage points more than \
             investment-grade ones."
        ),
        _ => format!("{raw:.2}"),
    }
}

/// The four component series, restricted to the dates all four share.
///
/// Ranking every component over the same set of dates is what makes their scores comparable:
/// a percentile taken over a slightly different calendar per component would be four answers
/// to four subtly different questions, averaged together.
struct Aligned {
    times: Vec<i64>,
    /// `values[component][day]`.
    values: Vec<Vec<f64>>,
}

fn align_all(series: &[Vec<ChartPoint>]) -> Aligned {
    let Some((first, rest)) = series.split_first() else {
        return Aligned {
            times: Vec::new(),
            values: Vec::new(),
        };
    };

    let mut times: Vec<i64> = first.iter().map(|p| p.time).collect();
    for other in rest {
        let present: std::collections::HashSet<i64> = other.iter().map(|p| p.time).collect();
        times.retain(|time| present.contains(time));
    }
    times.sort_unstable();

    let values = series
        .iter()
        .map(|points| {
            let lookup: std::collections::HashMap<i64, f64> =
                points.iter().map(|p| (p.time, p.close)).collect();
            times
                .iter()
                .map(|time| lookup.get(time).copied().unwrap_or(f64::NAN))
                .collect()
        })
        .collect();

    Aligned { times, values }
}

/// The composite for one day, from the trailing window ending at `day`.
///
/// The window never reaches past `day`. Ranking a past reading against data that had not
/// happened yet would make the history look sharper than the index ever was in real time —
/// the same look-ahead mistake that flatters a backtest.
fn composite_at(aligned: &Aligned, specs: &[ComponentSpec], day: usize) -> Option<(i32, Vec<i32>)> {
    if day + 1 < RANK_WINDOW {
        return None;
    }
    let start = day + 1 - RANK_WINDOW;

    let mut scores = Vec::with_capacity(specs.len());
    for (index, spec) in specs.iter().enumerate() {
        let column = aligned.values.get(index)?;
        let window = &column[start..=day];
        let value = *column.get(day)?;
        if !value.is_finite() {
            return None;
        }

        let rank = percentile_rank(window, value);
        let score = if spec.inverted { 100.0 - rank } else { rank };
        scores.push(score.round().clamp(0.0, 100.0) as i32);
    }

    if scores.is_empty() {
        return None;
    }

    let mean = scores.iter().sum::<i32>() as f64 / scores.len() as f64;
    Some((mean.round().clamp(0.0, 100.0) as i32, scores))
}

/// Assembles the index from the fetched series.
///
/// Separated from the fetch so every branch below is testable against synthetic series without
/// a network — including the ones that must refuse to produce a number.
fn compute(source: &SourceData) -> AppResult<SentimentIndex> {
    let built = build_components(source);
    let (specs, series): (Vec<ComponentSpec>, Vec<Vec<ChartPoint>>) = built.into_iter().unzip();

    let aligned = align_all(&series);
    if aligned.times.len() < RANK_WINDOW {
        // All-or-nothing on purpose. A composite averaging three components on some days and
        // four on others would change definition without changing its name, and the reader
        // has no way to see that in a single number. Failing here instead lets the caching
        // layer show the last complete reading, marked stale.
        return Err(AppError::InvalidResponse {
            provider_id: STOCK_INDEX_ID.to_string(),
            detail: "not enough overlapping history to rank the components".into(),
        });
    }

    let last = aligned.times.len() - 1;
    let Some((value, scores)) = composite_at(&aligned, &specs, last) else {
        return Err(AppError::InvalidResponse {
            provider_id: STOCK_INDEX_ID.to_string(),
            detail: "the latest reading could not be scored".into(),
        });
    };

    let components = specs
        .iter()
        .enumerate()
        .map(|(index, spec)| {
            let raw = aligned.values[index][last];
            let score = scores[index];
            SentimentComponent {
                id: spec.id.to_string(),
                name: spec.name.to_string(),
                description: spec.description.to_string(),
                score,
                band: SentimentBand::of(score),
                raw_value: raw,
                raw_unit: spec.raw_unit.to_string(),
                reading: reading_for(spec.id, raw),
                source_series: spec.source_series.iter().map(|s| s.to_string()).collect(),
                method: spec.method.to_string(),
                inverted: spec.inverted,
            }
        })
        .collect();

    let history_start = aligned.times.len().saturating_sub(HISTORY_DAYS);
    let history: Vec<SentimentPoint> = (history_start..aligned.times.len())
        .filter_map(|day| {
            composite_at(&aligned, &specs, day).map(|(value, _)| SentimentPoint {
                time: aligned.times[day],
                value,
            })
        })
        .collect();

    Ok(SentimentIndex {
        market: SentimentMarket::Stocks,
        basis: SentimentBasis::Computed,
        value,
        band: SentimentBand::of(value),
        as_of: aligned.times[last],
        publisher_label: None,
        components,
        history,
        methodology: format!(
            "Computed here from {} public Federal Reserve series. Each of the four components \
             is scored by where today's reading falls among the last {RANK_WINDOW} sessions, \
             and the index is their equal-weighted average. Nobody publishes this number — it \
             is this app's arithmetic, and every step of it is shown above.",
            REQUIRED_SERIES.len()
        ),
    })
}

// ---------------------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------------------

fn source_start() -> String {
    (chrono::Utc::now() - chrono::Duration::days(SOURCE_LOOKBACK_DAYS))
        .format("%Y-%m-%d")
        .to_string()
}

async fn fetch_sources(state: &AppState) -> AppResult<SourceData> {
    let provider = FredProvider::new(state.registry.http_client());
    let start = source_start();

    // Concurrent: five sequential CSV fetches of three years each is a visible wait, and this
    // endpoint is an unauthenticated government file server with no published per-client
    // limit. Five in flight is not a burst worth pacing.
    let (sp500, vix, high_yield_spread, investment_grade_spread, bond_total_return) = tokio::join!(
        provider.series(REQUIRED_SERIES[0], &start),
        provider.series(REQUIRED_SERIES[1], &start),
        provider.series(REQUIRED_SERIES[2], &start),
        provider.series(REQUIRED_SERIES[3], &start),
        provider.series(REQUIRED_SERIES[4], &start),
    );

    Ok(SourceData {
        sp500: sp500?,
        vix: vix?,
        high_yield_spread: high_yield_spread?,
        investment_grade_spread: investment_grade_spread?,
        bond_total_return: bond_total_return?,
    })
}

/// The computed equity index.
pub async fn stock_index(state: &AppState) -> AppResult<Envelope<Option<SentimentIndex>>> {
    let key = cache_key(STOCK_INDEX_ID, "fear-greed", &[]);

    super::market::cached_value_or_degraded(
        state,
        CacheKind::Sentiment,
        key,
        STOCK_INDEX_ID,
        STOCK_INDEX_NAME,
        EnvelopeSource::Live,
        || async {
            let source = fetch_sources(state).await?;
            compute(&source)
        },
    )
    .await
}

/// The published crypto index.
pub async fn crypto_index(state: &AppState) -> AppResult<Envelope<Option<SentimentIndex>>> {
    let key = cache_key(FNG_ID, "fear-greed", &[]);
    let provider = AlternativeMeProvider::new(state.registry.http_client());

    super::market::cached_value_or_degraded(
        state,
        CacheKind::Sentiment,
        key,
        FNG_ID,
        FNG_NAME,
        EnvelopeSource::Live,
        || async move { provider.fear_and_greed().await },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn points(values: &[f64]) -> Vec<ChartPoint> {
        values
            .iter()
            .enumerate()
            .map(|(i, value)| ChartPoint {
                time: i as i64 * 86_400,
                close: *value,
            })
            .collect()
    }

    // -- percentile_rank ------------------------------------------------------------------

    #[test]
    fn the_highest_and_lowest_readings_sit_at_the_ends() {
        let window = [1.0, 2.0, 3.0, 4.0];
        assert_eq!(percentile_rank(&window, 5.0), 100.0);
        assert_eq!(percentile_rank(&window, 0.0), 0.0);
    }

    #[test]
    fn a_reading_in_the_middle_scores_near_fifty() {
        let window: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let rank = percentile_rank(&window, 50.0);
        assert!((rank - 50.5).abs() < 0.01, "got {rank}");
    }

    #[test]
    fn a_flat_series_scores_neutral_rather_than_extreme() {
        // The case the naive "fraction strictly below" definition gets wrong: with every
        // reading identical it would return 0, printing "extreme fear" for a quiet market.
        let window = [7.0; 50];
        assert_eq!(percentile_rank(&window, 7.0), 50.0);
    }

    #[test]
    fn ties_are_split_rather_than_counted_whole() {
        let window = [1.0, 2.0, 2.0, 3.0];
        assert_eq!(percentile_rank(&window, 2.0), 50.0);
    }

    #[test]
    fn an_empty_window_is_neutral_not_a_panic() {
        assert_eq!(percentile_rank(&[], 1.0), 50.0);
    }

    // -- moving_average -------------------------------------------------------------------

    #[test]
    fn a_moving_average_is_stamped_at_the_end_of_its_window() {
        let series = points(&[1.0, 2.0, 3.0, 4.0]);
        let average = moving_average(&series, 3);
        assert_eq!(average.len(), 2);
        assert_eq!(average[0].close, 2.0);
        assert_eq!(
            average[0].time, series[2].time,
            "a centred average would need data from after its own timestamp"
        );
        assert_eq!(average[1].close, 3.0);
    }

    #[test]
    fn a_rolling_sum_does_not_drift_over_a_long_series() {
        // The incremental add/subtract is O(n) rather than O(n·period); this checks it agrees
        // with the naive computation, which is the thing that could silently rot.
        let values: Vec<f64> = (0..600).map(|i| (i as f64 * 0.37).sin() * 1000.0).collect();
        let series = points(&values);
        let average = moving_average(&series, 125);

        for (offset, computed) in average.iter().enumerate() {
            let window = &values[offset..offset + 125];
            let expected = window.iter().sum::<f64>() / 125.0;
            assert!(
                (computed.close - expected).abs() < 1e-9,
                "drift at {offset}: {} vs {expected}",
                computed.close
            );
        }
    }

    #[test]
    fn too_short_a_series_yields_no_average_rather_than_a_partial_one() {
        assert!(moving_average(&points(&[1.0, 2.0]), 5).is_empty());
        assert!(moving_average(&points(&[1.0, 2.0]), 0).is_empty());
    }

    // -- change_over ----------------------------------------------------------------------

    #[test]
    fn a_return_is_measured_against_the_reading_n_sessions_back() {
        let series = points(&[100.0, 110.0, 120.0, 132.0]);
        let change = change_over(&series, 2);
        assert_eq!(change.len(), 2);
        assert!((change[0].close - 20.0).abs() < 1e-9);
        assert!((change[1].close - 20.0).abs() < 1e-9);
    }

    #[test]
    fn a_zero_base_is_skipped_rather_than_producing_infinity() {
        let series = points(&[0.0, 5.0, 10.0]);
        let change = change_over(&series, 1);
        assert_eq!(change.len(), 1, "the division by zero must be dropped");
        assert!(change.iter().all(|p| p.close.is_finite()));
    }

    // -- join_with ------------------------------------------------------------------------

    #[test]
    fn series_are_joined_on_dates_not_positions() {
        // The bug this prevents: two daily series that differ by one holiday. Zipping by index
        // compares Thursday with Friday for the whole remainder of the series.
        let a = vec![
            ChartPoint {
                time: 1,
                close: 10.0,
            },
            ChartPoint {
                time: 2,
                close: 20.0,
            },
            ChartPoint {
                time: 3,
                close: 30.0,
            },
        ];
        let b = vec![
            ChartPoint {
                time: 1,
                close: 1.0,
            },
            // No observation on day 2 — a holiday on this calendar only.
            ChartPoint {
                time: 3,
                close: 3.0,
            },
        ];

        let joined = join_with(&a, &b, |x, y| x - y);
        assert_eq!(joined.len(), 2);
        assert_eq!(joined[0].time, 1);
        assert_eq!(joined[0].close, 9.0);
        assert_eq!(joined[1].time, 3);
        assert_eq!(
            joined[1].close, 27.0,
            "day 3 must meet day 3, not day 2's value shifted along"
        );
    }

    #[test]
    fn a_join_with_no_shared_dates_is_empty() {
        let a = vec![ChartPoint {
            time: 1,
            close: 1.0,
        }];
        let b = vec![ChartPoint {
            time: 2,
            close: 2.0,
        }];
        assert!(join_with(&a, &b, |x, y| x + y).is_empty());
    }

    // -- composite ------------------------------------------------------------------------

    /// Series long enough to score, with a shape chosen per component.
    fn source_from(
        sp: impl Fn(usize) -> f64,
        vix: impl Fn(usize) -> f64,
        hy: impl Fn(usize) -> f64,
        ig: impl Fn(usize) -> f64,
        bond: impl Fn(usize) -> f64,
        len: usize,
    ) -> SourceData {
        let build = |f: &dyn Fn(usize) -> f64| -> Vec<ChartPoint> {
            (0..len)
                .map(|i| ChartPoint {
                    time: i as i64 * 86_400,
                    close: f(i),
                })
                .collect()
        };
        SourceData {
            sp500: build(&sp),
            vix: build(&vix),
            high_yield_spread: build(&hy),
            investment_grade_spread: build(&ig),
            bond_total_return: build(&bond),
        }
    }

    /// Long enough for a 125-session average ranked over 252 sessions, plus history.
    const LONG_ENOUGH: usize = 500;

    /// A series that sits flat for most of its history and then moves over the final stretch.
    ///
    /// Shaped this way on purpose. A component is scored against its own trailing year, so a
    /// *steady* trend does not read as extreme — a linearly rising VIX ends up nearer its own
    /// average, in percentage terms, than it was a year earlier, and correctly scores as calm.
    /// What registers as fear or greed is a recent departure from the recent normal, so that
    /// is what these fixtures build.
    fn flat_then(base: f64, daily_move: f64, len: usize) -> Box<dyn Fn(usize) -> f64> {
        let quiet = len - MOVE_DAYS;
        Box::new(move |i| {
            if i < quiet {
                base
            } else {
                base + daily_move * (i - quiet) as f64
            }
        })
    }

    /// Sessions in the closing move of a `flat_then` fixture — about two trading months.
    const MOVE_DAYS: usize = 40;

    #[test]
    fn a_calm_rising_market_reads_as_greed() {
        // Stocks pulling away from their average, volatility collapsing, credit spreads
        // tightening, stocks beating bonds. Every component points the same way.
        let n = LONG_ENOUGH;
        let (sp, vix, hy, ig, bond) = (
            flat_then(100.0, 0.5, n),
            flat_then(20.0, -0.2, n),
            flat_then(4.0, -0.04, n),
            flat_then(1.0, 0.0, n),
            flat_then(100.0, 0.01, n),
        );
        let source = source_from(&*sp, &*vix, &*hy, &*ig, &*bond, n);

        let index = compute(&source).unwrap();
        assert!(
            index.value > 70,
            "expected greed, got {} ({:?})",
            index.value,
            scores_of(&index)
        );
        assert_eq!(index.market, SentimentMarket::Stocks);
        assert_eq!(index.basis, SentimentBasis::Computed);
    }

    #[test]
    fn a_falling_volatile_market_reads_as_fear() {
        // The mirror image: stocks dropping below their average, volatility spiking, credit
        // spreads blowing out, bonds beating stocks.
        let n = LONG_ENOUGH;
        let (sp, vix, hy, ig, bond) = (
            flat_then(100.0, -0.5, n),
            flat_then(20.0, 0.4, n),
            flat_then(4.0, 0.06, n),
            flat_then(1.0, 0.0, n),
            flat_then(100.0, 0.02, n),
        );
        let source = source_from(&*sp, &*vix, &*hy, &*ig, &*bond, n);

        let index = compute(&source).unwrap();
        assert!(
            index.value < 30,
            "expected fear, got {} ({:?})",
            index.value,
            scores_of(&index)
        );
    }

    fn scores_of(index: &SentimentIndex) -> Vec<(String, i32)> {
        index
            .components
            .iter()
            .map(|c| (c.id.clone(), c.score))
            .collect()
    }

    #[test]
    fn the_inverted_components_are_actually_inverted() {
        // A VIX spike and a widening junk premium are both fear. With either sign flipped the
        // composite would still look plausible, which is exactly why this is asserted rather
        // than eyeballed. Both directions are checked: an inversion that fired unconditionally
        // would pass a one-sided test.
        let n = LONG_ENOUGH;
        let flat_sp = flat_then(100.0, 0.0, n);
        let flat_ig = flat_then(1.0, 0.0, n);
        let flat_bond = flat_then(100.0, 0.0, n);

        let frightened = source_from(
            &*flat_sp,
            &*flat_then(20.0, 0.4, n),
            &*flat_then(4.0, 0.06, n),
            &*flat_ig,
            &*flat_bond,
            n,
        );
        let calm = source_from(
            &*flat_sp,
            &*flat_then(20.0, -0.2, n),
            &*flat_then(4.0, -0.04, n),
            &*flat_ig,
            &*flat_bond,
            n,
        );

        let frightened = compute(&frightened).unwrap();
        let calm = compute(&calm).unwrap();

        for (id, label) in [("volatility", "VIX"), ("junk-bond-demand", "junk premium")] {
            let high = component(&frightened, id);
            let low = component(&calm, id);

            assert!(high.inverted, "{id} must be marked inverted for the UI");
            assert!(
                high.raw_value > low.raw_value,
                "fixture error: the frightened {label} should read higher"
            );
            assert!(
                high.score < 25 && low.score > 75,
                "a rising {label} must score as fear and a falling one as greed, got {} and {}",
                high.score,
                low.score
            );
        }
    }

    #[test]
    fn the_uninverted_components_track_their_raw_reading() {
        // The other half of the same check: momentum and safe-haven must move *with* their
        // raw value, so a stray inversion cannot hide in them either.
        let n = LONG_ENOUGH;
        let flat_vix = flat_then(20.0, 0.0, n);
        let flat_hy = flat_then(4.0, 0.0, n);
        let flat_ig = flat_then(1.0, 0.0, n);

        let rising = source_from(
            &*flat_then(100.0, 0.5, n),
            &*flat_vix,
            &*flat_hy,
            &*flat_ig,
            &*flat_then(100.0, 0.0, n),
            n,
        );
        let falling = source_from(
            &*flat_then(100.0, -0.5, n),
            &*flat_vix,
            &*flat_hy,
            &*flat_ig,
            &*flat_then(100.0, 0.0, n),
            n,
        );

        let rising = compute(&rising).unwrap();
        let falling = compute(&falling).unwrap();

        for id in ["momentum", "safe-haven"] {
            let up = component(&rising, id);
            let down = component(&falling, id);

            assert!(!up.inverted, "{id} must not be marked inverted");
            assert!(
                up.score > 75 && down.score < 25,
                "{id} must follow its raw reading, got {} and {}",
                up.score,
                down.score
            );
        }
    }

    fn component<'a>(index: &'a SentimentIndex, id: &str) -> &'a SentimentComponent {
        index
            .components
            .iter()
            .find(|c| c.id == id)
            .unwrap_or_else(|| panic!("no component named {id}"))
    }

    #[test]
    fn a_flat_market_sits_near_the_middle() {
        let source = source_from(
            |_| 100.0,
            |_| 18.0,
            |_| 3.0,
            |_| 1.0,
            |_| 100.0,
            LONG_ENOUGH,
        );
        let index = compute(&source).unwrap();
        assert_eq!(
            index.value, 50,
            "with nothing moving, every component is at its own median"
        );
        assert_eq!(index.band, SentimentBand::Neutral);
    }

    #[test]
    fn every_component_carries_what_is_needed_to_check_it() {
        let source = source_from(
            |i| 100.0 + i as f64,
            |i| 20.0 - (i as f64) * 0.01,
            |_| 3.0,
            |_| 1.0,
            |i| 100.0 + (i as f64) * 0.1,
            LONG_ENOUGH,
        );
        let index = compute(&source).unwrap();

        assert_eq!(index.components.len(), 4);
        for component in &index.components {
            assert!(!component.id.is_empty());
            assert!(!component.name.is_empty());
            assert!(!component.description.is_empty(), "{}", component.id);
            assert!(!component.method.is_empty(), "{}", component.id);
            assert!(!component.reading.is_empty(), "{}", component.id);
            assert!(
                !component.source_series.is_empty(),
                "{} must name its inputs",
                component.id
            );
            assert!(
                component.raw_value.is_finite(),
                "{} raw value must be a number",
                component.id
            );
            assert!((0..=100).contains(&component.score), "{}", component.id);
            // Every named input must be a series the app is actually allowed to request.
            for series in &component.source_series {
                assert!(
                    REQUIRED_SERIES.contains(&series.as_str()),
                    "{} cites {series}, which is not fetched",
                    component.id
                );
            }
        }
    }

    #[test]
    fn the_composite_is_the_mean_of_its_components() {
        // The one claim the methodology text makes about the arithmetic. If weighting were
        // ever introduced without updating that text, this fails.
        let source = source_from(
            |i| 100.0 * 1.0002_f64.powi(i as i32),
            |i| 20.0 + (i as f64 * 0.1).sin(),
            |i| 3.0 + (i as f64 * 0.05).cos() * 0.2,
            |_| 1.0,
            |i| 100.0 + (i as f64) * 0.02,
            LONG_ENOUGH,
        );
        let index = compute(&source).unwrap();

        let sum: i32 = index.components.iter().map(|c| c.score).sum();
        let expected = (sum as f64 / index.components.len() as f64).round() as i32;
        assert_eq!(index.value, expected);
    }

    #[test]
    fn history_is_ordered_and_bounded() {
        let source = source_from(
            |i| 100.0 * 1.0003_f64.powi(i as i32),
            |i| 20.0 + (i as f64 * 0.07).sin() * 3.0,
            |_| 3.0,
            |_| 1.0,
            |i| 100.0 + (i as f64) * 0.01,
            LONG_ENOUGH,
        );
        let index = compute(&source).unwrap();

        assert!(!index.history.is_empty());
        assert!(index.history.len() <= HISTORY_DAYS);
        assert!(
            index.history.windows(2).all(|w| w[0].time < w[1].time),
            "history must run oldest first"
        );
        assert!(index.history.iter().all(|p| (0..=100).contains(&p.value)));
        assert_eq!(
            index.history.last().map(|p| p.value),
            Some(index.value),
            "the newest history point is the current reading"
        );
        assert_eq!(index.history.last().map(|p| p.time), Some(index.as_of));
    }

    #[test]
    fn a_past_reading_is_not_ranked_against_its_own_future() {
        // Look-ahead check. The composite for day D must be identical whether or not the
        // series continues past D — if the ranking window ever reached forward, truncating
        // the input would change the answer.
        let full = source_from(
            |i| 100.0 * 1.0004_f64.powi(i as i32),
            |i| 25.0 - (i as f64) * 0.01,
            |i| 5.0 - (i as f64) * 0.004,
            |_| 1.0,
            |i| 100.0 + (i as f64) * 0.01,
            LONG_ENOUGH,
        );
        let truncated = source_from(
            |i| 100.0 * 1.0004_f64.powi(i as i32),
            |i| 25.0 - (i as f64) * 0.01,
            |i| 5.0 - (i as f64) * 0.004,
            |_| 1.0,
            |i| 100.0 + (i as f64) * 0.01,
            LONG_ENOUGH - 40,
        );

        let long = compute(&full).unwrap();
        let short = compute(&truncated).unwrap();

        let cutoff = short.as_of;
        let from_long = long.history.iter().find(|p| p.time == cutoff);
        let from_short = short.history.iter().find(|p| p.time == cutoff);

        assert!(from_long.is_some() && from_short.is_some());
        assert_eq!(
            from_long.map(|p| p.value),
            from_short.map(|p| p.value),
            "a day's reading changed when later data was added — the window looks forward"
        );
    }

    #[test]
    fn too_little_history_is_refused_rather_than_ranked_against_a_short_window() {
        // 100 sessions cannot support a 252-session rank. Producing a number anyway would
        // mean the index quietly means something different on its first run.
        let source = source_from(|_| 100.0, |_| 18.0, |_| 3.0, |_| 1.0, |_| 100.0, 100);
        assert!(matches!(
            compute(&source),
            Err(AppError::InvalidResponse { .. })
        ));
    }

    #[test]
    fn a_missing_input_series_fails_instead_of_dropping_a_component() {
        let mut source = source_from(
            |_| 100.0,
            |_| 18.0,
            |_| 3.0,
            |_| 1.0,
            |_| 100.0,
            LONG_ENOUGH,
        );
        source.bond_total_return.clear();

        assert!(
            compute(&source).is_err(),
            "an index over three of four components must not present as the same number"
        );
    }

    #[test]
    fn calendars_that_do_not_line_up_still_produce_a_reading() {
        // The bond series skipping a day the equity series has is normal, not an error.
        let mut source = source_from(
            |i| 100.0 * 1.0003_f64.powi(i as i32),
            |_| 18.0,
            |_| 3.0,
            |_| 1.0,
            |i| 100.0 + (i as f64) * 0.01,
            LONG_ENOUGH + 60,
        );
        source
            .bond_total_return
            .retain(|p| p.time % (7 * 86_400) != 0);

        let index = compute(&source).expect("a differing holiday calendar is not a failure");
        assert!((0..=100).contains(&index.value));
    }

    #[test]
    fn the_computed_index_is_not_attributed_to_the_data_source() {
        // FRED publishes the inputs, not the index. Naming FRED as the publisher of a
        // composite it has never heard of would be a provenance error, not a label choice.
        assert_ne!(STOCK_INDEX_ID, crate::providers::live::fred::FRED_ID);
        assert!(STOCK_INDEX_NAME.contains("Brew Terminal"));
        assert!(
            STOCK_INDEX_NAME.contains("FRED"),
            "the name must still credit the source"
        );
    }

    #[test]
    fn the_methodology_admits_who_computed_it() {
        let source = source_from(
            |_| 100.0,
            |_| 18.0,
            |_| 3.0,
            |_| 1.0,
            |_| 100.0,
            LONG_ENOUGH,
        );
        let index = compute(&source).unwrap();
        assert!(
            index.methodology.contains("Nobody publishes this number"),
            "a computed index must not read as though someone else stands behind it"
        );
    }

    #[test]
    fn every_required_series_is_one_the_provider_will_fetch() {
        // The allowlist in the FRED adapter refuses anything not listed there, so a typo in
        // REQUIRED_SERIES would surface as a runtime NotFound rather than a compile error.
        for id in REQUIRED_SERIES {
            assert!(
                crate::providers::live::fred::series_by_id(id).is_some(),
                "{id} is requested but not allowlisted in the FRED adapter"
            );
        }
    }

    #[test]
    fn the_source_window_covers_what_the_ranking_needs() {
        let needed_sessions = RANK_WINDOW + MOMENTUM_MA + HISTORY_DAYS;
        // ~252 trading sessions a year.
        let available_sessions = (SOURCE_LOOKBACK_DAYS as f64 / 365.0 * 252.0) as usize;
        assert!(
            available_sessions > needed_sessions,
            "requesting {SOURCE_LOOKBACK_DAYS} days gives about {available_sessions} sessions, \
             but the longest chain needs {needed_sessions}"
        );
    }

    #[test]
    fn the_requested_start_date_is_in_the_past_and_well_formed() {
        let start = source_start();
        assert!(chrono::NaiveDate::parse_from_str(&start, "%Y-%m-%d").is_ok());
        assert!(start < chrono::Utc::now().format("%Y-%m-%d").to_string());
    }

    #[test]
    fn every_reading_names_its_direction() {
        // A reading that says "4.2%" without saying above or below what is a number the reader
        // cannot use.
        assert!(reading_for("momentum", 4.2).contains("above"));
        assert!(reading_for("momentum", -4.2).contains("below"));
        assert!(reading_for("volatility", 8.0).contains("above"));
        assert!(reading_for("volatility", -8.0).contains("below"));
        assert!(reading_for("safe-haven", 3.0).contains("stocks returned"));
        assert!(reading_for("safe-haven", -3.0).contains("bonds returned"));
        assert!(!reading_for("junk-bond-demand", 2.0).is_empty());
    }

    #[test]
    fn readings_never_print_a_negative_sign_against_a_direction_word() {
        // "3.0% below its average" reads correctly; "-3.0% below" does not.
        for id in ["momentum", "volatility", "safe-haven"] {
            let text = reading_for(id, -3.0);
            assert!(
                !text.contains("-3.0"),
                "{id} printed a doubled negative: {text}"
            );
        }
    }
}
