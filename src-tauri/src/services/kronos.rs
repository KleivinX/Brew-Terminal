//! The Kronos projection: a third-party model's continuation of an asset's recent candles.
//!
//! This is the one place the app shows anything about the future, and it is built so that
//! what it shows cannot be mistaken for the app's own view:
//!
//! * **It is not ours.** The model is Kronos-small, published by NeoQuasar under MIT. The app
//!   runs it (`localai::kronos`) and reports what came out; it does not train, tune, filter or
//!   re-rank anything. See ADR-042.
//! * **It does not run until the user has agreed to what it is.** `project` checks the
//!   `kronosAcknowledged` preference itself, so the consent dialog is a gate rather than a
//!   decoration in front of one.
//! * **It never reports one number.** The model is a sampler. Twenty paths are drawn and the
//!   result is their average with the lowest and highest path at each step — a spread of the
//!   model's own draws, described as exactly that and not as a confidence interval.
//! * **It is repeatable.** The seed is fixed, so the same candles give the same output and a
//!   reader can check that nothing is being adjusted between runs.
//!
//! The input candles still arrive in an `Envelope`, so the result carries the provider and age
//! of the data it was computed from like every other number in the app.

use std::path::PathBuf;

use serde::Serialize;

use super::market::{asset_type_for_id, cached_or_degraded, not_configured, source_for};
use crate::db::repo_preferences;
use crate::error::{AppError, AppResult};
use crate::localai::kronos::{self, Kronos, Sampling, Tokenizer, FEATURES};
use crate::localai::{catalogue, download, store};
use crate::models::{AssetType, Candle, ChartPoint, ChartRange, Envelope};
use crate::providers::cache::{cache_key, CacheKind};
use crate::state::{with_db, AppState};

const DAY: i64 = 86_400;
/// The context window Kronos-small was trained with.
const MAX_CONTEXT: usize = 512;
/// Below this the model is being asked to continue a history it has barely seen.
const MIN_CANDLES: usize = 64;
/// How far ahead to draw: four days of four-hour candles, or two trading weeks of daily ones.
const STEPS_INTRADAY: usize = 24;
const STEPS_DAILY: usize = 10;
const PATHS: usize = 20;
/// Upstream's documented sampling defaults, unchanged.
const TEMPERATURE: f32 = 1.0;
const TOP_P: f32 = 0.9;
/// "KRONOS" in ASCII. Fixed, so a run can be repeated and compared.
const SEED: u64 = 0x4B52_4F4E_4F53;
/// How much of the context the chart shows beside the projection, for orientation.
const HISTORY_SHOWN: usize = 60;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct KronosStatus {
    /// Both files are on disk and passed their checksums.
    pub installed: bool,
    #[cfg_attr(test, ts(type = "number"))]
    pub download_bytes: u64,
    pub model: &'static str,
    pub parameters: &'static str,
    pub publisher: &'static str,
    pub licence: &'static str,
    pub source_url: &'static str,
    pub paper_url: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct KronosPoint {
    /// Unix epoch seconds, UTC.
    #[cfg_attr(test, ts(type = "number"))]
    pub time: i64,
    /// Average close across the sampled paths.
    pub mean: f64,
    /// Lowest and highest close any sampled path reached at this step.
    pub low: f64,
    pub high: f64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct KronosProjection {
    pub asset_id: String,
    pub model: &'static str,
    /// Seconds between candles, as the provider served them.
    #[cfg_attr(test, ts(type = "number"))]
    pub interval_secs: i64,
    /// How many candles the model was given.
    #[cfg_attr(test, ts(type = "number"))]
    pub context_candles: usize,
    /// Whether the provider reported volume. Without it the model sees prices alone.
    pub has_volume: bool,
    #[cfg_attr(test, ts(type = "number"))]
    pub paths: usize,
    /// The closing end of the context, so the projection is drawn against what preceded it.
    pub history: Vec<ChartPoint>,
    pub points: Vec<KronosPoint>,
    #[cfg_attr(test, ts(type = "number"))]
    pub elapsed_ms: u64,
}

fn files(state: &AppState) -> [PathBuf; 2] {
    let dir = store::kronos_dir(&state.data_dir);
    catalogue::KRONOS_FILES.map(|file| dir.join(file.file_name))
}

pub fn status(state: &AppState) -> KronosStatus {
    KronosStatus {
        // `fetch_verified` renames into place only after the checksum passes, so a file at its
        // final name is a verified one.
        installed: files(state).iter().all(|path| path.exists()),
        download_bytes: catalogue::KRONOS_FILES.iter().map(|f| f.size_bytes).sum(),
        model: catalogue::KRONOS_NAME,
        parameters: catalogue::KRONOS_PARAMETERS,
        publisher: catalogue::KRONOS_PUBLISHER,
        licence: catalogue::KRONOS_LICENCE,
        source_url: catalogue::KRONOS_SOURCE_URL,
        paper_url: catalogue::KRONOS_PAPER_URL,
    }
}

/// Fetches the tokenizer and the model, one after the other, through the same verified,
/// resumable, cancellable path the chat models use.
pub async fn download(state: &AppState) -> AppResult<KronosStatus> {
    for (file, dest) in catalogue::KRONOS_FILES.iter().zip(files(state)) {
        let handle = super::local_models::begin(state, file.item_id)?;
        let result = download::fetch_verified(
            &state.registry.download_client(),
            file.url,
            &dest,
            file.sha256,
            handle,
        )
        .await;
        super::local_models::finish(state);

        if result? == download::Outcome::Cancelled {
            break;
        }
    }
    Ok(status(state))
}

pub fn remove(state: &AppState) -> AppResult<KronosStatus> {
    let dir = store::kronos_dir(&state.data_dir);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|error| AppError::Storage(format!("could not delete the model: {error}")))?;
        tracing::info!("deleted the Kronos weights");
    }
    Ok(status(state))
}

