//! Model Desk logic.
//!
//! The order of operations in [`send_message`] is the privacy boundary in executable form:
//! every check that could refuse the send runs first, the transparency log is written, and only
//! then does anything reach the network. Nothing here is reachable except from a command the
//! user invoked — there is no timer, no prefetch and no startup hook in this module, which is
//! what AI_POLICY.md §2.1 asks for.

use crate::db::{repo_ai, repo_preferences};
use crate::error::{AppError, AppResult};
use crate::models::{
    now_epoch_secs, AiContextItem, AiConversation, AiMessage, AiMode, AiProviderSummary,
    AiSendPreview, AiSendResult, AiStatus, ChatRole, EndpointReach,
};
use crate::providers::ai;
use crate::security::secrets;
use crate::state::{with_db, AppState};

/// How many outbound-log rows the Privacy page asks for at once.
const OUTBOUND_PAGE: i64 = 200;

/// Everything the service needs to talk to a model, assembled once per call.
struct ResolvedEndpoint {
    endpoint: ai::AiEndpoint,
    has_credential: bool,
    mode: AiMode,
    provider_id: &'static str,
}

fn mode_from(preference: &str) -> AiMode {
    if preference == "cloud" {
        AiMode::Cloud
    } else {
        AiMode::Local
    }
}

fn provider_id_for(mode: AiMode) -> &'static str {
    match mode {
        AiMode::Local => ai::LOCAL_PROVIDER_ID,
        AiMode::Cloud => ai::CLOUD_PROVIDER_ID,
    }
}

/// Loads the active provider's endpoint and resolves its reach.
///
/// Returns `AiNotConfigured` for several situations that look the same to the user — no
/// endpoint saved, the `aiEnabled` preference switched off, or a cloud provider with no key —
/// because they all mean the same thing at the point of use: this is not on, so nothing is
/// going anywhere.
async fn resolve(state: &AppState) -> AppResult<ResolvedEndpoint> {
    let (local, cloud, preferences) = with_db(state.pool.clone(), |conn| {
        let local = repo_ai::get_endpoint_config(conn, ai::LOCAL_PROVIDER_ID)?;
        let cloud = repo_ai::get_endpoint_config(conn, ai::CLOUD_PROVIDER_ID)?;
        let preferences = repo_preferences::get_all(conn)?;
        Ok((local, cloud, preferences))
    })
    .await?;

    if !preferences.ai_enabled {
        return Err(AppError::AiNotConfigured);
    }

    let mode = mode_from(&preferences.ai_mode);
    let config = match mode {
        AiMode::Local => local,
        AiMode::Cloud => cloud,
    };

    let (Some(base), Some(model)) = (config.base_url, config.model) else {
        return Err(AppError::AiNotConfigured);
    };

    let parsed = ai::parse_endpoint(&base)?;

    // DNS resolution blocks; it does not belong on an async worker.
    let for_resolve = parsed.clone();
    let reach = tokio::task::spawn_blocking(move || ai::resolve_reach(&for_resolve))
        .await
        .map_err(|error| AppError::Storage(format!("resolver task failed: {error}")))?;

    match mode {
        AiMode::Local => ai::check_scheme(&parsed, reach)?,
        AiMode::Cloud => {
            ai::check_cloud_scheme(&parsed)?;
            // A cloud request is authenticated. Without a key it would go out and come back
            // 401, having transmitted the prompt for nothing — so it does not go out.
            if !config.has_credential {
                return Err(AppError::AiNotConfigured);
            }
        }
    }

    Ok(ResolvedEndpoint {
        endpoint: ai::AiEndpoint {
            base_url: parsed,
            reach,
            model,
            mode,
        },
        has_credential: config.has_credential,
        mode,
        provider_id: provider_id_for(mode),
    })
}

