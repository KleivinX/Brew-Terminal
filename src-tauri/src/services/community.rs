//! Community temperature.
//!
//! Two gates stand between a user and this data, and both are enforced here rather than in the
//! UI. The `communityEnabled` preference must be on, and a community provider must be enabled.
//! Either one off means the command returns "not configured" and no request is made — a
//! frontend-only opt-in would be a checkbox that does not do anything.
//!
//! What comes back is quoted material. The service does not rank it, score it, or summarise it
//! into a mood; ordering is by recency, decided in the adapter. See PRODUCT_SCOPE_V0_1.md §6.

use crate::db::repo_preferences;
use crate::error::{AppError, AppResult};
use crate::models::{CommunityFilter, CommunityPost, Envelope};
use crate::providers::cache::{cache_key, CacheKind};
use crate::services::market::{cached_or_degraded, source_for};
use crate::state::{with_db, AppState};

/// The id reported when the feature is off, so the UI can say which thing is not configured.
const COMMUNITY_FEATURE_ID: &str = "community";

pub async fn get_posts(
    state: &AppState,
    filter: CommunityFilter,
) -> AppResult<Envelope<Vec<CommunityPost>>> {
    let preferences = with_db(state.pool.clone(), |conn| repo_preferences::get_all(conn)).await?;
    if !preferences.community_enabled {
        return Err(AppError::NotConfigured {
            provider_id: COMMUNITY_FEATURE_ID.to_string(),
        });
    }

    let Some(provider) = state.registry.community() else {
        return Err(AppError::NotConfigured {
            provider_id: COMMUNITY_FEATURE_ID.to_string(),
        });
    };

    let (id, name) = (
        provider.id().to_string(),
        provider.display_name().to_string(),
    );
    let key = cache_key(
        &id,
        "community",
        &[
            filter.asset_id.clone().unwrap_or_default(),
            filter.limit.to_string(),
        ],
    );
    let source = source_for(&id);

    cached_or_degraded(state, CacheKind::Community, key, &id, &name, source, || {
        let provider = provider.clone();
        let filter = CommunityFilter {
            asset_id: filter.asset_id.clone(),
            limit: filter.limit.clamp(1, 100),
        };
        async move { provider.posts(&filter).await }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::now_epoch_secs;
    use crate::state::AppState;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    async fn set_pref(state: &AppState, key: &'static str, value: &'static str) {
        with_db(state.pool.clone(), move |conn| {
            repo_preferences::set(conn, key, value, now_epoch_secs())
        })
        .await
        .unwrap();
    }

    async fn enable_provider(state: &AppState) {
        with_db(state.pool.clone(), |conn| {
            crate::db::repo_providers::set_enabled(conn, "mock-community", true)
        })
        .await
        .unwrap();
    }

    fn filter() -> CommunityFilter {
        CommunityFilter {
            asset_id: None,
            limit: 20,
        }
    }

    /// The opt-in is a real gate, not a UI decoration: with the preference off, no provider is
    /// consulted even when one is enabled.
    #[tokio::test]
    async fn the_preference_alone_can_switch_it_off() {
        let (state, _dir) = state();
        enable_provider(&state).await;

        let result = get_posts(&state, filter()).await;
        assert!(matches!(result, Err(AppError::NotConfigured { .. })));
    }

    /// And so is the provider: turning the feature on with nothing wired must not pretend.
    #[tokio::test]
    async fn the_provider_alone_can_switch_it_off() {
        let (state, _dir) = state();
        set_pref(&state, "communityEnabled", "true").await;

        let result = get_posts(&state, filter()).await;
        assert!(matches!(result, Err(AppError::NotConfigured { .. })));
    }

    #[tokio::test]
    async fn both_on_returns_posts_with_provenance() {
        let (state, _dir) = state();
        set_pref(&state, "communityEnabled", "true").await;
        enable_provider(&state).await;

        let envelope = get_posts(&state, filter()).await.unwrap();

        assert!(!envelope.data.is_empty());
        // No number or quote renders without its provider and its age.
        assert_eq!(envelope.meta.provider_id, "mock-community");
        assert!(!envelope.meta.provider_name.is_empty());
        assert!(!envelope.meta.fetched_at.is_empty());
    }

    #[tokio::test]
    async fn every_post_carries_a_source_and_an_https_link() {
        let (state, _dir) = state();
        set_pref(&state, "communityEnabled", "true").await;
        enable_provider(&state).await;

        let envelope = get_posts(&state, filter()).await.unwrap();
        for post in &envelope.data {
            assert!(!post.source_name.is_empty(), "a post with no source");
            assert!(post.url.starts_with("https://"));
        }
    }

    #[tokio::test]
    async fn defaults_leave_the_feature_off() {
        let (state, _dir) = state();
        let result = get_posts(&state, filter()).await;
        assert!(matches!(result, Err(AppError::NotConfigured { .. })));
    }
}
