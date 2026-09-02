//! End-to-end service tests against a real database file.
//!
//! These go through `AppState::bootstrap` — the same startup path the Tauri app uses — and call
//! the service functions the commands delegate to. That covers the whole chain: provider →
//! validation → cache → SQLite → freshness envelope.
//!
//! A restart is simulated by dropping the `AppState` (closing every pooled connection) and
//! bootstrapping again from the same directory.

use brew_terminal_lib::models::{AssetType, DegradedReason, EnvelopeSource, NewsFilter};
use brew_terminal_lib::providers::mock::MockBehavior;
use brew_terminal_lib::services;
use brew_terminal_lib::state::AppState;

/// Boots the app with **only** the mock provider enabled.
///
/// Live providers are on by default in a real install, so without this the suite would make
/// real network calls — slow, flaky, and rude to the provider. Disabling them here is also
/// what makes these tests deterministic.
fn boot(dir: &std::path::Path) -> AppState {
    let state = AppState::bootstrap(dir.to_path_buf()).expect("bootstrap failed");
    {
        let conn = state.pool.get().unwrap();
        for live in ["coingecko", "finnhub"] {
            brew_terminal_lib::db::repo_providers::set_enabled(&conn, live, false).unwrap();
        }
        brew_terminal_lib::db::repo_providers::set_enabled(&conn, "mock", true).unwrap();
    }
    state
}

#[tokio::test]
async fn watchlist_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();

    {
        let state = boot(dir.path());

        let lists = services::watchlist::list_watchlists(&state).await.unwrap();
        assert_eq!(lists.len(), 1, "first run creates a default watchlist");
        let default_id = lists[0].id.clone();

        for asset in ["crypto:cg:bitcoin", "crypto:cg:ethereum", "stock:us:AAPL"] {
            services::watchlist::add_watchlist_item(&state, default_id.clone(), asset.into())
                .await
                .unwrap();
        }

        let items = services::watchlist::get_watchlist_items(&state, default_id)
            .await
            .unwrap();
        assert_eq!(items.len(), 3);
    } // AppState dropped: pool closed, connections released.

    // Restart.
    let state = boot(dir.path());

    let lists = services::watchlist::list_watchlists(&state).await.unwrap();
    assert_eq!(
        lists.len(),
        1,
        "bootstrap must not create a second default list"
    );

    let items = services::watchlist::get_watchlist_items(&state, lists[0].id.clone())
        .await
        .unwrap();
    let ids: Vec<String> = items.into_iter().map(|i| i.asset_id).collect();

    assert_eq!(
        ids,
        vec!["crypto:cg:bitcoin", "crypto:cg:ethereum", "stock:us:AAPL"],
        "watchlist contents and order must survive a restart"
    );
}

#[tokio::test]
async fn watchlist_crud_round_trips_through_the_service_layer() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let created = services::watchlist::create_watchlist(&state, "Crypto majors".into())
        .await
        .unwrap();
    assert_eq!(created.name, "Crypto majors");
    assert!(!created.is_default);

    services::watchlist::rename_watchlist(&state, created.id.clone(), "Majors".into())
        .await
        .unwrap();

    for asset in [
        "crypto:cg:bitcoin",
        "crypto:cg:ethereum",
        "crypto:cg:solana",
    ] {
        services::watchlist::add_watchlist_item(&state, created.id.clone(), asset.into())
            .await
            .unwrap();
    }

    services::watchlist::reorder_watchlist_items(
        &state,
        created.id.clone(),
        vec![
            "crypto:cg:solana".into(),
            "crypto:cg:bitcoin".into(),
            "crypto:cg:ethereum".into(),
        ],
    )
    .await
    .unwrap();

    services::watchlist::remove_watchlist_item(
        &state,
        created.id.clone(),
        "crypto:cg:bitcoin".into(),
    )
    .await
    .unwrap();

    let items = services::watchlist::get_watchlist_items(&state, created.id.clone())
        .await
        .unwrap();
    let ids: Vec<String> = items.iter().map(|i| i.asset_id.clone()).collect();
    assert_eq!(ids, vec!["crypto:cg:solana", "crypto:cg:ethereum"]);
    // Positions stay contiguous after a removal, or a later reorder writes into a gap.
    assert_eq!(items[0].position, 0);
    assert_eq!(items[1].position, 1);

    let lists = services::watchlist::list_watchlists(&state).await.unwrap();
    assert!(lists.iter().any(|l| l.name == "Majors"));

    services::watchlist::delete_watchlist(&state, created.id.clone())
        .await
        .unwrap();
    let lists = services::watchlist::list_watchlists(&state).await.unwrap();
    assert_eq!(lists.len(), 1, "only the default list remains");
}