/// The Model Desk's own view of its configuration.
///
/// Safe to call before anything is set up, and it reports both providers rather than only the
/// active one — the settings page needs to render both forms, and a user switching modes
/// should not find the other side blank.
pub async fn get_status(state: &AppState) -> AppResult<AiStatus> {
    let (local, cloud, preferences) = with_db(state.pool.clone(), |conn| {
        let local = repo_ai::get_endpoint_config(conn, ai::LOCAL_PROVIDER_ID)?;
        let cloud = repo_ai::get_endpoint_config(conn, ai::CLOUD_PROVIDER_ID)?;
        let preferences = repo_preferences::get_all(conn)?;
        Ok((local, cloud, preferences))
    })
    .await?;

    let mode = mode_from(&preferences.ai_mode);
    let active = match mode {
        AiMode::Local => &local,
        AiMode::Cloud => &cloud,
    };

    let summary = |config: &repo_ai::AiEndpointConfig| AiProviderSummary {
        configured: config.base_url.is_some() && config.model.is_some(),
        endpoint: config.base_url.clone(),
        model: config.model.clone(),
        has_credential: config.has_credential,
    };

    let requires_credential = matches!(mode, AiMode::Cloud);
    let configured = active.base_url.is_some()
        && active.model.is_some()
        && (!requires_credential || active.has_credential);

    // The reach is resolved even when the feature is switched off, so the settings page can
    // show the user what label their endpoint would carry before they turn it on.
    let reach = match active.base_url.as_deref().map(ai::parse_endpoint) {
        Some(Ok(url)) => tokio::task::spawn_blocking(move || ai::resolve_reach(&url))
            .await
            .ok(),
        _ => None,
    };

    // Cloud leaves the machine by definition, whatever its host happens to resolve to.
    let leaves_device =
        matches!(mode, AiMode::Cloud) || reach.is_some_and(EndpointReach::leaves_device);

    Ok(AiStatus {
        configured,
        enabled: preferences.ai_enabled,
        mode,
        endpoint: active.base_url.clone(),
        model: active.model.clone(),
        reach,
        reach_label: reach.map(|r| r.label(mode).to_string()),
        leaves_device,
        requires_credential,
        has_credential: active.has_credential,
        system_prompt_version: ai::SYSTEM_PROMPT_VERSION.to_string(),
        local: summary(&local),
        cloud: summary(&cloud),
    })
}

/// Saves the local endpoint. Validates the address before storing it, never after.
pub async fn save_local_endpoint(
    state: &AppState,
    endpoint: String,
    model: String,
) -> AppResult<AiStatus> {
    let parsed = ai::parse_endpoint(&endpoint)?;
    let model = require_model(model)?;

    let for_resolve = parsed.clone();
    let reach = tokio::task::spawn_blocking(move || ai::resolve_reach(&for_resolve))
        .await
        .map_err(|error| AppError::Storage(format!("resolver task failed: {error}")))?;

    // Refuse a plaintext address that leaves the machine at the point it is saved, rather than
    // storing it and failing at send time. The user is looking at the form now.
    ai::check_scheme(&parsed, reach)?;

    store_endpoint(state, ai::LOCAL_PROVIDER_ID, parsed.as_ref(), &model).await?;
    get_status(state).await
}

/// Saves the cloud endpoint. HTTPS only, with no loopback exemption.
///
/// The key is not taken here. It goes in through `save_provider_credential`, the same one-way
/// path every other credential uses, so there is exactly one place in the app where a secret
/// crosses IPC. See THREAT_MODEL.md §4.
pub async fn save_cloud_endpoint(
    state: &AppState,
    endpoint: String,
    model: String,
) -> AppResult<AiStatus> {
    let parsed = ai::parse_endpoint(&endpoint)?;
    let model = require_model(model)?;
    ai::check_cloud_scheme(&parsed)?;

    store_endpoint(state, ai::CLOUD_PROVIDER_ID, parsed.as_ref(), &model).await?;
    get_status(state).await
}

fn require_model(model: String) -> AppResult<String> {
    let trimmed = model.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Validation {
            field: "model".into(),
            detail: "name the model the endpoint should use".into(),
        });
    }
    Ok(trimmed)
}

async fn store_endpoint(
    state: &AppState,
    provider_id: &'static str,
    base_url: &str,
    model: &str,
) -> AppResult<()> {
    let now = now_epoch_secs();
    let (base_url, model) = (base_url.to_string(), model.to_string());
    with_db(state.pool.clone(), move |conn| {
        repo_ai::set_endpoint_config(conn, provider_id, &base_url, &model, now)
    })
    .await
}

