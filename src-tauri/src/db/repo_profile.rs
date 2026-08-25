//! Gathering a `.brewprofile` payload out of the database, and writing one back in.
//!
//! Two rules govern this module.
//!
//! **Nothing secret leaves.** `provider_config.has_credential` is not exported, and is written
//! as `0` on import: the key itself lives in the OS keychain of the machine that holds it, so a
//! profile carried to a new machine must not claim a credential exists there.
//!
//! **Import is one transaction.** The caller opens it; every write here happens inside it, so a
//! failure part-way leaves the database exactly as it was. See THREAT_MODEL.md §6.3.

use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{
    ExportedAsset, ExportedAssetRef, ExportedBookmark, ExportedNote, ExportedPreference,
    ExportedProgress, ExportedProvider, ExportedWatchlist, ExportedWatchlistItem, ImportMode,
    ProfilePayload,
};

fn collect<T, F>(conn: &Connection, sql: &str, map: F) -> AppResult<Vec<T>>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], map)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Reads everything a profile carries.
///
/// Deliberately reads whole tables rather than only what is referenced: a note attached to an
/// asset that is no longer on any watchlist is still the user's note, and dropping it because
/// nothing links to it would be a surprising kind of data loss.
pub fn gather(conn: &Connection, schema_version: i64, now: i64) -> AppResult<ProfilePayload> {
    Ok(ProfilePayload {
        schema_version,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        exported_at: now,

        assets: collect(
            conn,
            "SELECT id, asset_type, symbol, name, currency, exchange, region, created_at, updated_at
             FROM assets ORDER BY id",
            |row| {
                Ok(ExportedAsset {
                    id: row.get(0)?,
                    asset_type: row.get(1)?,
                    symbol: row.get(2)?,
                    name: row.get(3)?,
                    currency: row.get(4)?,
                    exchange: row.get(5)?,
                    region: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )?,

        asset_refs: collect(
            conn,
            "SELECT asset_id, provider_id, provider_symbol, updated_at
             FROM asset_provider_refs ORDER BY asset_id, provider_id",
            |row| {
                Ok(ExportedAssetRef {
                    asset_id: row.get(0)?,
                    provider_id: row.get(1)?,
                    provider_symbol: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )?,

        watchlists: collect(
            conn,
            "SELECT id, name, position, is_default, created_at, updated_at
             FROM watchlists ORDER BY position",
            |row| {
                Ok(ExportedWatchlist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    position: row.get(2)?,
                    is_default: row.get::<_, i64>(3)? != 0,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )?,

        watchlist_items: collect(
            conn,
            "SELECT watchlist_id, asset_id, position, added_at
             FROM watchlist_items ORDER BY watchlist_id, position",
            |row| {
                Ok(ExportedWatchlistItem {
                    watchlist_id: row.get(0)?,
                    asset_id: row.get(1)?,
                    position: row.get(2)?,
                    added_at: row.get(3)?,
                })
            },
        )?,

        notes: collect(
            conn,
            "SELECT id, asset_id, title, body_md, created_at, updated_at FROM notes ORDER BY id",
            |row| {
                Ok(ExportedNote {
                    id: row.get(0)?,
                    asset_id: row.get(1)?,
                    title: row.get(2)?,
                    body_md: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )?,

        progress: collect(
            conn,
            "SELECT item_id, path_id, status, completed_at, updated_at
             FROM learning_progress ORDER BY item_id",
            |row| {
                Ok(ExportedProgress {
                    item_id: row.get(0)?,
                    path_id: row.get(1)?,
                    status: row.get(2)?,
                    completed_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )?,

        bookmarks: collect(
            conn,
            "SELECT kind, ref_id, created_at FROM bookmarks ORDER BY kind, ref_id",
            |row| {
                Ok(ExportedBookmark {
                    kind: row.get(0)?,
                    ref_id: row.get(1)?,
                    created_at: row.get(2)?,
                })
            },
        )?,

        preferences: collect(
            conn,
            "SELECT key, value FROM preferences ORDER BY key",
            |row| {
                Ok(ExportedPreference {
                    key: row.get(0)?,
                    value: row.get(1)?,
                })
            },
        )?,

        // `has_credential` is absent from this SELECT on purpose. See the module doc.
        providers: collect(
            conn,
            "SELECT provider_id, kind, enabled, base_url, config_json
             FROM provider_config ORDER BY provider_id",
            |row| {
                Ok(ExportedProvider {
                    provider_id: row.get(0)?,
                    kind: row.get(1)?,
                    enabled: row.get::<_, i64>(2)? != 0,
                    base_url: row.get(3)?,
                    config_json: row.get(4)?,
                })
            },
        )?,
    })
}

/// Checks a decrypted payload before any of it is written.
///
/// A valid authentication tag proves the file came from someone with the password. It proves
/// nothing about whether the contents are sane, so the payload is validated with the same
/// suspicion provider data gets. See THREAT_MODEL.md §6.3.
pub fn validate(payload: &ProfilePayload, current_schema_version: i64) -> AppResult<()> {
    if payload.schema_version > current_schema_version {
        return Err(AppError::Validation {
            field: "file".into(),
            detail: "that profile came from a newer version of Brew Terminal".into(),
        });
    }

    for asset in &payload.assets {
        if !matches!(
            asset.asset_type.as_str(),
            "crypto" | "stock" | "etf" | "index"
        ) {
            return Err(AppError::Validation {
                field: "file".into(),
                detail: "that profile contains an asset of an unknown type".into(),
            });
        }
        if asset.id.trim().is_empty() {
            return Err(AppError::Validation {
                field: "file".into(),
                detail: "that profile contains an asset with no id".into(),
            });
        }
    }

    for progress in &payload.progress {
        if !matches!(
            progress.status.as_str(),
            "not_started" | "in_progress" | "completed"
        ) {
            return Err(AppError::Validation {
                field: "file".into(),
                detail: "that profile contains progress in an unknown state".into(),
            });
        }
    }

    for bookmark in &payload.bookmarks {
        if !matches!(
            bookmark.kind.as_str(),
            "glossary" | "lesson" | "article" | "asset"
        ) {
            return Err(AppError::Validation {
                field: "file".into(),
                detail: "that profile contains a bookmark of an unknown kind".into(),
            });
        }
    }

    for provider in &payload.providers {
        if !matches!(
            provider.kind.as_str(),
            "market" | "news" | "community" | "ai"
        ) {
            return Err(AppError::Validation {
                field: "file".into(),
                detail: "that profile contains a provider of an unknown kind".into(),
            });
        }
        // A base URL is used to build requests. One that does not parse would be stored and
        // then fail at the worst moment, so it is refused here.
        if let Some(url) = provider.base_url.as_deref() {
            if !url.is_empty() && url::Url::parse(url).is_err() {
                return Err(AppError::Validation {
                    field: "file".into(),
                    detail: "that profile contains a provider address that is not a valid URL"
                        .into(),
                });
            }
        }
        if serde_json::from_str::<serde_json::Value>(&provider.config_json).is_err() {
            return Err(AppError::Validation {
                field: "file".into(),
                detail: "that profile contains provider settings that could not be read".into(),
            });
        }
    }

    // Unknown preference keys are dropped rather than refused — a profile from a build with an
    // extra setting should still import the settings this build does understand.
    Ok(())
}

/// Writes a validated payload. The caller supplies a transaction.
pub fn apply(conn: &Connection, payload: &ProfilePayload, mode: ImportMode) -> AppResult<()> {
    if mode == ImportMode::Replace {
        // Order matters only for readability; the child tables cascade from their parents.
        conn.execute("DELETE FROM watchlist_items", [])?;
        conn.execute("DELETE FROM watchlists", [])?;
        conn.execute("DELETE FROM notes", [])?;
        conn.execute("DELETE FROM learning_progress", [])?;
        conn.execute("DELETE FROM bookmarks", [])?;
        conn.execute("DELETE FROM preferences", [])?;
        // `assets` and `provider_config` are not cleared. Assets are shared reference data that
        // the app re-fetches anyway, and clearing provider_config would drop the
        // `has_credential` flags for keys still sitting in this machine's keychain.
    }

    for asset in &payload.assets {
        conn.execute(
            "INSERT INTO assets
                 (id, asset_type, symbol, name, currency, exchange, region, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
                 symbol = excluded.symbol,
                 name = excluded.name,
                 currency = excluded.currency,
                 exchange = excluded.exchange,
                 region = excluded.region,
                 updated_at = excluded.updated_at",
            params![
                asset.id,
                asset.asset_type,
                asset.symbol,
                asset.name,
                asset.currency,
                asset.exchange,
                asset.region,
                asset.created_at,
                asset.updated_at
            ],
        )?;
    }

    for reference in &payload.asset_refs {
        conn.execute(
            "INSERT INTO asset_provider_refs (asset_id, provider_id, provider_symbol, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(asset_id, provider_id) DO UPDATE SET
                 provider_symbol = excluded.provider_symbol,
                 updated_at = excluded.updated_at",
            params![
                reference.asset_id,
                reference.provider_id,
                reference.provider_symbol,
                reference.updated_at
            ],
        )?;
    }

    for watchlist in &payload.watchlists {
        conn.execute(
            "INSERT INTO watchlists (id, name, position, is_default, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 position = excluded.position,
                 is_default = excluded.is_default,
                 updated_at = excluded.updated_at",
            params![
                watchlist.id,
                watchlist.name,
                watchlist.position,
                watchlist.is_default as i64,
                watchlist.created_at,
                watchlist.updated_at
            ],
        )?;
    }

    for item in &payload.watchlist_items {
        // A watchlist item whose asset the payload did not carry would violate the foreign key
        // and abort the whole import. Skipping it keeps the rest of a slightly inconsistent
        // file usable, which matters more than perfect fidelity to a file we did not write.
        let asset_exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM assets WHERE id = ?1",
            [&item.asset_id],
            |row| row.get(0),
        )?;
        let list_exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM watchlists WHERE id = ?1",
            [&item.watchlist_id],
            |row| row.get(0),
        )?;
        if asset_exists == 0 || list_exists == 0 {
            tracing::warn!(
                asset = %item.asset_id,
                "skipping a watchlist item whose asset or list is missing from the profile"
            );
            continue;
        }

        conn.execute(
            "INSERT INTO watchlist_items (watchlist_id, asset_id, position, added_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(watchlist_id, asset_id) DO UPDATE SET position = excluded.position",
            params![
                item.watchlist_id,
                item.asset_id,
                item.position,
                item.added_at
            ],
        )?;
    }

    for note in &payload.notes {
        // A note's asset reference is optional, so a missing asset becomes a loose note rather
        // than a dropped one. Losing someone's writing is the worst outcome available here.
        let asset_id = match note.asset_id.as_deref() {
            Some(id) => {
                let exists: i64 =
                    conn.query_row("SELECT COUNT(*) FROM assets WHERE id = ?1", [id], |row| {
                        row.get(0)
                    })?;
                if exists == 0 {
                    None
                } else {
                    Some(id.to_string())
                }
            }
            None => None,
        };

        conn.execute(
            "INSERT INTO notes (id, asset_id, title, body_md, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                 asset_id = excluded.asset_id,
                 title = excluded.title,
                 body_md = excluded.body_md,
                 updated_at = excluded.updated_at",
            params![
                note.id,
                asset_id,
                note.title,
                note.body_md,
                note.created_at,
                note.updated_at
            ],
        )?;
    }

    for progress in &payload.progress {
        conn.execute(
            "INSERT INTO learning_progress (item_id, path_id, status, completed_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(item_id) DO UPDATE SET
                 path_id = excluded.path_id,
                 status = excluded.status,
                 completed_at = excluded.completed_at,
                 updated_at = excluded.updated_at",
            params![
                progress.item_id,
                progress.path_id,
                progress.status,
                progress.completed_at,
                progress.updated_at
            ],
        )?;
    }

    for bookmark in &payload.bookmarks {
        conn.execute(
            "INSERT INTO bookmarks (kind, ref_id, created_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(kind, ref_id) DO NOTHING",
            params![bookmark.kind, bookmark.ref_id, bookmark.created_at],
        )?;
    }

    for preference in &payload.preferences {
        // Validated against the same closed set a live write goes through. A profile is not a
        // way around the rules that apply when the user changes a setting in the app.
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&preference.value) else {
            tracing::warn!(key = %preference.key, "skipping an unreadable preference");
            continue;
        };
        if let Err(reason) = crate::models::validate_preference(&preference.key, &value) {
            tracing::warn!(key = %preference.key, reason, "skipping an invalid preference");
            continue;
        }

        conn.execute(
            "INSERT INTO preferences (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![preference.key, preference.value, crate::models::now_epoch_secs()],
        )?;
    }

    for provider in &payload.providers {
        // `has_credential` is forced to 0. The key is on the machine that has it, not in the
        // file — see the module doc.
        conn.execute(
            "INSERT INTO provider_config
                 (provider_id, kind, enabled, has_credential, base_url, config_json, updated_at)
             VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)
             ON CONFLICT(provider_id) DO UPDATE SET
                 enabled = excluded.enabled,
                 base_url = excluded.base_url,
                 config_json = excluded.config_json,
                 updated_at = excluded.updated_at",
            params![
                provider.provider_id,
                provider.kind,
                provider.enabled as i64,
                provider.base_url,
                provider.config_json,
                crate::models::now_epoch_secs()
            ],
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrations::run(&mut conn, None).unwrap();
        conn
    }

    fn seed(conn: &Connection) {
        conn.execute_batch(
            "INSERT INTO assets (id, asset_type, symbol, name, currency, created_at, updated_at)
             VALUES ('crypto:cg:bitcoin','crypto','BTC','Bitcoin','USD',1,1);
             INSERT INTO watchlists (id, name, position, is_default, created_at, updated_at)
             VALUES ('wl-1','My list',0,1,1,1);
             INSERT INTO watchlist_items (watchlist_id, asset_id, position, added_at)
             VALUES ('wl-1','crypto:cg:bitcoin',0,1);
             INSERT INTO notes (id, asset_id, title, body_md, created_at, updated_at)
             VALUES ('note-1','crypto:cg:bitcoin','A title','Some body',1,1);
             INSERT INTO learning_progress (item_id, path_id, status, updated_at)
             VALUES ('lesson-1','stocks-basics','completed',1);
             INSERT INTO bookmarks (kind, ref_id, created_at) VALUES ('glossary','etf',1);
             INSERT INTO preferences (key, value, updated_at) VALUES ('theme','\"soft\"',1);
             INSERT INTO provider_config (provider_id, kind, enabled, has_credential, updated_at)
             VALUES ('finnhub','market',1,1,1);",
        )
        .unwrap();
    }

    #[test]
    fn gathers_the_user_s_own_data() {
        let conn = db();
        seed(&conn);

        let payload = gather(&conn, 2, 100).unwrap();

        assert_eq!(payload.watchlists.len(), 1);
        assert_eq!(payload.watchlist_items.len(), 1);
        assert_eq!(payload.notes.len(), 1);
        assert_eq!(payload.progress.len(), 1);
        assert_eq!(payload.bookmarks.len(), 1);
        assert_eq!(payload.assets.len(), 1);
        assert_eq!(payload.schema_version, 2);
    }

    /// The load-bearing test for DATA_MODEL.md §6: a credential flag must not travel, so a
    /// profile moved to another machine cannot claim a key exists there.
    #[test]
    fn no_credential_material_is_gathered() {
        let conn = db();
        seed(&conn);

        let payload = gather(&conn, 2, 100).unwrap();
        let json = serde_json::to_string(&payload).unwrap().to_lowercase();

        assert!(!json.contains("hascredential"));
        assert!(!json.contains("has_credential"));
        assert!(!json.contains("api_key"));
        assert!(!json.contains("apikey"));
        assert!(!json.contains("secret"));
        assert!(!json.contains("password"));
    }

    #[test]
    fn importing_marks_every_provider_as_unkeyed() {
        let source = db();
        seed(&source);
        let payload = gather(&source, 2, 100).unwrap();

        let target = db();
        apply(&target, &payload, ImportMode::Merge).unwrap();

        let has_credential: i64 = target
            .query_row(
                "SELECT has_credential FROM provider_config WHERE provider_id = 'finnhub'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            has_credential, 0,
            "an imported provider must not claim a key this machine does not have"
        );
    }

    #[test]
    fn a_profile_round_trips_into_an_empty_database() {
        let source = db();
        seed(&source);
        let payload = gather(&source, 2, 100).unwrap();

        let target = db();
        apply(&target, &payload, ImportMode::Merge).unwrap();

        let round_tripped = gather(&target, 2, 200).unwrap();
        assert_eq!(round_tripped.watchlists.len(), 1);
        assert_eq!(round_tripped.notes.len(), 1);
        assert_eq!(round_tripped.notes[0].body_md, "Some body");
        assert_eq!(round_tripped.bookmarks.len(), 1);

        let theme: String = target
            .query_row(
                "SELECT value FROM preferences WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(theme, "\"soft\"");
    }

    #[test]
    fn merge_keeps_what_is_already_here() {
        let source = db();
        seed(&source);
        let payload = gather(&source, 2, 100).unwrap();

        let target = db();
        target
            .execute(
                "INSERT INTO notes (id, title, body_md, created_at, updated_at)
                 VALUES ('note-local','Local note','kept',1,1)",
                [],
            )
            .unwrap();

        apply(&target, &payload, ImportMode::Merge).unwrap();

        let count: i64 = target
            .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2, "merge must not delete local work");
    }

    #[test]
    fn replace_clears_what_is_already_here() {
        let source = db();
        seed(&source);
        let payload = gather(&source, 2, 100).unwrap();

        let target = db();
        target
            .execute(
                "INSERT INTO notes (id, title, body_md, created_at, updated_at)
                 VALUES ('note-local','Local note','replaced',1,1)",
                [],
            )
            .unwrap();

        apply(&target, &payload, ImportMode::Replace).unwrap();

        let ids: Vec<String> = {
            let mut stmt = target.prepare("SELECT id FROM notes ORDER BY id").unwrap();
            let rows = stmt.query_map([], |row| row.get(0)).unwrap();
            rows.map(Result::unwrap).collect()
        };
        assert_eq!(ids, vec!["note-1".to_string()]);
    }

    /// A valid tag proves provenance, not sanity. These are the checks that stop a file someone
    /// crafted from putting nonsense into a CHECK-constrained column and aborting mid-import.
    #[test]
    fn a_payload_with_impossible_values_is_refused_before_any_write() {
        let conn = db();
        seed(&conn);
        let mut payload = gather(&conn, 2, 100).unwrap();

        payload.assets[0].asset_type = "derivative".into();
        assert!(validate(&payload, 2).is_err());

        let mut payload = gather(&conn, 2, 100).unwrap();
        payload.progress[0].status = "mastered".into();
        assert!(validate(&payload, 2).is_err());

        let mut payload = gather(&conn, 2, 100).unwrap();
        payload.bookmarks[0].kind = "spell".into();
        assert!(validate(&payload, 2).is_err());

        let mut payload = gather(&conn, 2, 100).unwrap();
        payload.providers[0].base_url = Some("not a url".into());
        assert!(validate(&payload, 2).is_err());

        let mut payload = gather(&conn, 2, 100).unwrap();
        payload.providers[0].config_json = "{not json".into();
        assert!(validate(&payload, 2).is_err());
    }

    #[test]
    fn a_profile_from_a_newer_schema_is_refused() {
        let conn = db();
        let payload = gather(&conn, 99, 100).unwrap();
        assert!(validate(&payload, 2).is_err());
    }

    /// A profile must not be a way around the validation a live preference write goes through.
    #[test]
    fn invalid_preferences_are_dropped_rather_than_written() {
        let conn = db();
        let mut payload = gather(&conn, 2, 100).unwrap();
        payload.preferences = vec![
            ExportedPreference {
                key: "theme".into(),
                value: "\"neon\"".into(),
            },
            ExportedPreference {
                key: "isAdmin".into(),
                value: "true".into(),
            },
            ExportedPreference {
                key: "theme".into(),
                value: "\"light\"".into(),
            },
        ];

        let target = db();
        apply(&target, &payload, ImportMode::Merge).unwrap();

        let count: i64 = target
            .query_row(
                "SELECT COUNT(*) FROM preferences WHERE key = 'isAdmin'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "an unknown preference key must not be written");

        let theme: String = target
            .query_row(
                "SELECT value FROM preferences WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            theme, "\"light\"",
            "the invalid theme must have been skipped"
        );
    }

    /// A slightly inconsistent file should import what it can rather than failing entirely.
    #[test]
    fn an_item_whose_asset_is_missing_is_skipped_not_fatal() {
        let conn = db();
        seed(&conn);
        let mut payload = gather(&conn, 2, 100).unwrap();
        payload.assets.clear();
        payload.asset_refs.clear();

        let target = db();
        apply(&target, &payload, ImportMode::Merge).unwrap();

        let items: i64 = target
            .query_row("SELECT COUNT(*) FROM watchlist_items", [], |row| row.get(0))
            .unwrap();
        assert_eq!(items, 0);

        // The list itself and the note survive; the note simply loses its asset link.
        let lists: i64 = target
            .query_row("SELECT COUNT(*) FROM watchlists", [], |row| row.get(0))
            .unwrap();
        assert_eq!(lists, 1);

        let note_asset: Option<String> = target
            .query_row(
                "SELECT asset_id FROM notes WHERE id = 'note-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(note_asset, None, "the note is kept, without its dead link");
    }
}