#[tokio::test]
async fn adding_an_asset_persists_the_asset_itself() {
    // watchlist_items has a foreign key onto assets, so an asset the user has only ever seen
    // in a provider response must be stored locally before it can be watched. This is also
    // what keeps a watchlist intact if the provider that surfaced it is later removed.
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let lists = services::watchlist::list_watchlists(&state).await.unwrap();
    services::watchlist::add_watchlist_item(
        &state,
        lists[0].id.clone(),
        "crypto:cg:bitcoin".into(),
    )
    .await
    .unwrap();

    let conn = state.pool.get().unwrap();
    let (symbol, name): (String, String) = conn
        .query_row(
            "SELECT symbol, name FROM assets WHERE id = 'crypto:cg:bitcoin'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert_eq!(symbol, "BTC");
    assert_eq!(name, "Bitcoin");
}

#[tokio::test]
async fn preferences_survive_a_restart() {
    let dir = tempfile::tempdir().unwrap();

    {
        let state = boot(dir.path());
        assert_eq!(
            services::settings::get_preferences(&state)
                .await
                .unwrap()
                .theme,
            "dark"
        );

        services::settings::set_preference(&state, "theme".into(), "\"soft\"".into())
            .await
            .unwrap();
        services::settings::set_preference(&state, "region".into(), "\"us\"".into())
            .await
            .unwrap();
    }

    let state = boot(dir.path());
    let prefs = services::settings::get_preferences(&state).await.unwrap();
    assert_eq!(prefs.theme, "soft");
    assert_eq!(prefs.region, "us");
    // Untouched preferences keep their defaults rather than becoming null.
    assert!(!prefs.ai_enabled);
    assert!(!prefs.community_enabled);
}

#[tokio::test]
async fn invalid_preferences_are_rejected_and_leave_state_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    assert!(
        services::settings::set_preference(&state, "theme".into(), "\"neon\"".into())
            .await
            .is_err()
    );
    assert!(
        services::settings::set_preference(&state, "isAdmin".into(), "true".into())
            .await
            .is_err()
    );

    assert_eq!(
        services::settings::get_preferences(&state)
            .await
            .unwrap()
            .theme,
        "dark"
    );
}

#[tokio::test]
async fn quotes_are_cached_and_served_from_cache_when_the_provider_fails() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let ids = vec![
        "crypto:cg:bitcoin".to_string(),
        "crypto:cg:ethereum".to_string(),
    ];

    // First call populates the cache from the provider.
    let fresh = services::market::get_quotes(&state, ids.clone())
        .await
        .unwrap();
    assert_eq!(fresh.data.len(), 2);
    assert_eq!(fresh.meta.source, EnvelopeSource::Mock);
    assert!(!fresh.meta.stale);
    assert!(fresh.meta.degraded.is_none());

    let stats = services::cache::get_cache_stats(&state).await.unwrap();
    assert!(
        stats.entry_count >= 1,
        "the successful fetch must be cached"
    );

    // Now break the provider. The user should still see values.
    state
        .registry
        .mock_market()
        .set_behavior(MockBehavior::RateLimited);

    let degraded = services::market::get_quotes(&state, ids).await.unwrap();

    assert_eq!(degraded.data.len(), 2, "cached values must still be shown");
    assert!(degraded.meta.stale);
    assert_eq!(degraded.meta.source, EnvelopeSource::Cache);
    let reason = degraded
        .meta
        .degraded
        .expect("degraded state must be set")
        .reason;
    assert_eq!(reason, DegradedReason::RateLimited);
}