/// The gap between candles, taken as the median so that a weekend in a daily series does not
/// read as a three-day interval.
fn interval_of(candles: &[Candle]) -> i64 {
    let mut gaps: Vec<i64> = candles.windows(2).map(|p| p[1].time - p[0].time).collect();
    gaps.sort_unstable();
    gaps.get(gaps.len() / 2).copied().unwrap_or(DAY).max(1)
}

/// The timestamps of the next `steps` candles.
fn future_times(last: i64, interval: i64, steps: usize, weekdays_only: bool) -> Vec<i64> {
    let mut times = Vec::with_capacity(steps);
    let mut time = last;
    while times.len() < steps {
        time += interval;
        // ponytail: weekends only. Exchange holidays are not known here, so a projected
        // "trading day" can land on one; a market calendar per exchange is the upgrade.
        if !(weekdays_only && kronos::stamp(time)[2] >= 5) {
            times.push(time);
        }
    }
    times
}

/// Candles in the column order the model was trained on.
///
/// Volume is all-or-nothing: a series with volume for some candles and not others is treated
/// as having none, because a zero between real volumes is a figure nobody reported. `amount`
/// is derived the way upstream derives it when a dataset lacks the column.
fn model_input(candles: &[Candle]) -> (Vec<[f32; FEATURES]>, bool) {
    let has_volume = candles.iter().all(|c| c.volume.is_some());
    let rows = candles
        .iter()
        .map(|c| {
            let volume = if has_volume {
                c.volume.unwrap_or(0.0)
            } else {
                0.0
            };
            let amount = volume * (c.open + c.high + c.low + c.close) / 4.0;
            [c.open, c.high, c.low, c.close, volume, amount].map(|v| v as f32)
        })
        .collect();
    (rows, has_volume)
}

/// Mean, lowest and highest close at each step. `None` if any path left the range of things
/// that can be a price — in which case nothing is shown rather than a chart with a hole in it.
fn summarise(paths: &[Vec<[f32; FEATURES]>], times: &[i64]) -> Option<Vec<KronosPoint>> {
    const CLOSE: usize = 3;
    times
        .iter()
        .enumerate()
        .map(|(step, time)| {
            let closes: Vec<f64> = paths.iter().map(|path| path[step][CLOSE] as f64).collect();
            if closes.is_empty() || closes.iter().any(|c| !c.is_finite() || *c <= 0.0) {
                return None;
            }
            Some(KronosPoint {
                time: *time,
                mean: closes.iter().sum::<f64>() / closes.len() as f64,
                low: closes.iter().copied().fold(f64::INFINITY, f64::min),
                high: closes.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            })
        })
        .collect()
}

