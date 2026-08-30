//! Managing the user's news feed list.
//!
//! Adding a feed is deliberately a two-step affair: the address is validated, then actually
//! fetched and parsed before it is stored. A feed that is saved and only fails later leaves
//! the user guessing whether they typed it wrong or the publisher is down.

use crate::db::repo_news_feeds;
use crate::error::{AppError, AppResult};
use crate::models::{NewsCategory, NewsFeed};
use crate::providers::http;
use crate::providers::live::rss;
use crate::state::{with_db, AppState};

/// What a feed looked like when it was checked, before it is saved.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct FeedPreview {
    /// The feed's own title, so the UI can offer it instead of making the user invent one.
    pub title: Option<String>,
    #[cfg_attr(test, ts(type = "number"))]
    pub item_count: usize,
    /// The most recent headline, as proof the feed really is what the user expected.
    pub newest_title: Option<String>,
}

pub async fn list(state: &AppState) -> AppResult<Vec<NewsFeed>> {
    with_db(state.pool.clone(), |conn| repo_news_feeds::list(conn)).await
}

/// Fetches and parses a feed without storing anything.
pub async fn preview(state: &AppState, url: String) -> AppResult<FeedPreview> {
    let parsed_url = NewsFeed::validate_url(&url).map_err(|detail| AppError::Validation {
        field: "url".into(),
        detail,
    })?;

    let bytes = http::get_bytes(
        &state.registry.http_client(),
        rss::RSS_PROVIDER_ID,
        parsed_url.as_str(),
    )
    .await?;

    let feed = feed_rs::parser::parse(bytes.as_slice()).map_err(|error| {
        // The parse error can quote the document, so it is logged and not returned.
        tracing::warn!(?error, "a candidate feed did not parse");
        AppError::Validation {
            field: "url".into(),
            detail: "That address did not return a readable RSS or Atom feed.".into(),
        }
    })?;

    let title = feed
        .title
        .as_ref()
        .map(|t| rss::to_plain_text(&t.content))
        .filter(|t| !t.trim().is_empty());

    let newest_title = feed
        .entries
        .first()
        .and_then(|e| e.title.as_ref())
        .map(|t| rss::to_plain_text(&t.content))
        .filter(|t| !t.trim().is_empty());

    Ok(FeedPreview {
        title,
        item_count: feed.entries.len(),
        newest_title,
    })
}

/// Validates, fetches, then stores.
pub async fn add(
    state: &AppState,
    url: String,
    title: String,
    category: NewsCategory,
) -> AppResult<NewsFeed> {
    let parsed_url = NewsFeed::validate_url(&url).map_err(|detail| AppError::Validation {
        field: "url".into(),
        detail,
    })?;
    let title = NewsFeed::validate_title(&title).map_err(|detail| AppError::Validation {
        field: "title".into(),
        detail,
    })?;

    // Proves it works before it is saved, and gives us a title if the user left it blank.
    let checked = preview(state, parsed_url.to_string()).await?;
    let title = if title.is_empty() {
        checked.title.unwrap_or_default()
    } else {
        title
    };

    let stored_url = parsed_url.to_string();
    with_db(state.pool.clone(), move |conn| {
        repo_news_feeds::add(conn, &title, &stored_url, category)
    })
    .await
}

pub async fn remove(state: &AppState, feed_id: String) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_news_feeds::remove(conn, &feed_id)
    })
    .await
}

pub async fn set_enabled(state: &AppState, feed_id: String, enabled: bool) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        repo_news_feeds::set_enabled(conn, &feed_id, enabled)
    })
    .await
}

/// Restores any shipped default the user removed.
pub async fn restore_defaults(state: &AppState) -> AppResult<Vec<NewsFeed>> {
    with_db(state.pool.clone(), |conn| {
        // Clearing the tombstones is what makes this a restore rather than a no-op — seeding
        // deliberately skips anything recorded as removed.
        conn.execute("DELETE FROM news_feed_removals", [])?;
        repo_news_feeds::seed_defaults(conn, rss::DEFAULT_FEEDS)?;
        repo_news_feeds::list(conn)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    #[tokio::test]
    async fn the_shipped_defaults_are_seeded_on_first_run() {
        let (state, _dir) = state();
        let feeds = list(&state).await.unwrap();

        assert_eq!(feeds.len(), rss::DEFAULT_FEEDS.len());
        assert!(feeds.iter().all(|f| f.is_default));
        assert!(feeds.iter().all(|f| f.enabled));
    }

    #[tokio::test]
    async fn a_feed_address_must_be_https_before_any_request_is_made() {
        let (state, _dir) = state();

        // Rejected on the address alone — no network call is attempted.
        let result = add(
            &state,
            "http://example.org/feed.xml".into(),
            "X".into(),
            NewsCategory::Crypto,
        )
        .await;

        assert!(matches!(result, Err(AppError::Validation { .. })));
        assert_eq!(list(&state).await.unwrap().len(), rss::DEFAULT_FEEDS.len());
    }

    #[tokio::test]
    async fn removing_a_default_sticks_across_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();

        let first = list(&state).await.unwrap()[0].clone();
        remove(&state, first.id.clone()).await.unwrap();
        drop(state);

        // Re-bootstrapping is what a relaunch does, seeding included.
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        let feeds = list(&state).await.unwrap();

        assert_eq!(feeds.len(), rss::DEFAULT_FEEDS.len() - 1);
        assert!(feeds.iter().all(|f| f.url != first.url));
    }

    #[tokio::test]
    async fn restoring_defaults_brings_back_a_removed_one() {
        let (state, _dir) = state();

        let first = list(&state).await.unwrap()[0].clone();
        remove(&state, first.id).await.unwrap();

        let restored = restore_defaults(&state).await.unwrap();
        assert_eq!(restored.len(), rss::DEFAULT_FEEDS.len());
    }

    #[tokio::test]
    async fn disabling_a_feed_keeps_it_in_the_list_but_out_of_fetching() {
        let (state, _dir) = state();
        let first = list(&state).await.unwrap()[0].clone();

        set_enabled(&state, first.id.clone(), false).await.unwrap();

        let feeds = list(&state).await.unwrap();
        assert_eq!(feeds.len(), rss::DEFAULT_FEEDS.len());
        assert!(!feeds.iter().find(|f| f.id == first.id).unwrap().enabled);
    }
}