#[tokio::test]
async fn a_first_run_failure_explains_itself_instead_of_returning_an_empty_table() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    state
        .registry
        .mock_market()
        .set_behavior(MockBehavior::NotConfigured);

    let result = services::market::get_market_list(&state, AssetType::Crypto, "global".into(), 20)
        .await
        .unwrap();

    assert!(result.data.is_empty(), "nothing cached, so nothing to show");
    let degraded = result.meta.degraded.expect("must carry a reason");
    assert_eq!(degraded.reason, DegradedReason::NotConfigured);
    assert!(!degraded.message.is_empty());
}

#[tokio::test]
async fn every_envelope_carries_attribution_and_a_timestamp() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let quotes = services::market::get_market_list(&state, AssetType::Crypto, "global".into(), 5)
        .await
        .unwrap();
    let news = services::market::get_news(
        &state,
        NewsFilter {
            category: "all".into(),
            asset_id: None,
            limit: 5,
        },
    )
    .await
    .unwrap();

    for meta in [quotes.meta, news.meta] {
        assert!(!meta.provider_id.is_empty());
        assert!(
            !meta.provider_name.is_empty(),
            "attribution is not optional"
        );
        assert!(
            chrono::DateTime::parse_from_rfc3339(&meta.fetched_at).is_ok(),
            "fetchedAt must be a parseable timestamp"
        );
    }
}

#[tokio::test]
async fn search_finds_assets_by_symbol_and_name() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let by_symbol = services::market::search_assets(&state, "btc".into(), 5)
        .await
        .unwrap();
    assert_eq!(by_symbol.data[0].asset.symbol, "BTC");

    let by_name = services::market::search_assets(&state, "ethereum".into(), 5)
        .await
        .unwrap();
    assert!(by_name.data.iter().any(|r| r.asset.symbol == "ETH"));

    let nothing = services::market::search_assets(&state, "zzzzqqq".into(), 5)
        .await
        .unwrap();
    assert!(nothing.data.is_empty());
}

#[tokio::test]
async fn get_quotes_rejects_an_unreasonably_large_batch() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let too_many: Vec<String> = (0..201).map(|i| format!("crypto:cg:coin{i}")).collect();
    assert!(services::market::get_quotes(&state, too_many)
        .await
        .is_err());
}

#[tokio::test]
async fn app_info_reports_the_real_schema_version_and_paths() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let info = services::settings::get_app_info(&state).await.unwrap();
    // Compared against the migration list rather than a literal: the point of this
    // assertion is that app_info reports the schema the database actually has, and a
    // hardcoded number would fail on every migration without telling us anything.
    assert_eq!(
        info.schema_version,
        brew_terminal_lib::db::migrations::latest_version()
    );
    assert!(info.db_path.ends_with("brew.db"));
    assert!(
        info.is_mock_mode,
        "Phase 2 still runs on fixtures by default"
    );
}

#[tokio::test]
async fn clearing_the_cache_removes_stored_payloads() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    services::market::get_market_list(&state, AssetType::Crypto, "global".into(), 10)
        .await
        .unwrap();
    assert!(
        services::cache::get_cache_stats(&state)
            .await
            .unwrap()
            .entry_count
            > 0
    );

    services::cache::clear_cache(&state, None).await.unwrap();
    assert_eq!(
        services::cache::get_cache_stats(&state)
            .await
            .unwrap()
            .entry_count,
        0
    );
}

