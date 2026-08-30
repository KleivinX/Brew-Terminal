use serde::{Deserialize, Serialize};

/// One post from a public discussion platform.
///
/// The framing matters as much as the fields. This is **quoted material**, not a signal: the
/// app carries a post's own numbers because they are facts the platform reports, and refuses
/// to derive anything from them. There is no sentiment score, no ranking, no "trending" —
/// anything that aggregates opinion into a number is a verdict, and the app has no basis for
/// one. See PRODUCT_SCOPE_V0_1.md §6 and UI_MAP.md.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct CommunityPost {
    pub id: String,
    pub title: String,
    pub url: String,
    pub author: Option<String>,
    /// Where it was posted, in that platform's own words: `r/investing`, a forum name.
    pub community: Option<String>,
    /// The platform's own number. Reported, never interpreted.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub score: Option<i64>,
    #[cfg_attr(test, ts(type = "number | null"))]
    pub comment_count: Option<i64>,
    /// Unix epoch seconds. `None` when the provider gives no date — one is never invented.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub posted_at: Option<i64>,
    pub source_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct CommunityFilter {
    pub asset_id: Option<String>,
    #[cfg_attr(test, ts(type = "number"))]
    pub limit: u32,
}

impl CommunityPost {
    /// Untrusted input, and more so than most: this is text written by strangers on the
    /// internet, arriving through a provider that may itself be broken.
    pub fn validate(&self) -> Result<(), String> {
        if self.title.trim().is_empty() {
            return Err("empty title".into());
        }
        // Only https links are ever opened, and they go to the OS browser rather than the app
        // webview — see THREAT_MODEL.md §3.
        if !self.url.starts_with("https://") {
            return Err(format!("non-https url rejected for post {}", self.id));
        }
        if self.title.chars().count() > 500 {
            return Err("title exceeds length cap".into());
        }
        if let Some(author) = &self.author {
            if author.chars().count() > 100 {
                return Err("author name exceeds length cap".into());
            }
        }
        if let Some(community) = &self.community {
            if community.chars().count() > 100 {
                return Err("community name exceeds length cap".into());
            }
        }
        if let Some(posted) = self.posted_at {
            // Reject timestamps outside a plausible window rather than rendering "in 31000 years".
            if !(946_684_800..=4_102_444_800).contains(&posted) {
                return Err(format!("implausible timestamp {posted}"));
            }
        }
        // A negative engagement count is not a thing any platform reports; treat it as a
        // broken adapter rather than rendering it.
        if self.score.is_some_and(|s| s < -100_000) || self.comment_count.is_some_and(|c| c < 0) {
            return Err("implausible engagement counts".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn post(url: &str) -> CommunityPost {
        CommunityPost {
            id: "p1".into(),
            title: "How does an index fund actually track its index?".into(),
            url: url.into(),
            author: Some("someone".into()),
            community: Some("r/investing".into()),
            score: Some(42),
            comment_count: Some(7),
            posted_at: Some(1_755_820_800),
            source_name: "Example forum".into(),
        }
    }

    #[test]
    fn rejects_non_https_urls() {
        assert!(post("http://example.org/x").validate().is_err());
        assert!(post("javascript:alert(1)").validate().is_err());
        assert!(post("file:///etc/passwd").validate().is_err());
        assert!(post("https://example.org/x").validate().is_ok());
    }

    #[test]
    fn rejects_implausible_timestamps() {
        let mut p = post("https://example.org/x");
        p.posted_at = Some(99_999_999_999);
        assert!(p.validate().is_err());
    }

    #[test]
    fn rejects_oversized_strings() {
        let mut p = post("https://example.org/x");
        p.title = "x".repeat(501);
        assert!(p.validate().is_err());

        let mut p = post("https://example.org/x");
        p.author = Some("x".repeat(101));
        assert!(p.validate().is_err());

        let mut p = post("https://example.org/x");
        p.community = Some("x".repeat(101));
        assert!(p.validate().is_err());
    }

    #[test]
    fn rejects_impossible_engagement_counts() {
        let mut p = post("https://example.org/x");
        p.comment_count = Some(-1);
        assert!(p.validate().is_err());
    }

    /// The model carries no derived field. This is the test that stops a "sentiment" or
    /// "trending" score being added without the conversation that would have to precede it.
    #[test]
    fn the_model_has_no_derived_verdict_field() {
        let json = serde_json::to_string(&post("https://example.org/x")).unwrap();
        let lowered = json.to_lowercase();

        for banned in [
            "sentiment",
            "trending",
            "rank",
            "signal",
            "bullish",
            "bearish",
            "hot",
        ] {
            assert!(
                !lowered.contains(banned),
                "community posts must not carry a `{banned}` field"
            );
        }
    }
}
