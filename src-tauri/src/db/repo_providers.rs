use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;
use crate::models::now_epoch_secs;

/// Stored, non-secret provider configuration.
///
/// `has_credential` is a cached flag only — the keychain is the source of truth, and this row
/// is reconciled against it on read. The key itself never touches this table.
#[derive(Debug, Clone)]
pub struct ProviderConfigRow {
    pub provider_id: String,
    pub kind: String,
    pub enabled: bool,
    pub has_credential: bool,
    pub base_url: Option<String>,
    pub last_error: Option<String>,
}

pub fn upsert_defaults(conn: &Connection, defaults: &[(&str, &str, bool)]) -> AppResult<()> {
    let now = now_epoch_secs();
    for (provider_id, kind, enabled) in defaults {
        // ON CONFLICT DO NOTHING: a user who disabled a provider must not have it silently
        // re-enabled every time the app starts.
        conn.execute(
            "INSERT INTO provider_config (provider_id, kind, enabled, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(provider_id) DO NOTHING",
            params![provider_id, kind, *enabled as i64, now],
        )?;
    }
    Ok(())
}

pub fn list(conn: &Connection) -> AppResult<Vec<ProviderConfigRow>> {
    let mut stmt = conn.prepare(
        "SELECT provider_id, kind, enabled, has_credential, base_url, last_error
         FROM provider_config ORDER BY provider_id",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ProviderConfigRow {
            provider_id: row.get(0)?,
            kind: row.get(1)?,
            enabled: row.get::<_, i64>(2)? != 0,
            has_credential: row.get::<_, i64>(3)? != 0,
            base_url: row.get(4)?,
            last_error: row.get(5)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get(conn: &Connection, provider_id: &str) -> AppResult<Option<ProviderConfigRow>> {
    let row = conn
        .query_row(
            "SELECT provider_id, kind, enabled, has_credential, base_url, last_error
             FROM provider_config WHERE provider_id = ?1",
            [provider_id],
            |row| {
                Ok(ProviderConfigRow {
                    provider_id: row.get(0)?,
                    kind: row.get(1)?,
                    enabled: row.get::<_, i64>(2)? != 0,
                    has_credential: row.get::<_, i64>(3)? != 0,
                    base_url: row.get(4)?,
                    last_error: row.get(5)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

pub fn is_enabled(conn: &Connection, provider_id: &str) -> bool {
    get(conn, provider_id)
        .ok()
        .flatten()
        .map(|row| row.enabled)
        .unwrap_or(false)
}

pub fn set_enabled(conn: &Connection, provider_id: &str, enabled: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE provider_config SET enabled = ?2, updated_at = ?3 WHERE provider_id = ?1",
        params![provider_id, enabled as i64, now_epoch_secs()],
    )?;
    Ok(())
}

/// Records whether a credential exists. A flag, never a key — see THREAT_MODEL.md §4.
pub fn set_has_credential(conn: &Connection, provider_id: &str, present: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE provider_config SET has_credential = ?2, updated_at = ?3 WHERE provider_id = ?1",
        params![provider_id, present as i64, now_epoch_secs()],
    )?;
    Ok(())
}

/// Stores a user-safe error string for display. Callers must pass an already-redacted message.
pub fn set_last_error(conn: &Connection, provider_id: &str, error: Option<&str>) -> AppResult<()> {
    conn.execute(
        "UPDATE provider_config SET last_error = ?2, last_ok_at = CASE WHEN ?2 IS NULL THEN ?3 ELSE last_ok_at END, updated_at = ?3
         WHERE provider_id = ?1",
        params![provider_id, error, now_epoch_secs()],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{migrations, pool};

    fn setup() -> pool::DbPool {
        let p = pool::create_in_memory().unwrap();
        let mut conn = p.get().unwrap();
        migrations::run(&mut conn, None).unwrap();
        drop(conn);
        p
    }

    #[test]
    fn seeds_defaults_once() {
        let p = setup();
        let conn = p.get().unwrap();

        upsert_defaults(
            &conn,
            &[("coingecko", "market", true), ("finnhub", "market", false)],
        )
        .unwrap();
        assert_eq!(list(&conn).unwrap().len(), 2);
        assert!(is_enabled(&conn, "coingecko"));
        assert!(!is_enabled(&conn, "finnhub"));
    }

    #[test]
    fn a_users_choice_survives_reseeding() {
        // Startup re-seeds defaults every launch; disabling a provider must stick.
        let p = setup();
        let conn = p.get().unwrap();

        upsert_defaults(&conn, &[("coingecko", "market", true)]).unwrap();
        set_enabled(&conn, "coingecko", false).unwrap();

        upsert_defaults(&conn, &[("coingecko", "market", true)]).unwrap();
        assert!(
            !is_enabled(&conn, "coingecko"),
            "must not be re-enabled behind the user"
        );
    }

    #[test]
    fn credential_flag_round_trips() {
        let p = setup();
        let conn = p.get().unwrap();
        upsert_defaults(&conn, &[("finnhub", "market", false)]).unwrap();

        set_has_credential(&conn, "finnhub", true).unwrap();
        assert!(get(&conn, "finnhub").unwrap().unwrap().has_credential);

        set_has_credential(&conn, "finnhub", false).unwrap();
        assert!(!get(&conn, "finnhub").unwrap().unwrap().has_credential);
    }

    #[test]
    fn unknown_provider_is_not_enabled() {
        let p = setup();
        let conn = p.get().unwrap();
        assert!(!is_enabled(&conn, "nope"));
    }

    #[test]
    fn last_error_clears_on_success() {
        let p = setup();
        let conn = p.get().unwrap();
        upsert_defaults(&conn, &[("coingecko", "market", true)]).unwrap();

        set_last_error(&conn, "coingecko", Some("Could not reach the provider.")).unwrap();
        assert!(get(&conn, "coingecko")
            .unwrap()
            .unwrap()
            .last_error
            .is_some());

        set_last_error(&conn, "coingecko", None).unwrap();
        assert!(get(&conn, "coingecko")
            .unwrap()
            .unwrap()
            .last_error
            .is_none());
    }
}
