use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    /// Closed set, enforced by `validate_preference`. Kept in step with `VALID_THEMES`.
    #[cfg_attr(test, ts(type = "\"dark\" | \"light\" | \"soft\""))]
    pub theme: String,
    pub region: String,
    pub display_currency: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub refresh_interval_secs: i64,
    pub refresh_when_unfocused: bool,
    /// Closed set, enforced by `validate_preference`. Kept in step with `VALID_MOTION`.
    #[cfg_attr(test, ts(type = "\"system\" | \"always\" | \"never\""))]
    pub reduced_motion: String,
    pub community_enabled: bool,
    pub ai_enabled: bool,
    /// Which configured AI provider the Model Desk uses. Both can be set up; one is active.
    #[cfg_attr(test, ts(type = "\"local\" | \"cloud\""))]
    pub ai_mode: String,
    /// How sales are matched against purchases. Jurisdictional, so the user chooses — see
    /// `models::portfolio::CostBasisMethod`.
    #[cfg_attr(test, ts(type = "\"fifo\" | \"average\""))]
    pub cost_basis_method: String,
    pub nav_rail_expanded: bool,
    pub onboarding_completed: bool,
}

impl Default for Preferences {
    /// Defaults from PRODUCT_SCOPE_V0_1.md §"Defaults": dark theme, USD, and every outbound
    /// feature off until the user turns it on.
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            region: "global".into(),
            display_currency: "USD".into(),
            refresh_interval_secs: 60,
            refresh_when_unfocused: true,
            reduced_motion: "system".into(),
            community_enabled: false,
            ai_enabled: false,
            // Local is the default because it is the mode that sends nothing anywhere.
            ai_mode: "local".into(),
            // FIFO is the more commonly mandated of the two.
            cost_basis_method: "fifo".into(),
            nav_rail_expanded: false,
            onboarding_completed: false,
        }
    }
}

/// Preference keys are a closed set. An unknown key from the frontend is a bug or an attack,
/// not something to persist blindly.
pub const KNOWN_PREFERENCE_KEYS: &[&str] = &[
    "theme",
    "region",
    "displayCurrency",
    "refreshIntervalSecs",
    "refreshWhenUnfocused",
    "reducedMotion",
    "communityEnabled",
    "aiEnabled",
    "aiMode",
    "costBasisMethod",
    "navRailExpanded",
    "onboardingCompleted",
];

pub const VALID_THEMES: &[&str] = &["dark", "light", "soft"];
pub const VALID_MOTION: &[&str] = &["system", "always", "never"];
pub const VALID_AI_MODES: &[&str] = &["local", "cloud"];
pub const VALID_COST_BASIS: &[&str] = &["fifo", "average"];

/// Validates a single preference write. Values arrive JSON-encoded from the frontend.
pub fn validate_preference(key: &str, value: &serde_json::Value) -> Result<(), String> {
    if !KNOWN_PREFERENCE_KEYS.contains(&key) {
        return Err(format!("unknown preference key: {key}"));
    }

    match key {
        "theme" => match value.as_str() {
            Some(v) if VALID_THEMES.contains(&v) => Ok(()),
            _ => Err("theme must be dark, light or soft".into()),
        },
        "aiMode" => match value.as_str() {
            Some(v) if VALID_AI_MODES.contains(&v) => Ok(()),
            _ => Err("aiMode must be local or cloud".into()),
        },
        "costBasisMethod" => match value.as_str() {
            Some(v) if VALID_COST_BASIS.contains(&v) => Ok(()),
            _ => Err("costBasisMethod must be fifo or average".into()),
        },
        "reducedMotion" => match value.as_str() {
            Some(v) if VALID_MOTION.contains(&v) => Ok(()),
            _ => Err("reducedMotion must be system, always or never".into()),
        },
        "refreshIntervalSecs" => match value.as_i64() {
            // A floor of 15s protects free provider tiers from a user setting 1s and
            // burning their quota in a minute.
            Some(v) if (15..=3600).contains(&v) => Ok(()),
            _ => Err("refreshIntervalSecs must be between 15 and 3600".into()),
        },
        "displayCurrency" => match value.as_str() {
            Some(v) if v.len() == 3 && v.chars().all(|c| c.is_ascii_alphabetic()) => Ok(()),
            _ => Err("displayCurrency must be a 3-letter code".into()),
        },
        "region" => match value.as_str() {
            Some(v) if !v.is_empty() && v.len() <= 16 => Ok(()),
            _ => Err("region must be a short identifier".into()),
        },
        "refreshWhenUnfocused"
        | "communityEnabled"
        | "aiEnabled"
        | "navRailExpanded"
        | "onboardingCompleted" => {
            if value.is_boolean() {
                Ok(())
            } else {
                Err(format!("{key} must be true or false"))
            }
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_unknown_keys() {
        assert!(validate_preference("isAdmin", &json!(true)).is_err());
    }

    #[test]
    fn validates_theme_values() {
        assert!(validate_preference("theme", &json!("soft")).is_ok());
        assert!(validate_preference("theme", &json!("neon")).is_err());
        assert!(validate_preference("theme", &json!(3)).is_err());
    }

    #[test]
    fn enforces_refresh_floor_to_protect_provider_quotas() {
        assert!(validate_preference("refreshIntervalSecs", &json!(15)).is_ok());
        assert!(validate_preference("refreshIntervalSecs", &json!(1)).is_err());
        assert!(validate_preference("refreshIntervalSecs", &json!(99_999)).is_err());
    }

    #[test]
    fn booleans_must_be_booleans() {
        assert!(validate_preference("aiEnabled", &json!(true)).is_ok());
        assert!(validate_preference("aiEnabled", &json!("yes")).is_err());
    }

    #[test]
    fn defaults_keep_outbound_features_off() {
        let prefs = Preferences::default();
        assert!(!prefs.ai_enabled, "AI must be off by default");
        assert!(!prefs.community_enabled, "community must be off by default");
        assert_eq!(prefs.theme, "dark");
        // Local is the mode that sends nothing off the machine, so it is the one you get.
        assert_eq!(prefs.ai_mode, "local");
    }

    #[test]
    fn ai_mode_is_a_closed_set() {
        assert!(validate_preference("aiMode", &json!("local")).is_ok());
        assert!(validate_preference("aiMode", &json!("cloud")).is_ok());
        assert!(validate_preference("aiMode", &json!("anything-else")).is_err());
    }
}