/// Loads the model and runs it. CPU-bound for seconds; call it off the async runtime.
fn run(
    [tokenizer_path, model_path]: [PathBuf; 2],
    asset_id: String,
    candles: &[Candle],
    weekdays_only: bool,
) -> AppResult<KronosProjection> {
    let started = std::time::Instant::now();
    let tokenizer = Tokenizer::load(&tokenizer_path)?;
    let model = Kronos::load(&model_path)?;

    let interval = interval_of(candles);
    let daily = interval >= DAY;
    let steps = if daily { STEPS_DAILY } else { STEPS_INTRADAY };

    // Context and projection together stay inside the window, so every step after the first
    // pass is incremental — see `localai::kronos::predict`.
    let context = &candles[candles.len().saturating_sub(MAX_CONTEXT - steps)..];
    let last = context.last().ok_or(AppError::NotFound)?;
    let times = future_times(last.time, interval, steps, weekdays_only && daily);

    // A daily bar is stamped at midday for display; the model was trained on dates, so it is
    // shown midnight.
    let stamp = |time: i64| {
        kronos::stamp(if daily {
            time - time.rem_euclid(DAY)
        } else {
            time
        })
    };
    let (rows, has_volume) = model_input(context);
    let stamps: Vec<_> = context.iter().map(|c| stamp(c.time)).collect();
    let ahead: Vec<_> = times.iter().map(|t| stamp(*t)).collect();

    let paths = kronos::predict(
        &tokenizer,
        &model,
        &rows,
        &stamps,
        &ahead,
        MAX_CONTEXT,
        Sampling::Nucleus {
            temperature: TEMPERATURE,
            top_p: TOP_P,
            paths: PATHS,
            seed: SEED,
        },
    );

    let points = summarise(&paths, &times).ok_or_else(|| {
        AppError::Storage(
            "The model produced values that cannot be prices. Nothing is shown.".into(),
        )
    })?;

    let elapsed_ms = started.elapsed().as_millis() as u64;
    tracing::info!(
        elapsed_ms,
        candles = context.len(),
        "ran a Kronos projection"
    );

    Ok(KronosProjection {
        asset_id,
        model: catalogue::KRONOS_NAME,
        interval_secs: interval,
        context_candles: context.len(),
        has_volume,
        paths: paths.len(),
        history: context[context.len().saturating_sub(HISTORY_SHOWN)..]
            .iter()
            .map(|c| ChartPoint {
                time: c.time,
                close: c.close,
            })
            .collect(),
        points,
        elapsed_ms,
    })
}

async fn candles(state: &AppState, asset_id: &str) -> AppResult<Envelope<Vec<Candle>>> {
    // Whoever can draw this asset's one-month chart is who has its candles.
    let Some(provider) = state
        .registry
        .chart_provider_for(asset_id, ChartRange::Month)
    else {
        return Ok(not_configured("candle"));
    };

    let (id, name) = (
        provider.id().to_string(),
        provider.display_name().to_string(),
    );
    let key = cache_key(&id, "candles", &[asset_id.to_string()]);
    let source = source_for(&id);

    cached_or_degraded(
        state,
        CacheKind::ChartHistorical,
        key,
        &id,
        &name,
        source,
        || {
            let asset_id = asset_id.to_string();
            async move { provider.candles(&asset_id).await }
        },
    )
    .await
}

