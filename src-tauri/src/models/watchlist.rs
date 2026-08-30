use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct Watchlist {
    pub id: String,
    pub name: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub position: i64,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct WatchlistItem {
    pub watchlist_id: String,
    pub asset_id: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub position: i64,
    #[cfg_attr(test, ts(type = "number"))]
    pub added_at: i64,
}

pub const MAX_WATCHLIST_NAME_LEN: usize = 64;

pub fn validate_watchlist_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("a watchlist needs a name".into());
    }
    if trimmed.chars().count() > MAX_WATCHLIST_NAME_LEN {
        return Err(format!(
            "names are limited to {MAX_WATCHLIST_NAME_LEN} characters"
        ));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_and_accepts_reasonable_names() {
        assert_eq!(validate_watchlist_name("  Crypto  ").unwrap(), "Crypto");
    }

    #[test]
    fn rejects_blank_names() {
        assert!(validate_watchlist_name("   ").is_err());
    }

    #[test]
    fn rejects_overlong_names() {
        assert!(validate_watchlist_name(&"x".repeat(65)).is_err());
    }

    #[test]
    fn counts_characters_not_bytes() {
        // 64 multi-byte characters is 64 characters, not 192 bytes over the limit.
        assert!(validate_watchlist_name(&"é".repeat(64)).is_ok());
    }
}
