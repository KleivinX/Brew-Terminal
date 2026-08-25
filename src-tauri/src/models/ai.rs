use serde::{Deserialize, Serialize};

/// How the Model Desk is reaching a model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AiMode {
    Local,
    Cloud,
}

impl AiMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Cloud => "cloud",
        }
    }
}

/// Where a configured endpoint actually is, once its host has been resolved.
///
/// This is the entire basis for the "offline" claim in the UI. It is derived from a real
/// resolution of the host, never from the shape of the URL, because the two can disagree: a
/// hosts file can point `localhost` at another machine. Resolution failure is `Network`, so
/// the label fails closed — the app never claims offline because it could not check.
/// See AI_POLICY.md §1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EndpointReach {
    Loopback,
    Network,
}

impl EndpointReach {
    /// The exact label the UI shows. The wording is fixed by AI_POLICY.md §1 — "offline" is
    /// earned by `Loopback` and is unavailable in every other case.
    pub fn label(self, mode: AiMode) -> &'static str {
        match (mode, self) {
            (AiMode::Local, Self::Loopback) => "Local · offline",
            (AiMode::Local, Self::Network) => "Local endpoint · network",
            (AiMode::Cloud, _) => "Cloud · API",
        }
    }

    /// Whether traffic to this endpoint leaves the machine. Drives the pre-send warning.
    pub fn leaves_device(self) -> bool {
        matches!(self, Self::Network)
    }
}

/// What is stored about one of the two configurable providers.
///
/// `has_credential` is a flag, never a key and never a fragment of one — the same rule the
/// market providers follow. See THREAT_MODEL.md §4.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderSummary {
    pub configured: bool,
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub has_credential: bool,
}

/// What the Model Desk knows about its own configuration.
///
/// The top-level fields describe the **active** provider, so the desk can render without
/// caring which mode is selected. `local` and `cloud` carry both, so the settings page can
/// show each form filled in without a second round trip — and so switching modes does not
/// discard the configuration for the other one.
///
/// `endpoint` is present because the user typed it and needs to see it back; it is a host and
/// port, never a credential.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub configured: bool,
    /// The `aiEnabled` preference. Configured but disabled is a real state: the user set an
    /// endpoint up and then switched the feature off.
    pub enabled: bool,
    pub mode: AiMode,
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub reach: Option<EndpointReach>,
    /// Pre-rendered so one place decides the wording and the UI cannot drift from §1.
    pub reach_label: Option<String>,
    pub leaves_device: bool,
    /// True for cloud: the request carries a key, so it cannot run without one.
    pub requires_credential: bool,
    pub has_credential: bool,
    pub system_prompt_version: String,
    pub local: AiProviderSummary,
    pub cloud: AiProviderSummary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    System,
    User,
    Assistant,
}

impl ChatRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "system" => Some(Self::System),
            "user" => Some(Self::User),
            "assistant" => Some(Self::Assistant),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConversation {
    pub id: String,
    pub title: String,
    pub provider_id: String,
    pub mode: AiMode,
    pub model_name: Option<String>,
    pub system_prompt_version: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: ChatRole,
    pub content: String,
    pub created_at: i64,
}

/// One piece of quoted material the user chose to attach.
///
/// `kind` and `label` are what the outbound log records; `text` is what is actually sent and
/// is never logged. The split is the point — the log proves a send happened and how big it
/// was, without becoming a second copy of everything the user asked. See AI_POLICY.md §2.4.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiContextItem {
    /// e.g. `glossary-term`, `note`, `article`.
    pub kind: String,
    /// Human-readable, shown in the pre-send panel and stored in the log.
    pub label: String,
    pub text: String,
}

/// A row of the transparency log. Deliberately not the prompt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiOutboundEntry {
    pub id: String,
    pub provider_id: String,
    pub mode: String,
    pub conversation_id: Option<String>,
    pub char_count: i64,
    /// JSON array of `{kind, label}` — kinds of context, never the context itself.
    pub included_context: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSendResult {
    pub conversation_id: String,
    pub user_message: AiMessage,
    pub assistant_message: AiMessage,
}

/// What a send *would* transmit, computed before anything leaves.
///
/// The pre-send panel renders this. It exists as a separate command so the character count the
/// user is shown is the count of the bytes actually sent, rather than a frontend estimate that
/// can drift from what Rust assembles. See AI_POLICY.md §2.2.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSendPreview {
    pub char_count: i64,
    pub system_prompt_chars: i64,
    pub history_chars: i64,
    pub prompt_chars: i64,
    pub context_chars: i64,
    pub context_labels: Vec<String>,
    pub leaves_device: bool,
    pub reach_label: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The label wording is a product promise, not a string constant to be tidied. If someone
    /// renames these, this test is what stops "offline" appearing on a networked endpoint.
    #[test]
    fn offline_is_only_ever_claimed_for_loopback() {
        assert_eq!(
            EndpointReach::Loopback.label(AiMode::Local),
            "Local · offline"
        );
        assert_eq!(
            EndpointReach::Network.label(AiMode::Local),
            "Local endpoint · network"
        );
        assert_eq!(EndpointReach::Loopback.label(AiMode::Cloud), "Cloud · API");
        assert_eq!(EndpointReach::Network.label(AiMode::Cloud), "Cloud · API");
    }

    #[test]
    fn only_loopback_keeps_traffic_on_the_machine() {
        assert!(!EndpointReach::Loopback.leaves_device());
        assert!(EndpointReach::Network.leaves_device());
    }

    #[test]
    fn roles_round_trip() {
        for role in [ChatRole::System, ChatRole::User, ChatRole::Assistant] {
            assert_eq!(ChatRole::parse(role.as_str()), Some(role));
        }
        assert_eq!(ChatRole::parse("tool"), None);
    }
}
