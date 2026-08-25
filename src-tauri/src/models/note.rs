use serde::{Deserialize, Serialize};

/// A locally stored research note.
///
/// Notes never leave the device on their own: they are excluded from any provider request, and
/// attaching one to a model prompt takes a separate, explicit action (see AI_POLICY.md §2).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// `None` for a general note not tied to an asset.
    pub asset_id: Option<String>,
    pub title: String,
    /// Markdown source. Rendered as plain text for now — introducing a Markdown renderer
    /// means introducing an HTML-injection surface. See DEPENDENCIES.md.
    pub body_md: String,
    pub created_at: i64,
    pub updated_at: i64,
}
