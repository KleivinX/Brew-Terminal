use serde::{Deserialize, Serialize};

/// A locally stored research note.
///
/// Notes never leave the device on their own: they are excluded from any provider request, and
/// attaching one to a model prompt takes a separate, explicit action (see AI_POLICY.md §2).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// `None` for a general note not tied to an asset.
    pub asset_id: Option<String>,
    pub title: String,
    /// Markdown source. Rendered as plain text for now — introducing a Markdown renderer
    /// means introducing an HTML-injection surface. See DEPENDENCIES.md.
    pub body_md: String,
    /// The day this note is *about*, when it names one. `None` for a note about a holding
    /// rather than a moment, which is most of them.
    ///
    /// Not `created_at`: a note written today can be about last March, and pinning it to when
    /// it was typed would misplace the marker on exactly the note whose point is where it sits.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub pinned_at: Option<i64>,
    #[cfg_attr(test, ts(type = "number"))]
    pub created_at: i64,
    #[cfg_attr(test, ts(type = "number"))]
    pub updated_at: i64,
}
