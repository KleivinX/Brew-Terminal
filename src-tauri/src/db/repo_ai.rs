//! Storage for the Model Desk: endpoint configuration, conversations, and the outbound log.
//!
//! The split between `ai_messages` and `ai_outbound_log` is deliberate and load-bearing.
//! Messages are the user's own transcript, which they can delete. The outbound log is the
//! transparency record — that a send happened, to whom, and how large — and it deliberately
//! never contains prompt text, so it stays useful as evidence without becoming a second copy
//! of everything the user has ever asked. See AI_POLICY.md §2.4.

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::models::{AiConversation, AiMessage, AiMode, AiOutboundEntry, ChatRole};

/// A prompt is a question, not a document. The cap keeps one paste from filling a context
/// window and a database row at the same time.
pub const MAX_PROMPT_CHARS: usize = 8_000;
pub const MAX_TITLE_CHARS: usize = 80;

/// What is stored about the configured endpoint. No credential — that lives in the keychain.
#[derive(Debug, Clone, Default)]
pub struct AiEndpointConfig {
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub enabled: bool,
    pub has_credential: bool,
}

pub fn get_endpoint_config(conn: &Connection, provider_id: &str) -> AppResult<AiEndpointConfig> {
    let row = conn
        .query_row(
            "SELECT base_url, config_json, enabled, has_credential
             FROM provider_config WHERE provider_id = ?1",
            [provider_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)? != 0,
                    row.get::<_, i64>(3)? != 0,
                ))
            },
        )
        .optional()?;

    let Some((base_url, config_json, enabled, has_credential)) = row else {
        return Ok(AiEndpointConfig::default());
    };

    // A malformed config blob is treated as "no model set" rather than an error: the user can
    // fix it by saving the form again, and a hard failure here would lock them out of the page
    // that fixes it.
    let model = serde_json::from_str::<serde_json::Value>(&config_json)
        .ok()
        .and_then(|v| {
            v.get("model")
                .and_then(|m| m.as_str())
                .map(str::to_string)
                .filter(|m| !m.trim().is_empty())
        });

    Ok(AiEndpointConfig {
        base_url,
        model,
        enabled,
        has_credential,
    })
}

pub fn set_endpoint_config(
    conn: &Connection,
    provider_id: &str,
    base_url: &str,
    model: &str,
    now: i64,
) -> AppResult<()> {
    let config = serde_json::json!({ "model": model }).to_string();

    conn.execute(
        "INSERT INTO provider_config (provider_id, kind, enabled, base_url, config_json, updated_at)
         VALUES (?1, 'ai', 1, ?2, ?3, ?4)
         ON CONFLICT(provider_id) DO UPDATE SET
             base_url    = excluded.base_url,
             config_json = excluded.config_json,
             enabled     = 1,
             last_error  = NULL,
             updated_at  = excluded.updated_at",
        params![provider_id, base_url, config, now],
    )?;
    Ok(())
}

/// Forgets the endpoint. The conversations stay — deleting them is a separate, explicit act.
pub fn clear_endpoint_config(conn: &Connection, provider_id: &str, now: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE provider_config
         SET base_url = NULL, config_json = '{}', enabled = 0, last_error = NULL, updated_at = ?2
         WHERE provider_id = ?1",
        params![provider_id, now],
    )?;
    Ok(())
}

// --- conversations -----------------------------------------------------------------------

const CONVERSATION_SELECT: &str = "SELECT id, title, provider_id, mode, model_name, \
     system_prompt_version, created_at, updated_at FROM ai_conversations";

