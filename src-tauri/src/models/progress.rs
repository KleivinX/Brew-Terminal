use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProgressStatus {
    NotStarted,
    InProgress,
    Completed,
}

impl ProgressStatus {
    /// Matches the CHECK constraint on `learning_progress.status`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NotStarted => "not_started",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "not_started" => Some(Self::NotStarted),
            "in_progress" => Some(Self::InProgress),
            "completed" => Some(Self::Completed),
            _ => None,
        }
    }
}

/// Progress against a single lesson.
///
/// Learning progress is local and carries no scores, no streaks and no comparison to anyone
/// else — it exists so a reader can find their place again, not to gamify anything.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LearningProgress {
    pub item_id: String,
    pub path_id: String,
    pub status: ProgressStatus,
    pub completed_at: Option<i64>,
    pub updated_at: i64,
}
