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

/// How the app identifies itself to every provider.
///
/// The contact URL is not decoration. FRED sits behind a WAF that **drops the connection** for
/// a bare `Name/Version` agent — no status code, no body, just a hang until the timeout, which
/// surfaces as "could not reach the provider" and sends you looking at the network rather than
/// at the header. Adding the `(+url)` comment, the long-standing convention for identifying an
/// automated client, is what makes the request acceptable. Verified against FRED directly:
/// `BrewTerminal/0.2.0` is refused three times out of three, this string succeeds three out of
/// three.
///
/// Note what this is *not*: a browser string. A Chrome user agent is also refused by that same
/// WAF, and pretending to be a browser to get past a bot policy would be the sort of thing
/// ADR-008 rules out on purpose. This says exactly what the client is and where to complain
/// about it.
pub(crate) const USER_AGENT: &str = concat!(
    "BrewTerminal/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/KleivinX/Brew-Terminal)"
);

pub fn build_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .user_agent(USER_AGENT)
        .https_only(true)
        .build()
        .map_err(|error| {
            tracing::error!(?error, "could not build the HTTP client");
            AppError::Storage("The network client could not be created.".into())
        })
}

/// How long a large download may go without receiving any bytes before it is abandoned.
///
/// This replaces the total timeout rather than adding to it, and the distinction is the whole
/// point of `build_download_client`.
const DOWNLOAD_STALL_TIMEOUT: Duration = Duration::from_secs(60);

/// A client for large file downloads.
///
/// Separate from `build_client` because of one incompatible requirement: `REQUEST_TIMEOUT` is a
/// cap on the *entire* request including the body, which is right for a JSON API response and
/// impossible for model weights. Fifteen seconds cannot fetch 470 MB on any domestic
/// connection, and the failure looks like a network error rather than a misconfiguration —
/// which is exactly how it presented before an end-to-end test caught it.
///
/// So there is no total timeout here. A stalled transfer is still caught, by `read_timeout`:
/// the download fails if no bytes arrive for a minute, which is the condition actually worth
/// detecting. Every other guarantee is unchanged — HTTPS only, bounded redirects, the same
/// user agent.
pub fn build_download_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(DOWNLOAD_STALL_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .user_agent(USER_AGENT)
        .https_only(true)
        .build()
        .map_err(|error| {
            tracing::error!(?error, "could not build the download client");
            AppError::Storage("The download client could not be created.".into())
        })
}

#[cfg(test)]
mod user_agent_tests {
    use super::USER_AGENT;

    #[test]
    fn the_agent_names_the_app_and_where_to_reach_it() {
        // Both halves matter: the name is how a provider identifies the traffic, and the
        // contact URL is what FRED's WAF requires before it will answer at all.
        assert!(USER_AGENT.starts_with("BrewTerminal/"));
        assert!(
            USER_AGENT.contains("(+https://"),
            "dropping the contact URL silently breaks every FRED request: {USER_AGENT}"
        );
    }

    #[test]
    fn the_agent_does_not_impersonate_a_browser() {
        // Getting past a bot policy by pretending to be Chrome is the kind of thing ADR-008
        // exists to prevent, and it does not even work on the provider that prompted this.
        for token in ["Mozilla", "AppleWebKit", "Chrome", "Safari", "Gecko"] {
            assert!(
                !USER_AGENT.contains(token),
                "the user agent must identify the app, not imitate a browser"
            );
        }
    }

    #[test]
    fn the_agent_carries_the_running_version() {
        assert!(USER_AGENT.contains(env!("CARGO_PKG_VERSION")));
    }
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

/// Performs a GET and returns the raw body.
///
/// Separate from `get_json` because feeds are XML and the caller parses them itself. Every
/// other guarantee is identical — the same client, the same timeout, the same size cap, the
/// same redirect limit, the same redacted logging.
///
/// The cap matters more here than for JSON: a feed is a URL the *user* supplied, so the body
/// on the other end is entirely outside this project's control.
pub async fn get_bytes(
    client: &reqwest::Client,
    provider_id: &str,
    url: &str,
) -> AppResult<Vec<u8>> {
    tracing::debug!(provider = provider_id, url = %redact_url(url), "provider request");

    let response = client.get(url).send().await.map_err(|error| {
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

    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_builds_with_https_enforced() {
        assert!(build_client().is_ok());
    }

    #[test]
    fn the_download_client_builds_and_enforces_https() {
        assert!(build_download_client().is_ok());
    }

    #[tokio::test]
    async fn the_download_client_still_refuses_plain_http() {
        // No total timeout does not mean no rules: the same https_only guarantee applies.
        let client = build_download_client().unwrap();
        let result = get_bytes(&client, "test", "http://example.com/model.gguf").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn plain_http_is_refused_for_bytes_too() {
        // The feed adapter takes user-supplied URLs, so this path must refuse http:// for
        // exactly the same reason get_json does.
        let client = build_client().unwrap();
        let result = get_bytes(&client, "test", "http://example.com/feed.xml").await;
        assert!(result.is_err());
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
