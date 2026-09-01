use rusqlite::Connection;
use serde_json::Value;

use crate::error::{AppError, AppResult};
use crate::models::{validate_preference, Preferences};

use super::pool::DbConnection;

/// Preferences are a key/value table, but the app-level type is a struct. This reads every
/// stored row over the defaults, so a key that has never been written simply keeps its default
/// rather than becoming a `None` the UI has to handle.
pub fn get_all(conn: &Connection) -> AppResult<Preferences> {
    let mut prefs = Preferences::default();

    let mut stmt = conn.prepare("SELECT key, value FROM preferences")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in rows {
        let (key, raw) = row?;
        let Ok(value) = serde_json::from_str::<Value>(&raw) else {
            tracing::warn!(key, "skipping preference with unparseable value");
            continue;
        };

        match key.as_str() {
            "theme" => assign_string(&mut prefs.theme, value),
            "region" => assign_string(&mut prefs.region, value),
            "displayCurrency" => assign_string(&mut prefs.display_currency, value),
            "reducedMotion" => assign_string(&mut prefs.reduced_motion, value),
            "aiMode" => assign_string(&mut prefs.ai_mode, value),
            "costBasisMethod" => assign_string(&mut prefs.cost_basis_method, value),
            "refreshIntervalSecs" => {
                if let Some(v) = value.as_i64() {
                    prefs.refresh_interval_secs = v;
                }
            }
            "refreshWhenUnfocused" => assign_bool(&mut prefs.refresh_when_unfocused, value),
            "communityEnabled" => assign_bool(&mut prefs.community_enabled, value),
            "aiEnabled" => assign_bool(&mut prefs.ai_enabled, value),
            "navRailExpanded" => assign_bool(&mut prefs.nav_rail_expanded, value),
            "onboardingCompleted" => assign_bool(&mut prefs.onboarding_completed, value),
            unknown => tracing::warn!(key = unknown, "ignoring unknown preference row"),
        }
    }

    Ok(prefs)
}

fn assign_string(target: &mut String, value: Value) {
    if let Some(v) = value.as_str() {
        *target = v.to_string();
    }
}

fn assign_bool(target: &mut bool, value: Value) {
    if let Some(v) = value.as_bool() {
        *target = v;
    }
}

/// Writes a single preference. The value arrives JSON-encoded from the frontend and is
/// validated against the closed key set before it is stored.
pub fn set(conn: &DbConnection, key: &str, raw_value: &str, now: i64) -> AppResult<()> {
    let value: Value = serde_json::from_str(raw_value).map_err(|_| AppError::Validation {
        field: key.to_string(),
        detail: "value is not valid JSON".into(),
    })?;

    validate_preference(key, &value).map_err(|detail| AppError::Validation {
        field: key.to_string(),
        detail,
    })?;

    conn.execute(
        "INSERT INTO preferences (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, raw_value, now],
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
    fn returns_defaults_when_nothing_is_stored() {
        let p = setup();
        let conn = p.get().unwrap();
        let prefs = get_all(&conn).unwrap();

        assert_eq!(prefs.theme, "dark");
        assert!(!prefs.ai_enabled);
        assert!(!prefs.community_enabled);
    }

    #[test]
    fn round_trips_a_written_value() {
        let p = setup();
        let conn = p.get().unwrap();

        set(&conn, "theme", "\"soft\"", 1000).unwrap();
        assert_eq!(get_all(&conn).unwrap().theme, "soft");
    }

    #[test]
    fn overwrites_rather_than_duplicating() {
        let p = setup();
        let conn = p.get().unwrap();

        set(&conn, "theme", "\"soft\"", 1000).unwrap();
        set(&conn, "theme", "\"light\"", 2000).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM preferences WHERE key = 'theme'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(get_all(&conn).unwrap().theme, "light");
    }

    #[test]
    fn rejects_invalid_values() {
        let p = setup();
        let conn = p.get().unwrap();

        assert!(set(&conn, "theme", "\"neon\"", 1000).is_err());
        assert!(set(&conn, "isAdmin", "true", 1000).is_err());
        assert!(set(&conn, "refreshIntervalSecs", "1", 1000).is_err());
    }

    /// A corrupt row must not take down the whole preferences read — the user would be left
    /// with an app that cannot start over one bad value.
    #[test]
    fn survives_an_unparseable_row() {
        let p = setup();
        let conn = p.get().unwrap();

        conn.execute(
            "INSERT INTO preferences (key, value, updated_at) VALUES ('theme', 'not json', 1)",
            [],
        )
        .unwrap();

        let prefs = get_all(&conn).unwrap();
        assert_eq!(prefs.theme, "dark", "falls back to the default");
    }
}
