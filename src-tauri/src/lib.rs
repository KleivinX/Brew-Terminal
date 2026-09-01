pub mod commands;
pub mod db;
pub mod error;
pub mod localai;
pub mod models;
pub mod providers;
pub mod security;
pub mod services;
pub mod state;

use tauri::Manager;

use crate::state::AppState;

fn init_tracing() {
    use tracing_subscriber::{fmt, EnvFilter};

    // No telemetry by design: this writes to the local console only, and everything that
    // reaches it goes through `security::redact` first. See THREAT_MODEL.md §4.
    let filter = EnvFilter::try_from_env("BREW_LOG").unwrap_or_else(|_| {
        EnvFilter::new(if cfg!(debug_assertions) {
            "info"
        } else {
            "warn"
        })
    });

    let _ = fmt().with_env_filter(filter).with_target(false).try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            tracing::info!(path = %data_dir.display(), "opening local database");

            let state = AppState::bootstrap(data_dir)?;

            let startup_pool = state.pool.clone();
            tauri::async_runtime::spawn(async move {
                services::cache::evict_expired_on_startup(startup_pool).await;
            });

            app.manage(state);

            /*
             * The alert poller. It is started unconditionally but does nothing until the user
             * switches alerts on *and* has an armed alert — it re-reads the preference on every
             * tick, so this costs a sleeping task and no requests. See `services::alerts` for
             * why this is the one place the app makes a request nobody asked for.
             */
            services::alerts::spawn_poller(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // market
            commands::market::search_assets,
            commands::market::get_quotes,
            commands::market::get_market_list,
            commands::market::get_asset,
            commands::market::get_chart,
            commands::market::get_news,
            // news feeds
            commands::news_feeds::list_news_feeds,
            commands::news_feeds::preview_news_feed,
            commands::news_feeds::add_news_feed,
            commands::news_feeds::remove_news_feed,
            commands::news_feeds::set_news_feed_enabled,
            commands::news_feeds::restore_default_news_feeds,
            // local models
            commands::local_models::get_local_models,
            commands::local_models::install_engine,
            commands::local_models::download_model,
            commands::local_models::get_download_progress,
            commands::local_models::cancel_download,
            commands::local_models::delete_local_model,
            commands::local_models::start_local_model,
            commands::local_models::stop_local_model,
            // alerts
            commands::alerts::list_alerts,
            commands::alerts::create_alert,
            commands::alerts::delete_alert,
            commands::alerts::set_alert_enabled,
            commands::alerts::rearm_alert,
            commands::alerts::check_alerts,
            // screener
            commands::screener::run_screen,
            // portfolio
            commands::portfolio::get_portfolio,
            commands::portfolio::list_transactions,
            commands::portfolio::add_transaction,
            commands::portfolio::update_transaction,
            commands::portfolio::delete_transaction,
            // community
            commands::community::get_community_posts,
            // learn
            commands::learn::list_progress,
            commands::learn::set_progress,
            commands::learn::reset_progress,
            // notes
            commands::notes::list_notes,
            commands::notes::upsert_note,
            commands::notes::delete_note,
            commands::notes::search_notes,
            // watchlists
            commands::watchlist::list_watchlists,
            commands::watchlist::get_watchlist_items,
            commands::watchlist::create_watchlist,
            commands::watchlist::rename_watchlist,
            commands::watchlist::delete_watchlist,
            commands::watchlist::add_watchlist_item,
            commands::watchlist::remove_watchlist_item,
            commands::watchlist::reorder_watchlist_items,
            // settings
            commands::settings::get_preferences,
            commands::settings::set_preference,
            commands::settings::list_providers,
            commands::settings::get_app_info,
            commands::settings::set_mock_behavior,
            commands::settings::set_provider_enabled,
            commands::settings::save_provider_credential,
            commands::settings::delete_provider_credential,
            commands::settings::test_provider,
            commands::settings::check_for_updates,
            // ai
            commands::ai::get_ai_status,
            commands::ai::save_ai_endpoint,
            commands::ai::save_ai_cloud_endpoint,
            commands::ai::clear_ai_endpoint,
            commands::ai::test_ai_endpoint,
            commands::ai::preview_ai_send,
            commands::ai::send_ai_message,
            commands::ai::list_ai_conversations,
            commands::ai::get_ai_messages,
            commands::ai::delete_ai_conversation,
            commands::ai::clear_ai_conversations,
            commands::ai::list_ai_outbound_log,
            commands::ai::clear_ai_outbound_log,
            // profile
            commands::profile::export_profile,
            commands::profile::inspect_profile,
            commands::profile::import_profile,
            // cache
            commands::cache::get_cache_stats,
            commands::cache::clear_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Brew Terminal");
}
