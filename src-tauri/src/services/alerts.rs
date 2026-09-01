//! Alerts, and the background poll that makes them possible.
//!
//! **This is the one feature that breaks "the app makes no request you did not cause."** Every
//! other request in Brew Terminal traces to something the user just did. An alert cannot: its
//! entire value is being told about a price while you are not looking at it.
//!
//! Rather than quietly weaken the promise, the exception is bounded and stated:
//!
//! * **Off until switched on.** `alertsEnabled` defaults to false and the settings copy says
//!   what changes.
//! * **Nothing polls with no armed alerts.** The loop checks first and makes no request when the
//!   list is empty, so enabling the setting alone costs nothing.
//! * **Only watched assets are fetched**, in one batched request — not the market list.
//! * **An alert fires once.** `triggered_at` keeps it quiet afterwards, so a crossed threshold
//!   is one notification rather than one per poll.
//!
//! ARCHITECTURE.md and the README record the exception in the same terms.

use std::time::Duration;

use crate::db::{repo_alerts, repo_preferences, DbPool};
use crate::error::{AppError, AppResult};
use crate::models::Alert;
use crate::state::{with_db, AppState};

/// How often the poller wakes.
///
/// Deliberately slower than the UI's refresh interval. An alert is not a live price display, and
/// a domestic connection checking a handful of assets every two minutes is unnoticeable against
/// a free provider's rate limit.
const POLL_INTERVAL: Duration = Duration::from_secs(120);

/// One alert that fired, for the UI to surface.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct TriggeredAlert {
    pub alert: Alert,
    /// What to show: "BTC rose to 61240.00".
    pub message: String,
}

pub async fn list(state: &AppState) -> AppResult<Vec<Alert>> {
    with_db(state.pool.clone(), |conn| repo_alerts::list(conn)).await
}

pub async fn create(state: &AppState, alert: Alert) -> AppResult<Alert> {
    alert.validate().map_err(|detail| AppError::Validation {
        field: "alert".into(),
        detail,
    })?;
    with_db(state.pool.clone(), move |conn| {
        repo_alerts::insert(conn, &alert)
    })
    .await
}

pub async fn delete(state: &AppState, id: String) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        if repo_alerts::delete(conn, &id)? {
            Ok(())
        } else {
            Err(AppError::NotFound)
        }
    })
    .await
}

pub async fn set_enabled(state: &AppState, id: String, enabled: bool) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_alerts::set_enabled(conn, &id, enabled)
    })
    .await
}

pub async fn rearm(state: &AppState, id: String) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_alerts::rearm(conn, &id)
    })
    .await
}

/// Whether the user has switched background polling on.
fn polling_enabled(pool: &DbPool) -> bool {
    pool.get()
        .ok()
        .and_then(|conn| repo_preferences::get_all(&conn).ok())
        .is_some_and(|prefs| prefs.alerts_enabled)
}

/// Evaluates every armed alert once, firing any whose condition holds.
///
/// Separated from the loop so it can be tested directly — the loop is a timer around this.
pub async fn check_once(state: &AppState) -> AppResult<Vec<TriggeredAlert>> {
    if !polling_enabled(&state.pool) {
        return Ok(Vec::new());
    }

    let (alerts, asset_ids) = with_db(state.pool.clone(), |conn| {
        Ok((
            repo_alerts::armed(conn)?,
            repo_alerts::armed_asset_ids(conn)?,
        ))
    })
    .await?;

    // No armed alerts means no request. Enabling the setting alone costs nothing.
    if asset_ids.is_empty() {
        return Ok(Vec::new());
    }

    let quotes = super::market::get_quotes(state, asset_ids).await?.data;

    let mut fired = Vec::new();
    for alert in alerts {
        let Some(quote) = quotes.iter().find(|q| q.asset_id == alert.asset_id) else {
            continue;
        };
        let Some(value) = alert.evaluate(quote) else {
            continue;
        };

        let message = alert.describe(value);
        let id = alert.id.clone();
        with_db(state.pool.clone(), move |conn| {
            repo_alerts::mark_triggered(conn, &id, value)
        })
        .await?;

        tracing::info!(alert = %alert.id, "an alert fired");

        let mut fired_alert = alert;
        fired_alert.triggered_value = Some(value);
        fired.push(TriggeredAlert {
            alert: fired_alert,
            message,
        });
    }

    Ok(fired)
}

