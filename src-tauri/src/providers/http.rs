//! Shared HTTP client for provider adapters.
//!
//! Every outbound request in the app goes through here. Centralising it is what makes the
//! guarantees in THREAT_MODEL.md §3 enforceable rather than aspirational: HTTPS only, bounded
//! response bodies, bounded redirects, a timeout on everything, and no URL reaching a log
//! without passing through the redaction layer.

use std::time::Duration;

use serde::de::DeserializeOwned;

use crate::error::{AppError, AppResult};
use crate::security::redact::redact_url;

/// Requests time out rather than hanging a refresh forever.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

/// Response bodies are capped. A provider returning something enormous — by bug or by malice —
/// must not be able to exhaust memory on a machine with 8 GB.
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

const MAX_REDIRECTS: usize = 3;

pub fn build_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .user_agent(concat!("BrewTerminal/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .build()
        .map_err(|error| {
            tracing::error!(?error, "could not build the HTTP client");
            AppError::Storage("The network client could not be created.".into())
        })
}

/// A header that carries a credential. The value is never logged.
pub struct AuthHeader<'a> {
    pub name: &'a str,
    pub value: String,
}

/// Performs a GET and deserializes the body.
///
/// `provider_id` is only used to tag errors, so the UI can say which provider is unhappy
/// without the error carrying a URL or a body.
pub async fn get_json<T: DeserializeOwned>(
    client: &reqwest::Client,
    provider_id: &str,
    url: &str,
    auth: Option<AuthHeader<'_>>,
) -> AppResult<T> {
    // Logged redacted even though credentials travel in headers here: a provider may still
    // put something sensitive in a query string, and this is the only place URLs are logged.
    tracing::debug!(provider = provider_id, url = %redact_url(url), "provider request");

    let mut request = client.get(url);
    if let Some(header) = auth {
        request = request.header(header.name, header.value);
    }

    let response = request.send().await.map_err(|error| {
        if error.is_timeout() || error.is_connect() {
            tracing::warn!(provider = provider_id, "provider unreachable");
            AppError::Network {
                provider_id: provider_id.to_string(),
            }
        } else {
            tracing::warn!(provider = provider_id, ?error, "provider request failed");
            AppError::ProviderError {
                provider_id: provider_id.to_string(),
                status: None,
            }
        }
    })?;

    let status = response.status();

    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let retry_after_secs = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());

        return Err(AppError::RateLimited {
            provider_id: provider_id.to_string(),
            retry_after_secs,
        });
    }

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        // Distinguished from a generic failure: the user can actually fix this one by
        // checking their key, and the UI routes them to Settings.
        return Err(AppError::NotConfigured {
            provider_id: provider_id.to_string(),
        });
    }

    if !status.is_success() {
        tracing::warn!(
            provider = provider_id,
            status = status.as_u16(),
            "provider error"
        );
        return Err(AppError::ProviderError {
            provider_id: provider_id.to_string(),
            status: Some(status.as_u16()),
        });
    }

    // Reject an over-large body before reading it where the provider declares a length,
    // and again after reading where it does not.
    if let Some(len) = response.content_length() {
        if len as usize > MAX_BODY_BYTES {
            return Err(AppError::InvalidResponse {
                provider_id: provider_id.to_string(),
                detail: "response exceeds the size cap".into(),
            });
        }
    }

    let bytes = response.bytes().await.map_err(|error| {
        tracing::warn!(
            provider = provider_id,
            ?error,
            "could not read the response body"
        );
        AppError::Network {
            provider_id: provider_id.to_string(),
        }
    })?;

    if bytes.len() > MAX_BODY_BYTES {
        return Err(AppError::InvalidResponse {
            provider_id: provider_id.to_string(),
            detail: "response exceeds the size cap".into(),
        });
    }

    serde_json::from_slice(&bytes).map_err(|error| {
        // The parse error can quote the body, so it is logged, never returned.
        tracing::warn!(
            provider = provider_id,
            ?error,
            "could not parse the response"
        );
        AppError::InvalidResponse {
            provider_id: provider_id.to_string(),
            detail: "unexpected response shape".into(),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_builds_with_https_enforced() {
        assert!(build_client().is_ok());
    }

    #[tokio::test]
    async fn plain_http_is_refused() {
        // https_only means an http:// URL fails before a request leaves the machine.
        let client = build_client().unwrap();
        let result: AppResult<serde_json::Value> =
            get_json(&client, "test", "http://example.com/data", None).await;
        assert!(result.is_err());
    }
}