/// Forgets one provider's endpoint. The conversations stay — deleting them is a separate act.
pub async fn clear_endpoint(state: &AppState, mode: AiMode) -> AppResult<AiStatus> {
    let provider_id = provider_id_for(mode);
    let now = now_epoch_secs();
    with_db(state.pool.clone(), move |conn| {
        repo_ai::clear_endpoint_config(conn, provider_id, now)
    })
    .await?;

    get_status(state).await
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTestResult {
    pub ok: bool,
    /// User-safe: never a key, never a URL, never a raw endpoint body.
    pub message: String,
    /// Whether the configured model name is one the endpoint actually listed.
    pub model_available: Option<bool>,
    pub reach_label: String,
}

/// Asks the endpoint what models it has.
///
/// Runs only when the user presses the button. It is still a send, so it is still logged —
/// with a zero character count and a `connection-test` marker, because a transparency log that
/// omits some categories of traffic is not one.
pub async fn test_endpoint(state: &AppState) -> AppResult<AiTestResult> {
    let resolved = resolve(state).await?;
    let label = resolved.endpoint.label().to_string();
    let (mode, provider_id) = (resolved.mode, resolved.provider_id);

    let key = credential_for(&resolved).await;

    let now = now_epoch_secs();
    let id = format!("out-{}", uuid::Uuid::new_v4());
    with_db(state.pool.clone(), move |conn| {
        repo_ai::record_outbound(
            conn,
            repo_ai::OutboundRecord {
                id: &id,
                provider_id,
                mode,
                conversation_id: None,
                char_count: 0,
                included_context: r#"[{"kind":"connection-test"}]"#,
                created_at: now,
            },
        )
    })
    .await?;

    match ai::list_models(&resolved.endpoint, key.as_deref()).await {
        Ok(models) => {
            let available = models.iter().any(|m| m == &resolved.endpoint.model);
            let message = if models.is_empty() {
                "Connected. The endpoint answered but listed no models.".to_string()
            } else if available {
                format!(
                    "Connected. {} models available, including the one you named.",
                    models.len()
                )
            } else {
                format!(
                    "Connected, but \"{}\" was not in the {} models it listed.",
                    resolved.endpoint.model,
                    models.len()
                )
            };
            Ok(AiTestResult {
                ok: true,
                message,
                model_available: Some(available),
                reach_label: label,
            })
        }
        Err(error) => Ok(AiTestResult {
            ok: false,
            message: user_message(&error),
            model_available: None,
            reach_label: label,
        }),
    }
}

/// Reads the credential, if the endpoint has one. Local endpoints usually do not.
async fn credential_for(resolved: &ResolvedEndpoint) -> Option<String> {
    if !resolved.has_credential {
        return None;
    }
    let provider_id = resolved.provider_id;
    tokio::task::spawn_blocking(move || secrets::read(provider_id))
        .await
        .ok()
        .flatten()
}

/// Computes exactly what a send would transmit, without transmitting it.
///
/// This exists as its own command so the pre-send panel shows the count of the bytes that will
/// actually go out. A frontend estimate would drift from what Rust assembles the moment either
/// side changed. See AI_POLICY.md §2.2.
pub async fn preview_send(
    state: &AppState,
    conversation_id: Option<String>,
    prompt: String,
    context: Vec<AiContextItem>,
) -> AppResult<AiSendPreview> {
    let resolved = resolve(state).await?;
    repo_ai::validate_prompt(&prompt)?;

    let history = load_history(state, conversation_id).await?;
    let assembled = ai::assemble_messages(&prompt, &context, &history);

    Ok(AiSendPreview {
        char_count: assembled.total_chars() as i64,
        system_prompt_chars: assembled.system_prompt_chars as i64,
        history_chars: assembled.history_chars as i64,
        prompt_chars: assembled.prompt_chars as i64,
        context_chars: assembled.context_chars as i64,
        context_labels: assembled.context_labels,
        leaves_device: resolved.endpoint.leaves_device(),
        reach_label: Some(resolved.endpoint.label().to_string()),
    })
}

async fn load_history(
    state: &AppState,
    conversation_id: Option<String>,
) -> AppResult<Vec<(ChatRole, String)>> {
    let Some(id) = conversation_id else {
        return Ok(Vec::new());
    };

    let messages = with_db(state.pool.clone(), move |conn| {
        repo_ai::list_messages(conn, &id)
    })
    .await?;

    Ok(messages.into_iter().map(|m| (m.role, m.content)).collect())
}

/// Sends one message and stores the exchange.
///
/// Ordering is the point:
/// 1. Resolve and validate — anything that can refuse, refuses before a byte moves.
/// 2. Assemble the request, so the size is known.
/// 3. Write the outbound log.
/// 4. Send.
/// 5. Persist the conversation and both messages, only if a response came back.
///
/// Step 3 sits before step 4 deliberately. It records an *attempt*, which over-reports when a
/// connection fails outright and never under-reports when a request went out and the response
/// was lost. For a log whose job is to say what left the machine, that is the right direction
/// to be wrong in, and the Privacy page says so rather than implying every row is a delivery.
///
/// Step 5 sits after step 4 so a failed send leaves no half-conversation behind — which is what
/// the error copy promises.
pub async fn send_message(
    state: &AppState,
    conversation_id: Option<String>,
    prompt: String,
    context: Vec<AiContextItem>,
) -> AppResult<AiSendResult> {
    let resolved = resolve(state).await?;
    repo_ai::validate_prompt(&prompt)?;

    let history = load_history(state, conversation_id.clone()).await?;
    let assembled = ai::assemble_messages(&prompt, &context, &history);

    let is_new = conversation_id.is_none();
    let conv_id = conversation_id.unwrap_or_else(|| format!("conv-{}", uuid::Uuid::new_v4()));

    // Kinds and labels only. The context text and the prompt never reach this table.
    let context_summary = serde_json::to_string(
        &context
            .iter()
            .map(|item| {
                serde_json::json!({
                    "kind": item.kind,
                    "label": ai::sanitize_context_text(&item.label),
                })
            })
            .collect::<Vec<_>>(),
    )?;

    let char_count = assembled.total_chars() as i64;
    let now = now_epoch_secs();
    let log_id = format!("out-{}", uuid::Uuid::new_v4());
    let log_conv = conv_id.clone();
    with_db(state.pool.clone(), move |conn| {
        repo_ai::record_outbound(
            conn,
            repo_ai::OutboundRecord {
                id: &log_id,
                provider_id: resolved.provider_id,
                mode: resolved.mode,
                conversation_id: Some(&log_conv),
                char_count,
                included_context: &context_summary,
                created_at: now,
            },
        )
    })
    .await?;

    let key = credential_for(&resolved).await;
    let answer = ai::chat(&resolved.endpoint, &assembled.messages, key.as_deref()).await?;

    let title = repo_ai::title_from_prompt(&prompt);
    let model = resolved.endpoint.model.clone();
    let (conv_mode, conv_provider_id) = (resolved.mode, resolved.provider_id);
    let stored_conv = conv_id.clone();
    let user_id = format!("msg-{}", uuid::Uuid::new_v4());
    let assistant_id = format!("msg-{}", uuid::Uuid::new_v4());
    let stored_prompt = prompt.clone();

    let (user_message, assistant_message) = with_db(state.pool.clone(), move |conn| {
        let tx = conn.transaction()?;

        if is_new {
            repo_ai::create_conversation(
                &tx,
                repo_ai::NewConversation {
                    id: &stored_conv,
                    title: &title,
                    provider_id: conv_provider_id,
                    mode: conv_mode,
                    model_name: &model,
                    system_prompt_version: ai::SYSTEM_PROMPT_VERSION,
                    created_at: now,
                },
            )?;
        }

        // The stored message is the user's own text, not the assembled payload: the transcript
        // should read back as the conversation the person had, and the wrapped context is a
        // transport detail they already approved in the pre-send panel.
        let user = repo_ai::append_message(
            &tx,
            &user_id,
            &stored_conv,
            ChatRole::User,
            &stored_prompt,
            now,
        )?;
        let assistant = repo_ai::append_message(
            &tx,
            &assistant_id,
            &stored_conv,
            ChatRole::Assistant,
            &answer,
            now,
        )?;
        repo_ai::touch_conversation(&tx, &stored_conv, now)?;

        tx.commit()?;
        Ok((user, assistant))
    })
    .await?;

    Ok(AiSendResult {
        conversation_id: conv_id,
        user_message,
        assistant_message,
    })
}

// --- history -------------------------------------------------------------------------------

pub async fn list_conversations(state: &AppState) -> AppResult<Vec<AiConversation>> {
    with_db(state.pool.clone(), |conn| repo_ai::list_conversations(conn)).await
}

pub async fn get_messages(state: &AppState, conversation_id: String) -> AppResult<Vec<AiMessage>> {
    with_db(state.pool.clone(), move |conn| {
        repo_ai::list_messages(conn, &conversation_id)
    })
    .await
}

pub async fn delete_conversation(state: &AppState, conversation_id: String) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_ai::delete_conversation(conn, &conversation_id)
    })
    .await
}