#[tokio::test]
async fn notes_survive_a_restart_and_stay_searchable() {
    let dir = tempfile::tempdir().unwrap();

    {
        let state = boot(dir.path());
        // The asset must exist first: notes reference it by foreign key.
        services::watchlist::add_watchlist_item(
            &state,
            "wl-default".into(),
            "crypto:cg:bitcoin".into(),
        )
        .await
        .unwrap();

        services::notes::upsert_note(
            &state,
            None,
            Some("crypto:cg:bitcoin".into()),
            "Supply thesis".into(),
            "Issuance halves on a fixed schedule.".into(),
        )
        .await
        .unwrap();
    }

    let state = boot(dir.path());

    let notes = services::notes::list_notes(&state, "crypto:cg:bitcoin".into())
        .await
        .unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].title, "Supply thesis");

    // The FTS index has to survive the restart too, not just the row.
    let hits = services::notes::search_notes(&state, "issuance".into(), 10)
        .await
        .unwrap();
    assert_eq!(hits.len(), 1);
}

#[tokio::test]
async fn the_notes_workspace_shows_notes_with_and_without_an_asset() {
    // The path the Notes route takes. `list_notes` is scoped to an asset and can never return
    // a general note, so before `list_all_notes` existed a note attached to nothing could be
    // written through this same service and then never read back.
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    services::watchlist::add_watchlist_item(&state, "wl-default".into(), "crypto:cg:bitcoin".into())
        .await
        .unwrap();

    services::notes::upsert_note(
        &state,
        None,
        Some("crypto:cg:bitcoin".into()),
        "Attached".into(),
        "about bitcoin".into(),
    )
    .await
    .unwrap();
    services::notes::upsert_note(
        &state,
        None,
        None,
        "Free standing".into(),
        "about nothing in particular".into(),
    )
    .await
    .unwrap();

    let all = services::notes::list_all_notes(&state).await.unwrap();
    assert_eq!(all.len(), 2);
    assert!(all.iter().any(|n| n.title == "Free standing" && n.asset_id.is_none()));
    assert!(all.iter().any(|n| n.title == "Attached" && n.asset_id.is_some()));

    // The per-asset view is unchanged: it still shows only what belongs to that asset.
    let for_asset = services::notes::list_notes(&state, "crypto:cg:bitcoin".into())
        .await
        .unwrap();
    assert_eq!(for_asset.len(), 1);
    assert_eq!(for_asset[0].title, "Attached");
}

#[tokio::test]
async fn the_notes_workspace_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();

    {
        let state = boot(dir.path());
        services::notes::upsert_note(&state, None, None, "Kept".into(), "on disk".into())
            .await
            .unwrap();
    }

    let state = boot(dir.path());
    let all = services::notes::list_all_notes(&state).await.unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].title, "Kept");
}

#[tokio::test]
async fn the_workspace_lists_the_most_recently_edited_note_first() {
    // The list is what the user scans; an unstable or arbitrary order makes it unusable.
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let first = services::notes::upsert_note(&state, None, None, "First".into(), "a".into())
        .await
        .unwrap();
    services::notes::upsert_note(&state, None, None, "Second".into(), "b".into())
        .await
        .unwrap();

    // Editing the older note should move it to the top.
    services::notes::upsert_note(
        &state,
        Some(first.id.clone()),
        None,
        "First, edited".into(),
        "a again".into(),
    )
    .await
    .unwrap();

    let all = services::notes::list_all_notes(&state).await.unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(
        all[0].title, "First, edited",
        "editing a note must bring it to the front of the workspace list"
    );
}

#[tokio::test]
async fn a_deleted_note_leaves_the_workspace_list() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let note = services::notes::upsert_note(&state, None, None, "Temp".into(), "x".into())
        .await
        .unwrap();
    assert_eq!(services::notes::list_all_notes(&state).await.unwrap().len(), 1);

    services::notes::delete_note(&state, note.id).await.unwrap();
    assert!(services::notes::list_all_notes(&state).await.unwrap().is_empty());
}

