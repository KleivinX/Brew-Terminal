use serde::{Deserialize, Serialize};

/// The decrypted contents of a `.brewprofile`.
///
/// What is in here and what is not is specified in DATA_MODEL.md §6, and the omissions are the
/// interesting part: no credential material, no cache, no rate-limit state, no AI transcripts
/// and no outbound log. A profile is the user's own work — lists, notes, progress, settings —
/// not a copy of everything the app happens to know.
///
/// `schema_version` is the app's database schema at export time. It is recorded so an import
/// can refuse a file from a future build rather than dropping columns it does not understand.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePayload {
    pub schema_version: i64,
    pub app_version: String,
    pub exported_at: i64,
    #[serde(default)]
    pub assets: Vec<ExportedAsset>,
    #[serde(default)]
    pub asset_refs: Vec<ExportedAssetRef>,
    #[serde(default)]
    pub watchlists: Vec<ExportedWatchlist>,
    #[serde(default)]
    pub watchlist_items: Vec<ExportedWatchlistItem>,
    #[serde(default)]
    pub notes: Vec<ExportedNote>,
    #[serde(default)]
    pub progress: Vec<ExportedProgress>,
    #[serde(default)]
    pub bookmarks: Vec<ExportedBookmark>,
    #[serde(default)]
    pub preferences: Vec<ExportedPreference>,
    #[serde(default)]
    pub providers: Vec<ExportedProvider>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedAsset {
    pub id: String,
    pub asset_type: String,
    pub symbol: String,
    pub name: String,
    pub currency: String,
    pub exchange: Option<String>,
    pub region: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedAssetRef {
    pub asset_id: String,
    pub provider_id: String,
    pub provider_symbol: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedWatchlist {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub is_default: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedWatchlistItem {
    pub watchlist_id: String,
    pub asset_id: String,
    pub position: i64,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedNote {
    pub id: String,
    pub asset_id: Option<String>,
    pub title: String,
    pub body_md: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedProgress {
    pub item_id: String,
    pub path_id: String,
    pub status: String,
    pub completed_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedBookmark {
    pub kind: String,
    pub ref_id: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedPreference {
    pub key: String,
    /// JSON-encoded, exactly as stored.
    pub value: String,
}

/// Provider configuration, minus anything secret.
///
/// `has_credential` is deliberately **not** exported and is written as `false` on import: the
/// key itself lives in the OS keychain of the machine that holds it, so importing a profile on
/// a new machine must not claim a credential exists there. The user re-enters it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedProvider {
    pub provider_id: String,
    pub kind: String,
    pub enabled: bool,
    pub base_url: Option<String>,
    pub config_json: String,
}

/// How an import should treat what is already on this machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "lowercase")]
pub enum ImportMode {
    /// Add and update; nothing already here is deleted.
    Merge,
    /// Clear the affected tables first. The pre-import backup is what makes this recoverable.
    Replace,
}

/// What a file contains, shown before anything is written.
///
/// Produced by decrypting and validating, without touching the database — so the user chooses
/// merge or replace while looking at real counts rather than a promise. See DATA_MODEL.md §6.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    #[cfg_attr(test, ts(type = "number"))]
    pub schema_version: i64,
    pub app_version: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub exported_at: i64,
    #[cfg_attr(test, ts(type = "number"))]
    pub watchlists: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub watchlist_items: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub notes: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub progress: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub bookmarks: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub preferences: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub providers: usize,
    #[cfg_attr(test, ts(type = "number"))]
    pub assets: usize,
}

impl ProfileSummary {
    pub fn of(payload: &ProfilePayload) -> Self {
        Self {
            schema_version: payload.schema_version,
            app_version: payload.app_version.clone(),
            exported_at: payload.exported_at,
            watchlists: payload.watchlists.len(),
            watchlist_items: payload.watchlist_items.len(),
            notes: payload.notes.len(),
            progress: payload.progress.len(),
            bookmarks: payload.bookmarks.len(),
            preferences: payload.preferences.len(),
            providers: payload.providers.len(),
            assets: payload.assets.len(),
        }
    }
}

/// The outcome of an import, reported after the transaction commits.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub mode: ImportMode,
    pub summary: ProfileSummary,
    /// Where the pre-import backup of the database was written.
    pub backup_path: String,
}
