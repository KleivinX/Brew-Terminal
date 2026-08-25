//! Provider configuration, routing and credential-handling guarantees.
//!
//! No test here touches the network: live providers are configured but never enabled in a way
//! that would issue a request, and the mock provider serves anything that must return data.

use brew_terminal_lib::db::repo_providers;
use brew_terminal_lib::models::{AssetType, ChartRange, DegradedReason};
use brew_terminal_lib::providers::registry::asset_type_of;
use brew_terminal_lib::services;
use brew_terminal_lib::state::AppState;

fn boot(dir: &std::path::Path) -> AppState {
    AppState::bootstrap(dir.to_path_buf()).expect("bootstrap failed")
}

fn set_enabled(state: &AppState, provider_id: &str, enabled: bool) {
    let conn = state.pool.get().unwrap();
    repo_providers::set_enabled(&conn, provider_id, enabled).unwrap();
}

fn mock_only(state: &AppState) {
    set_enabled(state, "coingecko", false);
    set_enabled(state, "finnhub", false);
    set_enabled(state, "mock", true);
}

#[tokio::test]
async fn first_run_seeds_a_sensible_provider_default() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());
    let conn = state.pool.get().unwrap();

    // CoinGecko needs no key, so it is on. Finnhub needs one for every endpoint, so it is off.
    assert!(repo_providers::is_enabled(&conn, "coingecko"));
    assert!(!repo_providers::is_enabled(&conn, "finnhub"));
}

#[tokio::test]
async fn a_disabled_provider_stays_disabled_across_restarts() {
    let dir = tempfile::tempdir().unwrap();

    {
        let state = boot(dir.path());
        set_enabled(&state, "coingecko", false);
    }

    // Bootstrap re-seeds defaults on every launch; it must not undo the user's choice.
    let state = boot(dir.path());
    let conn = state.pool.get().unwrap();
    assert!(!repo_providers::is_enabled(&conn, "coingecko"));
}

#[tokio::test]
async fn routing_follows_the_canonical_id_namespace() {
    assert_eq!(asset_type_of("crypto:cg:bitcoin"), Some(AssetType::Crypto));
    assert_eq!(asset_type_of("stock:us:AAPL"), Some(AssetType::Stock));
    assert_eq!(asset_type_of("etf:us:VOO"), Some(AssetType::Etf));
    assert_eq!(asset_type_of("not-an-id"), None);
}

#[tokio::test]
async fn with_no_provider_enabled_the_ui_is_told_so_rather_than_shown_fixtures() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    set_enabled(&state, "coingecko", false);
    set_enabled(&state, "finnhub", false);
    set_enabled(&state, "mock", false);

    let result = services::market::get_market_list(&state, AssetType::Crypto, "global".into(), 10)
        .await
        .unwrap();

    assert!(result.data.is_empty());
    let degraded = result.meta.degraded.expect("must explain itself");
    assert_eq!(degraded.reason, DegradedReason::NotConfigured);
    assert!(
        degraded.message.contains("Settings"),
        "the message should point somewhere actionable"
    );
}

#[tokio::test]
async fn enabling_a_provider_changes_what_the_dashboard_can_show() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    set_enabled(&state, "coingecko", false);
    set_enabled(&state, "mock", false);
    let empty = services::market::get_market_list(&state, AssetType::Crypto, "global".into(), 5)
        .await
        .unwrap();
    assert!(empty.data.is_empty());

    set_enabled(&state, "mock", true);
    let populated =
        services::market::get_market_list(&state, AssetType::Crypto, "global".into(), 5)
            .await
            .unwrap();
    assert!(!populated.data.is_empty());
}