#[tokio::test]
async fn editing_a_note_updates_what_search_finds() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let note = services::notes::upsert_note(&state, None, None, "Draft".into(), "aardvark".into())
        .await
        .unwrap();

    services::notes::upsert_note(
        &state,
        Some(note.id.clone()),
        None,
        "Draft".into(),
        "buffalo".into(),
    )
    .await
    .unwrap();

    assert!(
        services::notes::search_notes(&state, "aardvark".into(), 10)
            .await
            .unwrap()
            .is_empty(),
        "the old text must stop matching"
    );
    assert_eq!(
        services::notes::search_notes(&state, "buffalo".into(), 10)
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn deleting_a_note_removes_it_from_search() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let note = services::notes::upsert_note(&state, None, None, "Temp".into(), "capybara".into())
        .await
        .unwrap();
    services::notes::delete_note(&state, note.id).await.unwrap();

    assert!(services::notes::search_notes(&state, "capybara".into(), 10)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn an_empty_note_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    assert!(
        services::notes::upsert_note(&state, None, None, "  ".into(), "  ".into())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn chart_returns_a_usable_series_with_attribution() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let chart = services::market::get_chart(
        &state,
        "crypto:cg:bitcoin".into(),
        brew_terminal_lib::models::ChartRange::Month,
    )
    .await
    .unwrap();

    assert!(!chart.data.is_empty());
    assert!(
        !chart.meta.provider_name.is_empty(),
        "charts carry attribution too"
    );

    for pair in chart.data.windows(2) {
        assert!(
            pair[0].time < pair[1].time,
            "chart points must strictly ascend for the renderer"
        );
    }
}

#[tokio::test]
async fn a_range_the_provider_cannot_serve_is_reported_not_faked() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    // The mock provider covers every range, so this checks the routing guard instead: an
    // asset id no enabled provider owns.
    let chart = services::market::get_chart(
        &state,
        "bogus:x:thing".into(),
        brew_terminal_lib::models::ChartRange::Year,
    )
    .await
    .unwrap();

    assert!(chart.data.is_empty());
    assert_eq!(
        chart.meta.degraded.expect("must explain itself").reason,
        DegradedReason::NotConfigured
    );
}

#[tokio::test]
async fn learning_progress_survives_a_restart_and_can_be_reset() {
    use brew_terminal_lib::models::ProgressStatus;

    let dir = tempfile::tempdir().unwrap();

    {
        let state = boot(dir.path());
        services::learn::set_progress(
            &state,
            "what-a-share-is".into(),
            "stocks-basics".into(),
            ProgressStatus::Completed,
        )
        .await
        .unwrap();
        services::learn::set_progress(
            &state,
            "what-a-blockchain-is".into(),
            "crypto-basics".into(),
            ProgressStatus::Completed,
        )
        .await
        .unwrap();
    }

    let state = boot(dir.path());
    let progress = services::learn::list_progress(&state).await.unwrap();
    assert_eq!(progress.len(), 2, "progress must survive a restart");

    // Resetting one path leaves the other alone.
    services::learn::reset_progress(&state, Some("stocks-basics".into()))
        .await
        .unwrap();
    let remaining = services::learn::list_progress(&state).await.unwrap();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].path_id, "crypto-basics");

    services::learn::reset_progress(&state, None).await.unwrap();
    assert!(services::learn::list_progress(&state)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn reopening_a_lesson_clears_its_completion_date() {
    use brew_terminal_lib::models::ProgressStatus;

    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    services::learn::set_progress(
        &state,
        "orders".into(),
        "how-markets-work".into(),
        ProgressStatus::Completed,
    )
    .await
    .unwrap();
    assert!(services::learn::list_progress(&state).await.unwrap()[0]
        .completed_at
        .is_some());

    services::learn::set_progress(
        &state,
        "orders".into(),
        "how-markets-work".into(),
        ProgressStatus::NotStarted,
    )
    .await
    .unwrap();

    // A completion date on a not-completed lesson would render as nonsense.
    assert!(services::learn::list_progress(&state).await.unwrap()[0]
        .completed_at
        .is_none());
}
