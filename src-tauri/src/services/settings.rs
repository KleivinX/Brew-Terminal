use crate::db::{migrations, repo_preferences, repo_providers};
use crate::error::{AppError, AppResult};
use crate::models::{now_epoch_secs, AppInfo, AssetType, Preferences, ProviderInfo};
use crate::providers::mock::MockBehavior;
use crate::security::secrets;
use crate::state::{with_db, AppState};

pub async fn get_preferences(state: &AppState) -> AppResult<Preferences> {
    with_db(state.pool.clone(), |conn| repo_preferences::get_all(conn)).await
}

pub async fn set_preference(state: &AppState, key: String, value: String) -> AppResult<()> {
    let now = now_epoch_secs();
    with_db(state.pool.clone(), move |conn| {
        repo_preferences::set(conn, &key, &value, now)
    })
    .await
}

pub async fn list_providers(state: &AppState) -> AppResult<Vec<ProviderInfo>> {
    Ok(state.registry.list_info().await)
}

pub async fn get_app_info(state: &AppState) -> AppResult<AppInfo> {
    let schema_version =
        with_db(state.pool.clone(), |conn| migrations::current_version(conn)).await?;

    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        // Shown on the Privacy page so the user can find their own data without guessing.
        data_dir: state.data_dir.display().to_string(),
        db_path: state.db_path.display().to_string(),
        schema_version,
        is_mock_mode: state.registry.is_mock_mode(),
    })
}

/// Dev-only. Forces the mock provider into a failure mode so every UI state is reachable
/// without a network. The frontend only exposes this behind `isDev()`.
pub async fn set_mock_behavior(state: &AppState, behavior: MockBehavior) -> AppResult<()> {
    state.registry.mock_market().set_behavior(behavior);
    Ok(())
}

/// Enables or disables a provider.
pub async fn set_provider_enabled(
    state: &AppState,
    provider_id: String,
    enabled: bool,
) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_providers::set_enabled(conn, &provider_id, enabled)
    })
    .await
}

/// Stores an API key in the OS keychain.
///
/// This is the **only** direction a credential travels across IPC: inward, once, because the
/// user typed it. Nothing ever sends one back — the read path returns a boolean and a masked
/// hint. See THREAT_MODEL.md §4.
pub async fn save_provider_credential(
    state: &AppState,
    provider_id: String,
    api_key: String,
) -> AppResult<String> {
    let id = provider_id.clone();
    // Keychain access can block, so it does not run on an async worker.
    let masked = tokio::task::spawn_blocking(move || -> AppResult<String> {
        secrets::store(&id, api_key.trim())?;
        Ok(secrets::masked_hint(&id).unwrap_or_else(|| "…".repeat(4)))
    })
    .await
    .map_err(|error| AppError::Storage(format!("keychain task failed: {error}")))??;

    let id = provider_id.clone();
    with_db(state.pool.clone(), move |conn| {
        repo_providers::set_has_credential(conn, &id, true)?;
        // A newly-keyed provider is useless while disabled; turning it on is what the user
        // was asking for by entering a key.
        repo_providers::set_enabled(conn, &id, true)?;
        repo_providers::set_last_error(conn, &id, None)
    })
    .await?;

    Ok(masked)
}

pub async fn delete_provider_credential(state: &AppState, provider_id: String) -> AppResult<()> {
    let id = provider_id.clone();
    tokio::task::spawn_blocking(move || secrets::delete(&id))
        .await
        .map_err(|error| AppError::Storage(format!("keychain task failed: {error}")))??;

    let id = provider_id.clone();
    with_db(state.pool.clone(), move |conn| {
        repo_providers::set_has_credential(conn, &id, false)?;
        // A provider that requires a key cannot work without one, so it goes back to off
        // rather than sitting enabled and failing every request.
        repo_providers::set_enabled(conn, &id, false)
    })
    .await
}

/// Result of a "test connection" action.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    /// User-safe. Never carries a key, a URL, or a provider body.
    pub message: String,
}

/// Makes one real request to confirm a provider actually answers.
///
/// Deliberately explicit: the app does not probe providers in the background, so this only
/// happens when the user presses the button.
pub async fn test_provider(state: &AppState, provider_id: String) -> AppResult<ProviderTestResult> {
    let Some(provider) = state
        .registry
        .enabled_market_providers()
        .into_iter()
        .find(|p| p.id() == provider_id)
    else {
        return Ok(ProviderTestResult {
            ok: false,
            message: "That provider is not enabled.".into(),
        });
    };

    // A one-row request: enough to prove credentials and connectivity, cheap against a quota.
    let asset_type = provider
        .capabilities()
        .asset_types
        .first()
        .copied()
        .unwrap_or(AssetType::Crypto);

    let outcome = provider.market_list(asset_type, "global", 1).await;

    let result = match &outcome {
        Ok(rows) if !rows.is_empty() => ProviderTestResult {
            ok: true,
            message: format!("Connected. {} answered with data.", provider.display_name()),
        },
        Ok(_) => ProviderTestResult {
            ok: true,
            message: format!(
                "{} answered, but returned no rows for this check.",
                provider.display_name()
            ),
        },
        Err(error) => ProviderTestResult {
            ok: false,
            message: serde_json::to_value(error)
                .ok()
                .and_then(|v| {
                    v.get("message")
                        .and_then(|m| m.as_str())
                        .map(str::to_string)
                })
                .unwrap_or_else(|| "The provider could not be reached.".into()),
        },
    };

    let id = provider_id.clone();
    let stored_error = if result.ok {
        None
    } else {
        Some(result.message.clone())
    };
    with_db(state.pool.clone(), move |conn| {
        repo_providers::set_last_error(conn, &id, stored_error.as_deref())
    })
    .await?;

    Ok(result)
}
