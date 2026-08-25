use async_trait::async_trait;

use crate::error::AppResult;
use crate::models::{NewsArticle, NewsFilter, ProviderHealth};
use crate::providers::NewsProvider;

const NEWS_FIXTURE: &str = include_str!("../../../../content/fixtures/news.json");

pub const MOCK_NEWS_ID: &str = "mock-news";
pub const MOCK_NEWS_NAME: &str = "Mock news (fixtures)";

pub struct MockNewsProvider {
    articles: Vec<NewsArticle>,
}

impl MockNewsProvider {
    pub fn new() -> Self {
        let articles: Vec<NewsArticle> =
            serde_json::from_str(NEWS_FIXTURE).expect("news.json is malformed");

        // Fixtures pass through the same validation as a live provider's response — including
        // the https-only URL check, which is what stops a `javascript:` link ever reaching a
        // rendered anchor. See THREAT_MODEL.md §3.
        let mut articles: Vec<NewsArticle> = articles
            .into_iter()
            .filter(|article| match article.validate() {
                Ok(()) => true,
                Err(reason) => {
                    tracing::warn!(id = %article.id, reason, "dropping invalid fixture article");
                    false
                }
            })
            .collect();

        rebase_to_now(&mut articles);

        Self { articles }
    }
}

impl Default for MockNewsProvider {
    fn default() -> Self {
        Self::new()
    }
}

/// Shifts fixture timestamps so the newest article is roughly "now".
///
/// The JSON keeps fixed timestamps so tests stay deterministic, but a frozen base date drifts
/// into the past and the UI ends up rendering every headline as "last yr". Rebasing preserves
/// the relative spacing between articles while keeping them plausibly recent.
fn rebase_to_now(articles: &mut [NewsArticle]) {
    let Some(newest) = articles.iter().filter_map(|a| a.published_at).max() else {
        return;
    };

    // Land the newest story a couple of minutes ago rather than exactly now, so relative
    // times never read as being in the future on a slightly skewed clock.
    let offset = crate::models::now_epoch_secs() - newest - 120;

    for article in articles.iter_mut() {
        if let Some(published) = article.published_at {
            article.published_at = Some(published + offset);
        }
    }
}

#[async_trait]
impl NewsProvider for MockNewsProvider {
    fn id(&self) -> &str {
        MOCK_NEWS_ID
    }

    fn display_name(&self) -> &str {
        MOCK_NEWS_NAME
    }

    fn attribution(&self) -> &str {
        "Development fixtures. Not real reporting."
    }

    async fn health(&self) -> ProviderHealth {
        ProviderHealth::Ok
    }

    async fn news(&self, filter: &NewsFilter) -> AppResult<Vec<NewsArticle>> {
        let category = filter.category.to_lowercase();

        let mut articles: Vec<NewsArticle> = self
            .articles
            .iter()
            .filter(|article| {
                category == "all"
                    || serde_json::to_value(article.category)
                        .ok()
                        .and_then(|v| v.as_str().map(str::to_string))
                        .is_some_and(|c| c == category)
            })
            .cloned()
            .collect();

        // Newest first. Articles without a date sort last rather than being dropped —
        // a missing timestamp is a provider gap, not a reason to hide the story.
        articles.sort_by(|a, b| {
            b.published_at
                .unwrap_or(0)
                .cmp(&a.published_at.unwrap_or(0))
        });
        articles.truncate(filter.limit as usize);

        Ok(articles)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter(category: &str) -> NewsFilter {
        NewsFilter {
            category: category.into(),
            asset_id: None,
            limit: 20,
        }
    }

    #[tokio::test]
    async fn loads_and_sorts_newest_first() {
        let provider = MockNewsProvider::new();
        let articles = provider.news(&filter("all")).await.unwrap();

        assert!(!articles.is_empty());
        for pair in articles.windows(2) {
            assert!(
                pair[0].published_at.unwrap_or(0) >= pair[1].published_at.unwrap_or(0),
                "articles must be newest first"
            );
        }
    }

    #[tokio::test]
    async fn filters_by_category() {
        let provider = MockNewsProvider::new();
        let crypto = provider.news(&filter("crypto")).await.unwrap();

        assert!(!crypto.is_empty());
        for article in crypto {
            assert!(matches!(
                article.category,
                crate::models::NewsCategory::Crypto
            ));
        }
    }

    #[tokio::test]
    async fn respects_the_limit() {
        let provider = MockNewsProvider::new();
        let articles = provider
            .news(&NewsFilter {
                category: "all".into(),
                asset_id: None,
                limit: 3,
            })
            .await
            .unwrap();
        assert_eq!(articles.len(), 3);
    }

    #[tokio::test]
    async fn timestamps_are_rebased_to_be_recent() {
        let provider = MockNewsProvider::new();
        let articles = provider.news(&filter("all")).await.unwrap();
        let now = crate::models::now_epoch_secs();

        let newest = articles[0].published_at.unwrap();
        assert!(newest <= now, "no article may be dated in the future");
        assert!(
            now - newest < 3600,
            "the newest story should be within the hour"
        );

        let oldest = articles.last().unwrap().published_at.unwrap();
        assert!(
            newest > oldest,
            "relative spacing between articles must be preserved"
        );
    }

    #[tokio::test]
    async fn every_fixture_url_is_https() {
        let provider = MockNewsProvider::new();
        for article in provider.news(&filter("all")).await.unwrap() {
            assert!(article.url.starts_with("https://"), "got {}", article.url);
        }
    }
}
