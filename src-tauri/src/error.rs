use serde::Serialize;

/// The single error type that crosses the IPC boundary.
///
/// Every message here is user-safe by construction: no credential, no full request URL with a
/// query string, no raw provider body. Detail for developers goes to `tracing`, which runs
/// behind the redaction layer in `security::redact`. See ARCHITECTURE.md §11.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("provider not configured")]
    NotConfigured { provider_id: String },

    #[error("provider rate limited")]
    RateLimited {
        provider_id: String,
        retry_after_secs: Option<u64>,
    },

    #[error("network unavailable")]
    Network { provider_id: String },

    #[error("provider error")]
    ProviderError {
        provider_id: String,
        status: Option<u16>,
    },

    #[error("invalid provider response")]
    InvalidResponse { provider_id: String, detail: String },

    #[error("storage error: {0}")]
    Storage(String),

    #[error("not found")]
    NotFound,

    #[error("invalid input")]
    Validation { field: String, detail: String },

    // The Model Desk gets its own variants rather than reusing the provider ones. A market
    // failure falls back to cached values and says so; a chat send has nothing cached to fall
    // back to, so the shared copy would be actively misleading. See AI_POLICY.md §1.
    #[error("model endpoint not configured")]
    AiNotConfigured,

    #[error("model endpoint unreachable")]
    AiUnreachable,

    #[error("model request failed")]
    AiRequestFailed { status: Option<u16> },

    #[error("model returned nothing")]
    AiEmptyResponse,

    /// A `.brewprofile` did not authenticate.
    ///
    /// A wrong password and a tampered file produce the same variant on purpose: distinguishing
    /// them tells an attacker which of the two they achieved. See THREAT_MODEL.md §6.3.
    #[error("profile authentication failed")]
    ProfileAuthFailed,
}

/// The wire shape. `kind` lets the frontend branch; `message` is shown to the user as-is.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub kind: String,
    pub message: String,
    pub provider_id: Option<String>,
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            Self::NotConfigured { .. } => "not_configured",
            Self::RateLimited { .. } => "rate_limited",
            Self::Network { .. } => "network",
            Self::ProviderError { .. } => "provider_error",
            Self::InvalidResponse { .. } => "invalid_response",
            Self::Storage(_) => "storage",
            Self::NotFound => "not_found",
            Self::Validation { .. } => "validation",
            Self::AiNotConfigured => "ai_not_configured",
            Self::AiUnreachable => "ai_unreachable",
            Self::AiRequestFailed { .. } => "ai_request_failed",
            Self::AiEmptyResponse => "ai_empty_response",
            Self::ProfileAuthFailed => "profile_auth_failed",
        }
    }

    /// Deliberately generic where a specific message could leak provider internals.
    fn user_message(&self) -> String {
        match self {
            Self::NotConfigured { .. } => {
                "No provider is set up for this data yet. Add one in Settings → Providers.".into()
            }
            Self::RateLimited {
                retry_after_secs, ..
            } => match retry_after_secs {
                Some(secs) => format!(
                    "Provider request limit reached. Showing cached values; retrying in about {secs}s."
                ),
                None => {
                    "Provider request limit reached. Showing cached values while it resets.".into()
                }
            },
            Self::Network { .. } => {
                "Could not reach the provider. Showing the last values stored on this computer."
                    .into()
            }
            Self::ProviderError { .. } => {
                "The provider did not respond as expected. Showing the last known values.".into()
            }
            Self::InvalidResponse { .. } => {
                "The provider sent data this app could not read. Nothing was changed.".into()
            }
            Self::Storage(_) => {
                "The local database could not be read or written. Your data has not been changed."
                    .into()
            }
            Self::NotFound => "That item does not exist.".into(),
            Self::Validation { field, .. } => format!("The value for \"{field}\" is not valid."),
            Self::AiNotConfigured => {
                "No model is set up yet. Add one in Settings \u{2192} AI providers.".into()
            }
            Self::AiUnreachable => {
                "Could not reach the model endpoint. Check that the server is running and that \
                 the address is right. Nothing was sent."
                    .into()
            }
            // The status code stays out of the message for the same reason as the provider
            // case: it describes the endpoint, not anything the user can act on.
            Self::AiRequestFailed { .. } => {
                "The model endpoint returned an error. Nothing was saved to this conversation."
                    .into()
            }
            Self::AiEmptyResponse => {
                "The model returned an empty response. Nothing was saved to this conversation."
                    .into()
            }
            Self::ProfileAuthFailed => {
                "That password did not open the file, or the file has been altered since it was \
                 written. Nothing was imported."
                    .into()
            }
        }
    }

    fn provider_id(&self) -> Option<String> {
        match self {
            Self::NotConfigured { provider_id }
            | Self::RateLimited { provider_id, .. }
            | Self::Network { provider_id }
            | Self::ProviderError { provider_id, .. }
            | Self::InvalidResponse { provider_id, .. } => Some(provider_id.clone()),
            _ => None,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        IpcError {
            kind: self.kind().to_string(),
            message: self.user_message(),
            provider_id: self.provider_id(),
        }
        .serialize(serializer)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(error: rusqlite::Error) -> Self {
        // The SQL text can contain user data; keep it in the log, not in the payload.
        tracing::error!(?error, "sqlite error");
        Self::Storage(error.to_string())
    }
}

impl From<r2d2::Error> for AppError {
    fn from(error: r2d2::Error) -> Self {
        tracing::error!(?error, "connection pool error");
        Self::Storage(error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        tracing::error!(?error, "serialization error");
        Self::Storage(error.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    /// The IPC payload must never carry provider internals — this is the test that keeps
    /// the guarantee in THREAT_MODEL.md §4 honest.
    #[test]
    fn serialized_errors_do_not_leak_internals() {
        let error = AppError::ProviderError {
            provider_id: "finnhub".into(),
            status: Some(401),
        };
        let json = serde_json::to_string(&error).unwrap();

        assert!(json.contains("provider_error"));
        assert!(
            !json.contains("401"),
            "HTTP status must not reach the UI payload"
        );
        assert!(!json.contains("token"));
        assert!(!json.contains("apikey"));
    }

    #[test]
    fn rate_limit_message_includes_retry_hint() {
        let error = AppError::RateLimited {
            provider_id: "coingecko".into(),
            retry_after_secs: Some(45),
        };
        let json = serde_json::to_string(&error).unwrap();
        assert!(json.contains("45s"));
    }
}
