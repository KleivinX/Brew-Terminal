//! Checking whether a newer release exists.
//!
//! Three constraints shape this, all from the same promise — *the app makes no request you did
//! not cause*:
//!
//! * **It only ever runs when the user presses the button.** No poll on launch, no timer, no
//!   check folded into some other request.
//! * **It downloads nothing.** The result is a version number and a link. Installing an update
//!   is the user going to the release page themselves, which is also the only honest option
//!   while the app is unsigned.
//! * **It sends nothing about the user.** A plain GET to a public endpoint: no identifier, no
//!   install id, no count. GitHub sees an IP address and the user agent, which is the floor for
//!   any HTTP request and is stated in the UI.

use serde::Deserialize;

use crate::error::AppResult;
use crate::providers::http;
use crate::state::AppState;

/// The releases endpoint for this project.
const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/KleivinX/Brew-Terminal/releases/latest";

const PROVIDER_ID: &str = "updates";

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    published_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    pub latest_version: String,
    /// `true` only when the published version is genuinely newer and both parsed cleanly.
    pub update_available: bool,
    /// `true` when a version string could not be read, so the UI can say "could not tell"
    /// rather than "you are up to date".
    pub comparison_failed: bool,
    pub release_url: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
}

/// A three-part version, with any prefix or suffix discarded.
///
/// Deliberately not a full semver implementation. Pre-release ordering (`1.0.0-rc.1` before
/// `1.0.0`) is not modelled, because getting it subtly wrong is worse than not claiming it:
/// `parse_version` returns `None` on anything it cannot read in full, and an unreadable version
/// reports as "could not tell" instead of guessing.
fn parse_version(raw: &str) -> Option<(u32, u32, u32)> {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);

    // Stop at the first pre-release or build separator rather than trying to interpret it.
    let core = trimmed
        .split(['-', '+'])
        .next()
        .unwrap_or_default()
        .trim_end_matches('.');

    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next().unwrap_or("0").parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;

    // A fourth component means this is not the shape we think it is.
    if parts.next().is_some() {
        return None;
    }

    Some((major, minor, patch))
}

pub async fn check(state: &AppState) -> AppResult<UpdateCheck> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    let release: GitHubRelease = http::get_json(
        &state.registry.http_client(),
        PROVIDER_ID,
        LATEST_RELEASE_URL,
        None,
    )
    .await?;

    let current = parse_version(&current_version);
    let latest = parse_version(&release.tag_name);

    let (update_available, comparison_failed) = match (current, latest) {
        (Some(current), Some(latest)) => (latest > current, false),
        _ => (false, true),
    };

    Ok(UpdateCheck {
        current_version,
        latest_version: release.tag_name,
        update_available,
        comparison_failed,
        release_url: release.html_url,
        published_at: release.published_at,
        prerelease: release.prerelease,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_ordinary_versions_with_or_without_a_v() {
        assert_eq!(parse_version("0.1.0"), Some((0, 1, 0)));
        assert_eq!(parse_version("v0.1.0"), Some((0, 1, 0)));
        assert_eq!(parse_version("  v1.2.3  "), Some((1, 2, 3)));
        assert_eq!(parse_version("2.0"), Some((2, 0, 0)));
    }

    #[test]
    fn discards_a_prerelease_or_build_suffix() {
        assert_eq!(parse_version("v1.2.3-rc.1"), Some((1, 2, 3)));
        assert_eq!(parse_version("1.2.3+build7"), Some((1, 2, 3)));
    }

    #[test]
    fn refuses_anything_it_cannot_read_in_full() {
        // Returning None here is what makes the UI say "could not tell" rather than
        // reporting a confident and wrong answer.
        assert_eq!(parse_version("nightly"), None);
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("1.2.3.4"), None);
        assert_eq!(parse_version("v1.x.0"), None);
    }

    #[test]
    fn ordering_is_by_component_not_by_string() {
        // The case a string comparison gets wrong: "0.10.0" sorts before "0.9.0" as text.
        assert!(parse_version("0.10.0") > parse_version("0.9.0"));
        assert!(parse_version("1.0.0") > parse_version("0.99.99"));
        assert!(parse_version("0.1.10") > parse_version("0.1.9"));
    }

    #[test]
    fn the_running_version_is_readable() {
        // If this fails, every update check would report "could not tell".
        assert!(
            parse_version(env!("CARGO_PKG_VERSION")).is_some(),
            "the crate version must be parseable by the same function that reads tags"
        );
    }
}
