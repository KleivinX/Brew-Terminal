use async_trait::async_trait;

use crate::error::AppResult;
use crate::models::{CommunityFilter, CommunityPost, ProviderHealth};
use crate::providers::CommunityProvider;

const COMMUNITY_FIXTURE: &str = include_str!("../../../../content/fixtures/community.json");

pub const MOCK_COMMUNITY_ID: &str = "mock-community";
pub const MOCK_COMMUNITY_NAME: &str = "Mock community (fixtures)";

pub struct MockCommunityProvider {
    posts: Vec<CommunityPost>,
}

impl MockCommunityProvider {
    pub fn new() -> Self {
        let posts: Vec<CommunityPost> =
            serde_json::from_str(COMMUNITY_FIXTURE).expect("community.json is malformed");

        // Fixtures pass through the same validation a live provider's response would — the
        // https-only check especially, which is what stops a `javascript:` link ever reaching
        // a rendered anchor. See THREAT_MODEL.md §3.
        let mut posts: Vec<CommunityPost> = posts
            .into_iter()
            .filter(|post| match post.validate() {
                Ok(()) => true,
                Err(reason) => {
                    tracing::warn!(id = %post.id, reason, "dropping invalid fixture post");
                    false
                }
            })
            .collect();

        rebase_to_now(&mut posts);
        Self { posts }
    }
}

impl Default for MockCommunityProvider {
    fn default() -> Self {
        Self::new()
    }
}

/// Shifts fixture timestamps so the newest post is roughly "now", preserving relative spacing.
/// Same reasoning as the mock news provider: a frozen base date makes every post read as
/// "last yr" in the UI.
fn rebase_to_now(posts: &mut [CommunityPost]) {
    let Some(newest) = posts.iter().filter_map(|p| p.posted_at).max() else {
        return;
    };
    let offset = crate::models::now_epoch_secs() - newest - 120;
    for post in posts.iter_mut() {
        if let Some(posted) = post.posted_at {
            post.posted_at = Some(posted + offset);
        }
    }
}

#[async_trait]
impl CommunityProvider for MockCommunityProvider {
    fn id(&self) -> &str {
        MOCK_COMMUNITY_ID
    }

    fn display_name(&self) -> &str {
        MOCK_COMMUNITY_NAME
    }

    fn attribution(&self) -> &str {
        "Fixture data. Not real community discussion."
    }

    async fn health(&self) -> ProviderHealth {
        ProviderHealth::Ok
    }

    async fn posts(&self, filter: &CommunityFilter) -> AppResult<Vec<CommunityPost>> {
        let mut posts = self.posts.clone();

        // Newest first. Deliberately *not* by score: ordering by engagement would be the app
        // deciding which opinions matter, which is the one thing this feature must not do.
        posts.sort_by_key(|post| std::cmp::Reverse(post.posted_at));
        posts.truncate(filter.limit.clamp(1, 100) as usize);
        Ok(posts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn serves_validated_fixture_posts() {
        let provider = MockCommunityProvider::new();
        let posts = provider
            .posts(&CommunityFilter {
                asset_id: None,
                limit: 50,
            })
            .await
            .unwrap();

        assert!(posts.len() >= 5);
        for post in &posts {
            assert!(post.validate().is_ok());
            assert!(post.url.starts_with("https://"));
        }
    }

    #[tokio::test]
    async fn orders_by_recency_not_by_engagement() {
        let provider = MockCommunityProvider::new();
        let posts = provider
            .posts(&CommunityFilter {
                asset_id: None,
                limit: 50,
            })
            .await
            .unwrap();

        let times: Vec<i64> = posts.iter().filter_map(|p| p.posted_at).collect();
        let mut sorted = times.clone();
        sorted.sort_by(|a, b| b.cmp(a));
        assert_eq!(times, sorted, "posts must be newest-first");

        // And explicitly not by score: the top post by score is not necessarily first.
        let scores: Vec<i64> = posts.iter().filter_map(|p| p.score).collect();
        let mut by_score = scores.clone();
        by_score.sort_by(|a, b| b.cmp(a));
        assert_ne!(
            scores, by_score,
            "the fixture must not accidentally be in score order, or this proves nothing"
        );
    }

    #[tokio::test]
    async fn respects_the_limit() {
        let provider = MockCommunityProvider::new();
        let posts = provider
            .posts(&CommunityFilter {
                asset_id: None,
                limit: 3,
            })
            .await
            .unwrap();
        assert_eq!(posts.len(), 3);
    }
}