/// Starts the background poll.
///
/// Takes an `AppHandle` rather than the state itself: the state is owned by Tauri and is not
/// shareable across a spawned task, and resolving it per tick also means the loop always sees
/// current preferences. Switching alerts off stops the requests without a restart.
pub fn spawn_poller<R: tauri::Runtime>(handle: tauri::AppHandle<R>) {
    use tauri::Manager;

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(POLL_INTERVAL).await;

            let state = handle.state::<AppState>();

            match check_once(&state).await {
                Ok(fired) if !fired.is_empty() => {
                    tracing::info!(
                        count = fired.len(),
                        "alerts fired during a background check"
                    );
                }
                Ok(_) => {}
                Err(error) => {
                    // A provider being unreachable is not a reason to stop watching.
                    tracing::debug!(?error, "an alert check did not complete");
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AlertKind;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    fn alert(asset: &str, kind: AlertKind, threshold: f64) -> Alert {
        Alert {
            id: String::new(),
            asset_id: asset.into(),
            symbol: "BTC".into(),
            kind,
            threshold,
            enabled: true,
            note: None,
            created_at: 0,
            triggered_at: None,
            triggered_value: None,
        }
    }

    async fn enable_polling(state: &AppState) {
        super::super::settings::set_preference(state, "alertsEnabled".into(), "true".into())
            .await
            .unwrap();
    }

    /// The guarantee this feature is allowed to exist under: switched off, it does nothing.
    #[tokio::test]
    async fn nothing_is_checked_while_alerts_are_switched_off() {
        let (state, _dir) = state();
        create(
            &state,
            alert("crypto:cg:bitcoin", AlertKind::PriceAbove, 0.01),
        )
        .await
        .unwrap();

        // The threshold is trivially met, so only the preference can be keeping it quiet.
        assert!(check_once(&state).await.unwrap().is_empty());
        assert!(list(&state).await.unwrap()[0].triggered_at.is_none());
    }

    #[tokio::test]
    async fn an_armed_alert_fires_once_and_then_stays_quiet() {
        let (state, _dir) = state();
        enable_polling(&state).await;
        create(
            &state,
            alert("crypto:cg:bitcoin", AlertKind::PriceAbove, 0.01),
        )
        .await
        .unwrap();

        let first = check_once(&state).await.unwrap();
        assert_eq!(first.len(), 1);
        assert!(first[0].message.contains("BTC"));

        // The second check must not fire it again — this is what stops one crossing becoming a
        // notification every two minutes.
        assert!(check_once(&state).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn re_arming_lets_it_fire_again() {
        let (state, _dir) = state();
        enable_polling(&state).await;
        let stored = create(
            &state,
            alert("crypto:cg:bitcoin", AlertKind::PriceAbove, 0.01),
        )
        .await
        .unwrap();

        assert_eq!(check_once(&state).await.unwrap().len(), 1);
        rearm(&state, stored.id).await.unwrap();
        assert_eq!(check_once(&state).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn an_unreachable_threshold_never_fires() {
        let (state, _dir) = state();
        enable_polling(&state).await;
        create(
            &state,
            alert("crypto:cg:bitcoin", AlertKind::PriceAbove, 1e12),
        )
        .await
        .unwrap();

        assert!(check_once(&state).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_disabled_alert_is_not_polled_for() {
        let (state, _dir) = state();
        enable_polling(&state).await;
        let stored = create(
            &state,
            alert("crypto:cg:bitcoin", AlertKind::PriceAbove, 0.01),
        )
        .await
        .unwrap();

        set_enabled(&state, stored.id, false).await.unwrap();
        assert!(check_once(&state).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn an_invalid_alert_is_refused_before_it_is_stored() {
        let (state, _dir) = state();
        let mut bad = alert("crypto:cg:bitcoin", AlertKind::PriceAbove, -5.0);
        bad.symbol = "BTC".into();

        assert!(matches!(
            create(&state, bad).await,
            Err(AppError::Validation { .. })
        ));
        assert!(list(&state).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn deleting_something_that_is_gone_says_so() {
        let (state, _dir) = state();
        assert!(matches!(
            delete(&state, "nope".into()).await,
            Err(AppError::NotFound)
        ));
    }
}