#[tokio::test]
async fn a_mixed_watchlist_credits_every_provider_that_contributed() {
    // The mock provider covers both asset types, so this exercises the merge path with one
    // provider; the multi-provider name joining is unit-tested in services::market.
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());
    mock_only(&state);

    let quotes = services::market::get_quotes(
        &state,
        vec!["crypto:cg:bitcoin".into(), "stock:us:AAPL".into()],
    )
    .await
    .unwrap();

    assert_eq!(quotes.data.len(), 2, "both asset types resolve");
    assert!(
        !quotes.meta.provider_name.trim().is_empty(),
        "attribution is never dropped, even when merging"
    );
}

#[tokio::test]
async fn assets_with_no_provider_are_reported_not_silently_omitted() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());
    mock_only(&state);

    let quotes = services::market::get_quotes(
        &state,
        vec!["crypto:cg:bitcoin".into(), "bogus:x:thing".into()],
    )
    .await
    .unwrap();

    assert_eq!(quotes.data.len(), 1);
    let degraded = quotes
        .meta
        .degraded
        .expect("the dropped asset must be surfaced");
    assert_eq!(degraded.reason, DegradedReason::NotConfigured);
}

#[tokio::test]
async fn provider_info_never_carries_credential_material() {
    /*
     * The guarantee: an API key never crosses the IPC boundary outward. `list_providers` is
     * the payload most likely to leak one by accident, so it is checked directly against the
     * serialized JSON rather than against the struct.
     */
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    let providers = services::settings::list_providers(&state).await.unwrap();
    let json = serde_json::to_string(&providers).unwrap();

    assert!(
        json.contains("hasCredential"),
        "the boolean flag is expected"
    );
    for forbidden in ["apiKey", "api_key", "secret", "token", "password"] {
        assert!(
            !json.contains(forbidden),
            "provider payload must not contain `{forbidden}`"
        );
    }
}

#[tokio::test]
async fn every_provider_declares_attribution_and_honest_capabilities() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());

    for provider in services::settings::list_providers(&state).await.unwrap() {
        assert!(
            !provider.attribution.trim().is_empty(),
            "{} has no attribution text",
            provider.id
        );

        /*
         * A provider must not advertise a chart range it cannot serve — the UI builds its
         * range buttons straight from this list, so anything here is a button a user can
         * press.
         */
        if provider.id == "coingecko" {
            assert!(
                !provider.supported_ranges.is_empty(),
                "CoinGecko implements charts and should advertise its ranges"
            );
            assert!(
                !provider.supported_ranges.contains(&ChartRange::Max),
                "the public and Demo tiers cap history at 365 days, so Max would always fail"
            );
        }

        if provider.id == "finnhub" {
            assert!(
                provider.supported_ranges.is_empty(),
                "candles are a premium endpoint on Finnhub; advertising a range would be a dead button"
            );
        }
    }
}

#[tokio::test]
async fn testing_a_disabled_provider_says_so_instead_of_making_a_request() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());
    set_enabled(&state, "finnhub", false);

    let result = services::settings::test_provider(&state, "finnhub".into())
        .await
        .unwrap();

    assert!(!result.ok);
    assert!(result.message.contains("not enabled"));
}

#[tokio::test]
async fn testing_the_mock_provider_succeeds_without_network() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());
    mock_only(&state);

    let result = services::settings::test_provider(&state, "mock".into())
        .await
        .unwrap();

    assert!(result.ok, "got: {}", result.message);
}

#[tokio::test]
async fn region_selection_narrows_the_equity_list() {
    let dir = tempfile::tempdir().unwrap();
    let state = boot(dir.path());
    mock_only(&state);

    let global = services::market::get_market_list(&state, AssetType::Stock, "global".into(), 50)
        .await
        .unwrap();
    let us = services::market::get_market_list(&state, AssetType::Stock, "us".into(), 50)
        .await
        .unwrap();
    let nowhere = services::market::get_market_list(&state, AssetType::Stock, "jp".into(), 50)
        .await
        .unwrap();

    assert!(!global.data.is_empty());
    assert!(!us.data.is_empty());
    assert!(us.data.len() <= global.data.len());
    assert!(
        nowhere.data.is_empty(),
        "an uncovered region returns nothing rather than ignoring the filter"
    );
}
