use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[serde(rename_all = "camelCase")]
pub struct NewsArticle {
    pub id: String,
    pub title: String,
    pub url: String,
    pub summary: Option<String>,
    pub source_name: String,
    pub category: NewsCategory,
    /// Unix epoch seconds. `None` when the provider gives no date — we never invent one.
    pub published_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsFilter {
    /// `"all"` or a `NewsCategory` value.
    pub category: String,
    pub asset_id: Option<String>,
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
    fn rejects_oversized_titles() {
        let mut a = article("https://example.org/x");
        a.title = "x".repeat(501);
        assert!(a.validate().is_err());
    }
}
