use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "lowercase")]
pub enum NewsCategory {
    Crypto,
    Stocks,
    Macro,
    Other,
}

/// How an article came to be associated with an asset.
///
/// This is a safety mechanism, not bookkeeping. Only `ProviderTagged` links may be described
/// as being *about* an asset. `TimeAdjacent` articles are rendered under copy that says they
/// were published near a price move, with no causal claim — see PRODUCT_SCOPE_V0_1.md §6.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NewsLinkKind {
    ProviderTagged,
    SymbolMatch,
    TimeAdjacent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct NewsArticle {
    pub id: String,
    pub title: String,
    pub url: String,
    pub summary: Option<String>,
    pub source_name: String,
    pub category: NewsCategory,
    /// Unix epoch seconds. `None` when the provider gives no date — we never invent one.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub published_at: Option<i64>,
}

/// A user-configured RSS or Atom source.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct NewsFeed {
    pub id: String,
    pub title: String,
    pub url: String,
    pub category: NewsCategory,
    pub enabled: bool,
    /// True for the small set seeded on first run. Surfaced so the UI can explain why a feed
    /// is present without the user having added it.
    pub is_default: bool,
    #[cfg_attr(test, ts(type = "number"))]
    pub added_at: i64,
    /// When this feed last returned something parseable, or `None` if it never has.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub last_ok_at: Option<i64>,
    /// A short reason for the last failure. Never a URL, never a response body.
    pub last_error: Option<String>,
}

/// The longest feed URL accepted. Well past any real one; stops a pathological paste.
const MAX_FEED_URL_LEN: usize = 2048;
const MAX_FEED_TITLE_LEN: usize = 120;

impl NewsFeed {
    /// Checks a URL the user typed or pasted.
    ///
    /// HTTPS only, matching the rule the shared HTTP client enforces anyway — checking here
    /// too means the user is told why at the moment they add it, rather than seeing a feed
    /// that silently never loads. See THREAT_MODEL.md §3.
    pub fn validate_url(url: &str) -> Result<url::Url, String> {
        let trimmed = url.trim();
        if trimmed.is_empty() {
            return Err("Enter a feed address.".into());
        }
        if trimmed.len() > MAX_FEED_URL_LEN {
            return Err("That address is too long to be a feed.".into());
        }

        let parsed = url::Url::parse(trimmed)
            .map_err(|_| "That does not look like a web address.".to_string())?;

        if parsed.scheme() != "https" {
            return Err("A feed address must start with https://".into());
        }
        if parsed.host_str().is_none() {
            return Err("That address has no host.".into());
        }

        Ok(parsed)
    }

    pub fn validate_title(title: &str) -> Result<String, String> {
        let trimmed = title.trim();
        if trimmed.len() > MAX_FEED_TITLE_LEN {
            return Err("That name is too long.".into());
        }
        Ok(trimmed.to_string())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct NewsFilter {
    /// `"all"` or a `NewsCategory` value.
    pub category: String,
    pub asset_id: Option<String>,
    #[cfg_attr(test, ts(type = "number"))]
    pub limit: u32,
}

impl NewsArticle {
    /// Untrusted input: a hostile or broken provider can send any string here.
    pub fn validate(&self) -> Result<(), String> {
        if self.title.trim().is_empty() {
            return Err("empty title".into());
        }
        // Only https links are ever opened, and they go to the OS browser rather than the
        // app webview — see THREAT_MODEL.md §3.
        if !self.url.starts_with("https://") {
            return Err(format!("non-https url rejected for article {}", self.id));
        }
        if self.title.len() > 500 {
            return Err("title exceeds length cap".into());
        }
        if let Some(published) = self.published_at {
            // Reject timestamps outside a plausible window rather than rendering "in 31000 years".
            if !(946_684_800..=4_102_444_800).contains(&published) {
                return Err(format!("implausible timestamp {published}"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn article(url: &str) -> NewsArticle {
        NewsArticle {
            id: "a1".into(),
            title: "A headline".into(),
            url: url.into(),
            summary: None,
            source_name: "Wire".into(),
            category: NewsCategory::Macro,
            published_at: Some(1_755_820_800),
        }
    }

    #[test]
    fn rejects_non_https_urls() {
        assert!(article("http://example.org/x").validate().is_err());
        assert!(article("javascript:alert(1)").validate().is_err());
        assert!(article("file:///etc/passwd").validate().is_err());
        assert!(article("https://example.org/x").validate().is_ok());
    }

    #[test]
    fn rejects_implausible_timestamps() {
        let mut a = article("https://example.org/x");
        a.published_at = Some(99_999_999_999);
        assert!(a.validate().is_err());
    }

    #[test]
    fn a_feed_url_must_be_https_and_parseable() {
        assert!(NewsFeed::validate_url("https://example.org/feed.xml").is_ok());

        // The same rule the HTTP client enforces, applied where the user can see it.
        assert!(NewsFeed::validate_url("http://example.org/feed.xml").is_err());
        assert!(NewsFeed::validate_url("javascript:alert(1)").is_err());
        assert!(NewsFeed::validate_url("file:///etc/passwd").is_err());
        assert!(NewsFeed::validate_url("not a url").is_err());
        assert!(NewsFeed::validate_url("   ").is_err());
    }

    #[test]
    fn a_feed_url_is_length_capped() {
        let long = format!("https://example.org/{}", "x".repeat(3000));
        assert!(NewsFeed::validate_url(&long).is_err());
    }

    #[test]
    fn rejects_oversized_titles() {
        let mut a = article("https://example.org/x");
        a.title = "x".repeat(501);
        assert!(a.validate().is_err());
    }
}