fn row_to_conversation(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiConversation> {
    let mode: String = row.get(3)?;
    Ok(AiConversation {
        id: row.get(0)?,
        title: row.get(1)?,
        provider_id: row.get(2)?,
        mode: if mode == "cloud" {
            AiMode::Cloud
        } else {
            AiMode::Local
        },
        model_name: row.get(4)?,
        system_prompt_version: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

/// Builds a conversation title from the opening prompt.
///
/// Trimmed to the first line so a pasted block does not become an 80-character title of
/// nothing, and ellipsised rather than hard-cut so the user can see it was shortened.
pub fn title_from_prompt(prompt: &str) -> String {
    let first_line = prompt.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let cleaned = first_line.trim();
    if cleaned.is_empty() {
        return "Untitled".to_string();
    }
    if cleaned.chars().count() <= MAX_TITLE_CHARS {
        return cleaned.to_string();
    }
    let head: String = cleaned.chars().take(MAX_TITLE_CHARS - 1).collect();
    format!("{}…", head.trim_end())
}

/// The fields of a new conversation row. A struct rather than a long parameter list because
/// these are one record, and six positional strings is a swap waiting to happen.
#[derive(Debug, Clone, Copy)]
pub struct NewConversation<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub provider_id: &'a str,
    pub mode: AiMode,
    pub model_name: &'a str,
    pub system_prompt_version: &'a str,
    pub created_at: i64,
}

pub fn create_conversation(
    conn: &Connection,
    new: NewConversation<'_>,
) -> AppResult<AiConversation> {
    conn.execute(
        "INSERT INTO ai_conversations
             (id, title, provider_id, mode, model_name, system_prompt_version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            new.id,
            new.title,
            new.provider_id,
            new.mode.as_str(),
            new.model_name,
            new.system_prompt_version,
            new.created_at
        ],
    )?;

    get_conversation(conn, new.id)?.ok_or(AppError::NotFound)
}

pub fn get_conversation(conn: &Connection, id: &str) -> AppResult<Option<AiConversation>> {
    let sql = format!("{CONVERSATION_SELECT} WHERE id = ?1");
    Ok(conn.query_row(&sql, [id], row_to_conversation).optional()?)
}

pub fn list_conversations(conn: &Connection) -> AppResult<Vec<AiConversation>> {
    let sql = format!("{CONVERSATION_SELECT} ORDER BY updated_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_conversation)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn touch_conversation(conn: &Connection, id: &str, now: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE ai_conversations SET updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

pub fn delete_conversation(conn: &Connection, id: &str) -> AppResult<()> {
    // ai_messages cascades. The outbound log does not — it is the record that a send happened,
    // and it survives the transcript being deleted. Clearing it is its own action on the
    // Privacy page, so the two deletions stay distinguishable. See AI_POLICY.md §2.4.
    conn.execute("DELETE FROM ai_conversations WHERE id = ?1", [id])?;
    Ok(())
}

pub fn delete_all_conversations(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM ai_conversations", [])?;
    Ok(())
}

// --- messages ----------------------------------------------------------------------------

const MESSAGE_SELECT: &str =
    "SELECT id, conversation_id, role, content, created_at FROM ai_messages";

fn row_to_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<AiMessage> {
    let role: String = row.get(2)?;
    Ok(AiMessage {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        role: ChatRole::parse(&role).unwrap_or(ChatRole::User),
        content: row.get(3)?,
        created_at: row.get(4)?,
    })
}

pub fn append_message(
    conn: &Connection,
    id: &str,
    conversation_id: &str,
    role: ChatRole,
    content: &str,
    now: i64,
) -> AppResult<AiMessage> {
    conn.execute(
        "INSERT INTO ai_messages (id, conversation_id, role, content, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, conversation_id, role.as_str(), content, now],
    )?;

    let sql = format!("{MESSAGE_SELECT} WHERE id = ?1");
    Ok(conn.query_row(&sql, [id], row_to_message)?)
}

pub fn list_messages(conn: &Connection, conversation_id: &str) -> AppResult<Vec<AiMessage>> {
    let sql = format!("{MESSAGE_SELECT} WHERE conversation_id = ?1 ORDER BY created_at, rowid");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([conversation_id], row_to_message)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

// --- outbound log ------------------------------------------------------------------------

/// Records that a send happened.
///
/// `included_context` is a JSON array of `{kind, label}`. Never the context text, and never the
/// prompt: this row must be safe to show on the Privacy page and safe to keep after the
/// conversation has been deleted.
#[derive(Debug, Clone, Copy)]
pub struct OutboundRecord<'a> {
    pub id: &'a str,
    pub provider_id: &'a str,
    pub mode: AiMode,
    pub conversation_id: Option<&'a str>,
    pub char_count: i64,
    /// JSON array of `{kind, label}`. Never context text, never prompt text.
    pub included_context: &'a str,
    pub created_at: i64,
}

pub fn record_outbound(conn: &Connection, record: OutboundRecord<'_>) -> AppResult<()> {
    conn.execute(
        "INSERT INTO ai_outbound_log
             (id, provider_id, mode, conversation_id, char_count, included_context, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            record.id,
            record.provider_id,
            record.mode.as_str(),
            record.conversation_id,
            record.char_count,
            record.included_context,
            record.created_at
        ],
    )?;
    Ok(())
}

pub fn list_outbound(conn: &Connection, limit: i64) -> AppResult<Vec<AiOutboundEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, provider_id, mode, conversation_id, char_count, included_context, created_at
         FROM ai_outbound_log ORDER BY created_at DESC, rowid DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([limit], |row| {
        Ok(AiOutboundEntry {
            id: row.get(0)?,
            provider_id: row.get(1)?,
            mode: row.get(2)?,
            conversation_id: row.get(3)?,
            char_count: row.get(4)?,
            included_context: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn count_outbound(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM ai_outbound_log", [], |row| row.get(0))?)
}

pub fn clear_outbound(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM ai_outbound_log", [])?;
    Ok(())
}

pub fn validate_prompt(prompt: &str) -> AppResult<()> {
    if prompt.trim().is_empty() {
        return Err(AppError::Validation {
            field: "prompt".into(),
            detail: "there is nothing to send".into(),
        });
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(AppError::Validation {
            field: "prompt".into(),
            detail: format!("prompts are limited to {MAX_PROMPT_CHARS} characters"),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        migrations::run(&mut conn, None).unwrap();
        conn
    }

    fn sample_record<'a>(
        conversation_id: Option<&'a str>,
        char_count: i64,
        included_context: &'a str,
    ) -> OutboundRecord<'a> {
        OutboundRecord {
            id: "o1",
            provider_id: "local-openai",
            mode: AiMode::Local,
            conversation_id,
            char_count,
            included_context,
            created_at: 100,
        }
    }

    fn conversation(conn: &Connection) -> AiConversation {
        create_conversation(
            conn,
            NewConversation {
                id: "c1",
                title: "Title",
                provider_id: "local-openai",
                mode: AiMode::Local,
                model_name: "llama",
                system_prompt_version: "v1",
                created_at: 100,
            },
        )
        .unwrap()
    }

    #[test]
    fn stores_and_reads_back_an_endpoint() {
        let conn = db();
        set_endpoint_config(
            &conn,
            "local-openai",
            "http://127.0.0.1:11434/v1",
            "llama3",
            10,
        )
        .unwrap();

        let config = get_endpoint_config(&conn, "local-openai").unwrap();
        assert_eq!(
            config.base_url.as_deref(),
            Some("http://127.0.0.1:11434/v1")
        );
        assert_eq!(config.model.as_deref(), Some("llama3"));
        assert!(config.enabled);
    }

    #[test]
    fn an_unconfigured_provider_reads_as_empty_rather_than_erroring() {
        let conn = db();
        let config = get_endpoint_config(&conn, "never-configured").unwrap();
        assert!(config.base_url.is_none());
        assert!(config.model.is_none());
        assert!(!config.enabled);
    }

    #[test]
    fn clearing_the_endpoint_leaves_conversations_alone() {
        let conn = db();
        set_endpoint_config(&conn, "local-openai", "http://127.0.0.1:11434", "m", 10).unwrap();
        conversation(&conn);

        clear_endpoint_config(&conn, "local-openai", 20).unwrap();

        assert!(get_endpoint_config(&conn, "local-openai")
            .unwrap()
            .base_url
            .is_none());
        assert_eq!(list_conversations(&conn).unwrap().len(), 1);
    }

    #[test]
    fn messages_come_back_in_order() {
        let conn = db();
        conversation(&conn);
        append_message(&conn, "m1", "c1", ChatRole::User, "first", 100).unwrap();
        append_message(&conn, "m2", "c1", ChatRole::Assistant, "second", 101).unwrap();

        let messages = list_messages(&conn, "c1").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].content, "first");
        assert_eq!(messages[1].role, ChatRole::Assistant);
    }

    #[test]
    fn deleting_a_conversation_takes_its_messages_with_it() {
        let conn = db();
        conversation(&conn);
        append_message(&conn, "m1", "c1", ChatRole::User, "hello", 100).unwrap();

        delete_conversation(&conn, "c1").unwrap();

        assert!(list_messages(&conn, "c1").unwrap().is_empty());
        assert!(get_conversation(&conn, "c1").unwrap().is_none());
    }

    /// The transparency record outlives the transcript. Deleting a conversation is the user
    /// tidying their own history; it must not also erase the evidence that data left.
    #[test]
    fn deleting_a_conversation_does_not_erase_the_outbound_log() {
        let conn = db();
        conversation(&conn);
        record_outbound(&conn, sample_record(Some("c1"), 42, "[]")).unwrap();

        delete_conversation(&conn, "c1").unwrap();

        assert_eq!(count_outbound(&conn).unwrap(), 1);
    }

    #[test]
    fn the_outbound_log_never_holds_prompt_text() {
        let conn = db();
        conversation(&conn);
        record_outbound(
            &conn,
            sample_record(
                Some("c1"),
                1234,
                r#"[{"kind":"glossary-term","label":"Stock"}]"#,
            ),
        )
        .unwrap();

        let entries = list_outbound(&conn, 10).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].char_count, 1234);
        assert!(entries[0].included_context.contains("glossary-term"));

        // The schema has no column that could hold it. Asserting the exact column set rather
        // than scanning for banned words means a future column has to be a deliberate choice
        // made here, instead of arriving unnoticed.
        let mut stmt = conn.prepare("PRAGMA table_info(ai_outbound_log)").unwrap();
        let names: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(Result::unwrap)
            .collect();

        assert_eq!(
            names,
            vec![
                "id",
                "provider_id",
                "mode",
                "conversation_id",
                "char_count",
                "included_context",
                "created_at",
            ],
            "the outbound log gained a column — does it hold prompt text?"
        );
    }

    #[test]
    fn clearing_the_log_empties_it() {
        let conn = db();
        record_outbound(&conn, sample_record(None, 1, "[]")).unwrap();
        clear_outbound(&conn).unwrap();
        assert_eq!(count_outbound(&conn).unwrap(), 0);
    }

    #[test]
    fn titles_come_from_the_first_line_and_are_ellipsised() {
        assert_eq!(title_from_prompt("What is an ETF?"), "What is an ETF?");
        assert_eq!(
            title_from_prompt("\n\nSecond line is the first real one\nthird"),
            "Second line is the first real one"
        );
        assert_eq!(title_from_prompt("   "), "Untitled");

        let long = title_from_prompt(&"a".repeat(200));
        assert!(long.ends_with('…'));
        assert_eq!(long.chars().count(), MAX_TITLE_CHARS);
    }

    #[test]
    fn empty_and_oversized_prompts_are_refused() {
        assert!(validate_prompt("").is_err());
        assert!(validate_prompt("   \n ").is_err());
        assert!(validate_prompt(&"x".repeat(MAX_PROMPT_CHARS + 1)).is_err());
        assert!(validate_prompt("what is a stock?").is_ok());
    }
}
