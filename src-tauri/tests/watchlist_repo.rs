//! Watchlist persistence against a real SQLite file.
//!
//! These run against a temp-file database rather than `:memory:` so that transactions, foreign
//! keys and WAL behave exactly as they do in the app. Watchlist persistence across restart is
//! a Phase 2 acceptance criterion, and this is where it is proven.

use brew_terminal_lib::db::{migrations, pool, repo_assets, repo_watchlists};
use brew_terminal_lib::models::{Asset, AssetType};

struct TestDb {
    _dir: tempfile::TempDir,
    pool: pool::DbPool,
    path: std::path::PathBuf,
}

fn setup() -> TestDb {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("brew.db");
    let db_pool = pool::create(&path).unwrap();

    {
        let mut conn = db_pool.get().unwrap();
        migrations::run(&mut conn, Some(&path)).unwrap();
        repo_watchlists::ensure_default(&conn, 1000).unwrap();
    }

    TestDb {
        _dir: dir,
        pool: db_pool,
        path,
    }
}

fn asset(id: &str, symbol: &str) -> Asset {
    Asset {
        id: id.into(),
        asset_type: AssetType::Crypto,
        symbol: symbol.into(),
        name: format!("{symbol} asset"),
        currency: "USD".into(),
        exchange: None,
        region: Some("global".into()),
    }
}

fn seed_assets(db: &TestDb, ids: &[(&str, &str)]) {
    let conn = db.pool.get().unwrap();
    for (id, symbol) in ids {
        repo_assets::upsert(&conn, &asset(id, symbol), 1000).unwrap();
    }
}

#[test]
fn default_watchlist_exists_on_first_run() {
    let db = setup();
    let conn = db.pool.get().unwrap();

    let lists = repo_watchlists::list(&conn).unwrap();
    assert_eq!(lists.len(), 1);
    assert!(lists[0].is_default);
}

#[test]
fn ensure_default_is_idempotent() {
    let db = setup();
    let conn = db.pool.get().unwrap();

    repo_watchlists::ensure_default(&conn, 2000).unwrap();
    repo_watchlists::ensure_default(&conn, 3000).unwrap();

    assert_eq!(repo_watchlists::list(&conn).unwrap().len(), 1);
}

#[test]
fn items_survive_reopening_the_database() {
    let db = setup();
    seed_assets(
        &db,
        &[("crypto:cg:bitcoin", "BTC"), ("crypto:cg:ethereum", "ETH")],
    );

    {
        let conn = db.pool.get().unwrap();
        repo_watchlists::add_item(&conn, "wl-default", "crypto:cg:bitcoin", 1000).unwrap();
        repo_watchlists::add_item(&conn, "wl-default", "crypto:cg:ethereum", 1001).unwrap();
    }

    // Drop the pool entirely and reopen the file, which is what a restart actually does.
    drop(db.pool);
    let reopened = pool::create(&db.path).unwrap();
    let conn = reopened.get().unwrap();

    let items = repo_watchlists::items(&conn, "wl-default").unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].asset_id, "crypto:cg:bitcoin");
    assert_eq!(items[1].asset_id, "crypto:cg:ethereum");
}

#[test]
fn adding_the_same_asset_twice_is_a_no_op() {
    let db = setup();
    seed_assets(&db, &[("crypto:cg:bitcoin", "BTC")]);
    let conn = db.pool.get().unwrap();

    repo_watchlists::add_item(&conn, "wl-default", "crypto:cg:bitcoin", 1000).unwrap();
    repo_watchlists::add_item(&conn, "wl-default", "crypto:cg:bitcoin", 2000).unwrap();

    assert_eq!(
        repo_watchlists::items(&conn, "wl-default").unwrap().len(),
        1
    );
}

#[test]
fn removing_an_item_compacts_positions() {
    let db = setup();
    seed_assets(&db, &[("a:1:x", "X"), ("a:1:y", "Y"), ("a:1:z", "Z")]);

    let mut conn = db.pool.get().unwrap();
    for id in ["a:1:x", "a:1:y", "a:1:z"] {
        repo_watchlists::add_item(&conn, "wl-default", id, 1000).unwrap();
    }

    repo_watchlists::remove_item(&mut conn, "wl-default", "a:1:y").unwrap();

    let items = repo_watchlists::items(&conn, "wl-default").unwrap();
    assert_eq!(items.len(), 2);
    // Positions must stay contiguous, or a later reorder writes into a gap.
    assert_eq!(items[0].position, 0);
    assert_eq!(items[1].position, 1);
}

#[test]
fn reorder_applies_the_requested_order() {
    let db = setup();
    seed_assets(&db, &[("a:1:x", "X"), ("a:1:y", "Y"), ("a:1:z", "Z")]);

    let mut conn = db.pool.get().unwrap();
    for id in ["a:1:x", "a:1:y", "a:1:z"] {
        repo_watchlists::add_item(&conn, "wl-default", id, 1000).unwrap();
    }

    repo_watchlists::reorder(
        &mut conn,
        "wl-default",
        &["a:1:z".into(), "a:1:x".into(), "a:1:y".into()],
    )
    .unwrap();

    let ids: Vec<String> = repo_watchlists::items(&conn, "wl-default")
        .unwrap()
        .into_iter()
        .map(|item| item.asset_id)
        .collect();
    assert_eq!(ids, vec!["a:1:z", "a:1:x", "a:1:y"]);
}

#[test]
fn deleting_a_watchlist_removes_its_items() {
    let db = setup();
    seed_assets(&db, &[("crypto:cg:bitcoin", "BTC")]);
    let conn = db.pool.get().unwrap();

    let list = repo_watchlists::create(&conn, "Crypto", 1000).unwrap();
    repo_watchlists::add_item(&conn, &list.id, "crypto:cg:bitcoin", 1000).unwrap();

    repo_watchlists::delete(&conn, &list.id).unwrap();

    // ON DELETE CASCADE has to be doing real work here, which needs foreign_keys = ON.
    let orphans: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM watchlist_items WHERE watchlist_id = ?1",
            [&list.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(orphans, 0, "cascade delete must remove orphaned items");
}

#[test]
fn the_default_watchlist_cannot_be_deleted() {
    let db = setup();
    let conn = db.pool.get().unwrap();

    // "Add to watchlist" must always have somewhere to go.
    assert!(repo_watchlists::delete(&conn, "wl-default").is_err());
    assert_eq!(repo_watchlists::list(&conn).unwrap().len(), 1);
}

#[test]
fn watching_an_unknown_asset_is_rejected_by_the_foreign_key() {
    let db = setup();
    let conn = db.pool.get().unwrap();

    // Watchlists reference canonical asset ids; a row pointing at nothing would render as a
    // blank line the user cannot remove.
    let result = repo_watchlists::add_item(&conn, "wl-default", "crypto:cg:ghost", 1000);
    assert!(result.is_err(), "foreign key must reject an unknown asset");
}

#[test]
fn renaming_a_missing_watchlist_reports_not_found() {
    let db = setup();
    let conn = db.pool.get().unwrap();
    assert!(repo_watchlists::rename(&conn, "wl-nope", "New name", 1000).is_err());
}

#[test]
fn watchlist_names_are_validated() {
    let db = setup();
    let conn = db.pool.get().unwrap();

    assert!(repo_watchlists::create(&conn, "   ", 1000).is_err());
    assert!(repo_watchlists::create(&conn, &"x".repeat(200), 1000).is_err());
    assert!(repo_watchlists::create(&conn, "  Crypto  ", 1000).is_ok());
}