/// Runs the model on an asset's recent candles.
///
/// `data` is `None` when there are not enough candles to run on; the envelope then says why,
/// if a provider failed, or simply carries no reason if the asset has too little history.
pub async fn project(
    state: &AppState,
    asset_id: String,
) -> AppResult<Envelope<Option<KronosProjection>>> {
    let prefs = with_db(state.pool.clone(), |conn| repo_preferences::get_all(conn)).await?;
    if !prefs.kronos_acknowledged {
        return Err(AppError::Validation {
            field: "kronos".into(),
            detail: "Kronos has not been switched on.".into(),
        });
    }
    if !status(state).installed {
        return Err(AppError::Validation {
            field: "kronos".into(),
            detail: "The Kronos model has not been downloaded.".into(),
        });
    }

    let Envelope { data, meta } = candles(state, &asset_id).await?;
    if data.len() < MIN_CANDLES {
        return Ok(Envelope { data: None, meta });
    }

    let weekdays_only = asset_type_for_id(&asset_id) != Some(AssetType::Crypto);
    let paths = files(state);
    let projection =
        tokio::task::spawn_blocking(move || run(paths, asset_id, &data, weekdays_only))
            .await
            .map_err(|error| AppError::Storage(format!("the model run failed: {error}")))??;

    Ok(Envelope {
        data: Some(projection),
        meta,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::settings::set_preference;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    fn candle(time: i64, close: f64, volume: Option<f64>) -> Candle {
        Candle {
            time,
            open: close,
            high: close + 1.0,
            low: close - 1.0,
            close,
            volume,
        }
    }

    #[tokio::test]
    async fn the_model_does_not_run_until_the_user_has_agreed_to_what_it_is() {
        let (state, _dir) = state();
        let refused = project(&state, "crypto:cg:bitcoin".into()).await;
        assert!(
            matches!(refused, Err(AppError::Validation { ref detail, .. }) if detail.contains("switched on"))
        );
    }

    #[tokio::test]
    async fn agreeing_is_not_the_same_as_having_the_model() {
        let (state, _dir) = state();
        set_preference(&state, "kronosAcknowledged".into(), "true".into())
            .await
            .unwrap();

        let refused = project(&state, "crypto:cg:bitcoin".into()).await;
        assert!(
            matches!(refused, Err(AppError::Validation { ref detail, .. }) if detail.contains("downloaded"))
        );
    }

    #[test]
    fn installed_means_both_files_and_removing_takes_both() {
        let (state, _dir) = state();
        assert!(!status(&state).installed);
        assert_eq!(status(&state).download_bytes, 114_823_024);

        let [tokenizer, model] = files(&state);
        std::fs::create_dir_all(tokenizer.parent().unwrap()).unwrap();
        std::fs::write(&tokenizer, b"x").unwrap();
        assert!(
            !status(&state).installed,
            "the tokenizer alone is not enough"
        );

        std::fs::write(&model, b"x").unwrap();
        assert!(status(&state).installed);

        assert!(!remove(&state).unwrap().installed);
        assert!(!tokenizer.exists() && !model.exists());
        // Removing what is not there is not an error.
        assert!(remove(&state).is_ok());
    }

    #[test]
    fn a_weekend_does_not_make_a_daily_series_look_three_daily() {
        // Thu, Fri, then Mon, Tue, Wed.
        let thursday = 1_759_363_200; // 2025-10-02 00:00 UTC
        let days = [0, 1, 4, 5, 6];
        let candles: Vec<_> = days
            .iter()
            .map(|d| candle(thursday + d * DAY, 100.0, None))
            .collect();
        assert_eq!(interval_of(&candles), DAY);
    }

    #[test]
    fn daily_projections_skip_the_weekend_and_crypto_does_not() {
        let friday = 1_759_449_600; // 2025-10-03 00:00 UTC
        let weekdays: Vec<usize> = future_times(friday, DAY, 6, true)
            .iter()
            .map(|t| kronos::stamp(*t)[2])
            .collect();
        assert_eq!(weekdays, [0, 1, 2, 3, 4, 0], "Mon–Fri, then Monday again");

        let every_day = future_times(friday, DAY, 3, false);
        assert_eq!(
            every_day,
            [friday + DAY, friday + 2 * DAY, friday + 3 * DAY]
        );

        let four_hourly = future_times(friday, 4 * 3600, 2, false);
        assert_eq!(four_hourly, [friday + 4 * 3600, friday + 8 * 3600]);
    }

    #[test]
    fn a_missing_volume_is_zero_for_every_candle_not_for_some() {
        let (rows, has_volume) = model_input(&[candle(0, 10.0, Some(5.0)), candle(1, 10.0, None)]);
        assert!(!has_volume);
        assert!(rows.iter().all(|row| row[4] == 0.0 && row[5] == 0.0));

        let (rows, has_volume) = model_input(&[candle(0, 10.0, Some(5.0))]);
        assert!(has_volume);
        // open 10, high 11, low 9, close 10 → mean 10; amount = volume × mean.
        assert_eq!(rows[0], [10.0, 11.0, 9.0, 10.0, 5.0, 50.0]);
    }

    #[test]
    fn the_summary_is_the_mean_and_the_extremes_of_the_sampled_closes() {
        let path = |close: f32| vec![[0.0, 0.0, 0.0, close, 0.0, 0.0]];
        let points = summarise(&[path(9.0), path(10.0), path(14.0)], &[42]).unwrap();

        assert_eq!(points.len(), 1);
        assert_eq!(
            (
                points[0].time,
                points[0].mean,
                points[0].low,
                points[0].high
            ),
            (42, 11.0, 9.0, 14.0)
        );
    }

    #[test]
    fn a_path_that_is_not_a_price_voids_the_whole_result() {
        let path = |close: f32| vec![[0.0, 0.0, 0.0, close, 0.0, 0.0]];
        assert!(summarise(&[path(9.0), path(-1.0)], &[42]).is_none());
        assert!(summarise(&[path(9.0), path(f32::NAN)], &[42]).is_none());
        assert!(summarise(&[], &[42]).is_none());
    }
}