pub async fn clear_conversations(state: &AppState) -> AppResult<()> {
    with_db(state.pool.clone(), |conn| {
        repo_ai::delete_all_conversations(conn)
    })
    .await
}

pub async fn list_outbound_log(state: &AppState) -> AppResult<Vec<crate::models::AiOutboundEntry>> {
    with_db(state.pool.clone(), |conn| {
        repo_ai::list_outbound(conn, OUTBOUND_PAGE)
    })
    .await
}

pub async fn clear_outbound_log(state: &AppState) -> AppResult<()> {
    with_db(state.pool.clone(), |conn| repo_ai::clear_outbound(conn)).await
}

/// One source of user-facing wording, reused rather than re-typed. Mirrors `services::mod`.
fn user_message(error: &AppError) -> String {
    serde_json::to_value(error)
        .ok()
        .and_then(|value| {
            value
                .get("message")
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "Something went wrong.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repo_ai;
    use crate::state::AppState;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    /// The default state of the whole feature: nothing configured, nothing enabled, and — the
    /// part that matters — nothing sent. Bootstrap runs migrations, seeds providers and starts
    /// the cache eviction task; none of that may touch a model.
    #[tokio::test]
    async fn bootstrap_configures_nothing_and_sends_nothing() {
        let (state, _dir) = state();

        let status = get_status(&state).await.unwrap();
        assert!(!status.configured);
        assert!(!status.enabled);
        assert!(status.endpoint.is_none());

        let sent = with_db(state.pool.clone(), |conn| repo_ai::count_outbound(conn))
            .await
            .unwrap();
        assert_eq!(sent, 0, "nothing may be sent before the user asks");
    }

    #[tokio::test]
    async fn sending_is_refused_until_the_feature_is_switched_on() {
        let (state, _dir) = state();

        // Endpoint saved but aiEnabled still false.
        let now = now_epoch_secs();
        with_db(state.pool.clone(), move |conn| {
            repo_ai::set_endpoint_config(
                conn,
                ai::LOCAL_PROVIDER_ID,
                "http://127.0.0.1:11434/v1",
                "llama3",
                now,
            )
        })
        .await
        .unwrap();

        let result = send_message(&state, None, "what is an ETF?".into(), vec![]).await;
        assert!(matches!(result, Err(AppError::AiNotConfigured)));

        let sent = with_db(state.pool.clone(), |conn| repo_ai::count_outbound(conn))
            .await
            .unwrap();
        assert_eq!(sent, 0, "a refused send must not appear in the log");
    }

    #[tokio::test]
    async fn a_plaintext_endpoint_off_this_machine_is_refused_at_save_time() {
        let (state, _dir) = state();

        let result = save_local_endpoint(
            &state,
            "http://192.168.1.20:11434/v1".into(),
            "llama3".into(),
        )
        .await;

        assert!(
            matches!(result, Err(AppError::Validation { .. })),
            "plaintext to a LAN host must not be storable"
        );

        let status = get_status(&state).await.unwrap();
        assert!(!status.configured);
    }

    #[tokio::test]
    async fn a_loopback_endpoint_saves_and_reports_offline() {
        let (state, _dir) = state();

        let status =
            save_local_endpoint(&state, "http://127.0.0.1:11434/v1".into(), "llama3".into())
                .await
                .unwrap();

        assert!(status.configured);
        assert_eq!(status.reach, Some(EndpointReach::Loopback));
        assert_eq!(status.reach_label.as_deref(), Some("Local · offline"));
        assert!(!status.leaves_device);
        assert_eq!(status.system_prompt_version, "v1");
    }

    #[tokio::test]
    async fn an_endpoint_with_credentials_in_the_url_is_refused() {
        let (state, _dir) = state();
        let result =
            save_local_endpoint(&state, "http://u:p@127.0.0.1:11434".into(), "m".into()).await;
        assert!(matches!(result, Err(AppError::Validation { .. })));
    }

    #[tokio::test]
    async fn a_model_name_is_required() {
        let (state, _dir) = state();
        let result =
            save_local_endpoint(&state, "http://127.0.0.1:11434".into(), "  ".into()).await;
        assert!(matches!(result, Err(AppError::Validation { .. })));
    }

    async fn set_mode(state: &AppState, mode: &str) {
        let value = format!("\"{mode}\"");
        with_db(state.pool.clone(), move |conn| {
            crate::db::repo_preferences::set(conn, "aiMode", &value, now_epoch_secs())
        })
        .await
        .unwrap();
    }

    async fn enable_ai(state: &AppState) {
        with_db(state.pool.clone(), move |conn| {
            crate::db::repo_preferences::set(conn, "aiEnabled", "true", now_epoch_secs())
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn a_cloud_endpoint_must_be_https() {
        let (state, _dir) = state();

        assert!(
            save_cloud_endpoint(&state, "http://api.example.com/v1".into(), "gpt-oss".into())
                .await
                .is_err(),
            "a cloud endpoint on plain http must not be storable"
        );
        assert!(save_cloud_endpoint(
            &state,
            "https://api.example.com/v1".into(),
            "gpt-oss".into()
        )
        .await
        .is_ok());
    }

    /// The loopback exemption exists for local model servers. A "cloud" provider pointed at
    /// 127.0.0.1 over plain http would carry a key in the clear and is refused.
    #[tokio::test]
    async fn the_loopback_exemption_does_not_extend_to_cloud() {
        let (state, _dir) = state();
        assert!(
            save_cloud_endpoint(&state, "http://127.0.0.1:8080/v1".into(), "m".into())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn cloud_is_labelled_as_cloud_regardless_of_where_it_resolves() {
        let (state, _dir) = state();
        save_cloud_endpoint(
            &state,
            "https://api.example.com/v1".into(),
            "gpt-oss".into(),
        )
        .await
        .unwrap();
        set_mode(&state, "cloud").await;

        let status = get_status(&state).await.unwrap();
        assert_eq!(status.mode, AiMode::Cloud);
        assert_eq!(status.reach_label.as_deref(), Some("Cloud · API"));
        assert!(status.leaves_device);
        assert!(status.requires_credential);
    }

    /// Without a key the request would go out, transmit the prompt, and come back 401. So it
    /// does not go out.
    #[tokio::test]
    async fn cloud_refuses_to_send_without_a_key() {
        let (state, _dir) = state();
        save_cloud_endpoint(
            &state,
            "https://api.example.com/v1".into(),
            "gpt-oss".into(),
        )
        .await
        .unwrap();
        set_mode(&state, "cloud").await;
        enable_ai(&state).await;

        let result = send_message(&state, None, "what is an ETF?".into(), vec![]).await;
        assert!(matches!(result, Err(AppError::AiNotConfigured)));

        let sent = with_db(state.pool.clone(), |conn| repo_ai::count_outbound(conn))
            .await
            .unwrap();
        assert_eq!(
            sent, 0,
            "a keyless cloud send must not reach the log either"
        );
    }

    /// Both providers are stored independently, so switching modes does not discard the other.
    #[tokio::test]
    async fn both_providers_are_remembered_across_a_mode_switch() {
        let (state, _dir) = state();
        save_local_endpoint(&state, "http://127.0.0.1:11434/v1".into(), "llama3".into())
            .await
            .unwrap();
        save_cloud_endpoint(
            &state,
            "https://api.example.com/v1".into(),
            "gpt-oss".into(),
        )
        .await
        .unwrap();

        set_mode(&state, "cloud").await;
        let status = get_status(&state).await.unwrap();
        assert_eq!(status.local.model.as_deref(), Some("llama3"));
        assert_eq!(status.cloud.model.as_deref(), Some("gpt-oss"));
        assert_eq!(status.model.as_deref(), Some("gpt-oss"));

        set_mode(&state, "local").await;
        let status = get_status(&state).await.unwrap();
        assert_eq!(status.model.as_deref(), Some("llama3"));
        assert_eq!(status.reach_label.as_deref(), Some("Local · offline"));
    }

    #[tokio::test]
    async fn clearing_one_provider_leaves_the_other_alone() {
        let (state, _dir) = state();
        save_local_endpoint(&state, "http://127.0.0.1:11434/v1".into(), "llama3".into())
            .await
            .unwrap();
        save_cloud_endpoint(
            &state,
            "https://api.example.com/v1".into(),
            "gpt-oss".into(),
        )
        .await
        .unwrap();

        let status = clear_endpoint(&state, AiMode::Cloud).await.unwrap();
        assert!(!status.cloud.configured);
        assert!(status.local.configured);
    }

    #[tokio::test]
    async fn clearing_the_endpoint_switches_the_desk_off() {
        let (state, _dir) = state();
        save_local_endpoint(&state, "http://127.0.0.1:11434".into(), "m".into())
            .await
            .unwrap();

        let status = clear_endpoint(&state, AiMode::Local).await.unwrap();
        assert!(!status.configured);
        assert!(status.endpoint.is_none());
    }
}
