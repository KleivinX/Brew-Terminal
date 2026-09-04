use serde::{Deserialize, Serialize};

/// Which screen a saved view belongs to.
///
/// Checked in the schema as well as here: a compare selection applied to the screener would be
/// a payload the screen has no idea how to read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "lowercase")]
pub enum SavedViewKind {
    Screener,
    Compare,
}

impl SavedViewKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Screener => "screener",
            Self::Compare => "compare",
        }
    }
}

/// A named screener filter set or compare selection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct SavedView {
    pub id: String,
    pub kind: SavedViewKind,
    pub name: String,
    /// JSON, opaque to Rust. The screen that wrote it owns the shape and validates it on read —
    /// see `0006_saved_views.sql`.
    pub payload: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub created_at: i64,
    #[cfg_attr(test, ts(type = "number"))]
    pub updated_at: i64,
}

/// Long enough for a descriptive name, short enough to render in a list without truncation.
pub const MAX_VIEW_NAME: usize = 60;

/// A ceiling on the payload.
///
/// The real ones are a few hundred bytes. This is not a size the UI can reach by accident; it
/// is here because `payload` is the one field Rust does not understand, and an opaque field
/// with no limit is a way to put a megabyte in a row.
pub const MAX_VIEW_PAYLOAD: usize = 16 * 1024;

impl SavedView {
    pub fn validate_name(name: &str) -> Result<String, String> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Give the view a name.".into());
        }
        if trimmed.chars().count() > MAX_VIEW_NAME {
            return Err(format!("Names are limited to {MAX_VIEW_NAME} characters."));
        }
        Ok(trimmed.to_string())
    }

    pub fn validate_payload(payload: &str) -> Result<(), String> {
        if payload.len() > MAX_VIEW_PAYLOAD {
            return Err("That view is too large to save.".into());
        }
        // Parsed but not interpreted. Storing something that will not read back as JSON turns a
        // save into a row the screen can only ever fail on.
        serde_json::from_str::<serde_json::Value>(payload)
            .map_err(|_| "That view could not be stored.".to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_required_and_trimmed() {
        assert_eq!(
            SavedView::validate_name("  Large caps  ").unwrap(),
            "Large caps"
        );
        assert!(SavedView::validate_name("   ").is_err());
        assert!(SavedView::validate_name("").is_err());
    }

    #[test]
    fn an_over_long_name_is_refused_by_characters_not_bytes() {
        // A name of emoji is 60 characters and far more bytes; counting bytes would refuse a
        // name that renders perfectly well.
        let sixty = "🚀".repeat(MAX_VIEW_NAME);
        assert!(SavedView::validate_name(&sixty).is_ok());
        assert!(SavedView::validate_name(&"🚀".repeat(MAX_VIEW_NAME + 1)).is_err());
    }

    #[test]
    fn a_payload_has_to_be_json() {
        assert!(SavedView::validate_payload(r#"{"minPrice":10}"#).is_ok());
        assert!(SavedView::validate_payload("[]").is_ok());
        assert!(SavedView::validate_payload("not json").is_err());
        assert!(SavedView::validate_payload("").is_err());
    }

    #[test]
    fn an_oversized_payload_is_refused() {
        let huge = format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_VIEW_PAYLOAD));
        assert!(SavedView::validate_payload(&huge).is_err());
    }
}
