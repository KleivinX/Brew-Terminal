//! Log redaction.
//!
//! Nothing secret is stored in this build yet, but the redaction layer ships from day one:
//! retrofitting it after a key has already been logged is too late. See THREAT_MODEL.md §4.

/// Query parameters whose values must never be written to a log.
const SECRET_PARAMS: &[&str] = &[
    "api_key", "apikey", "api-key", "token", "secret", "auth", "key",
];

/// Strips secret-looking query parameters from a URL and drops any fragment.
///
/// Used before a URL reaches `tracing`. Errors crossing IPC carry no URL at all — this is for
/// the developer-facing log only.
pub fn redact_url(url: &str) -> String {
    let (base, query) = match url.split_once('?') {
        Some((base, rest)) => (base, rest),
        None => return url.split('#').next().unwrap_or(url).to_string(),
    };

    let query = query.split('#').next().unwrap_or(query);

    let redacted: Vec<String> = query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (name, _) = pair.split_once('=').unwrap_or((pair, ""));
            if SECRET_PARAMS.iter().any(|p| name.eq_ignore_ascii_case(p)) {
                format!("{name}=REDACTED")
            } else {
                pair.to_string()
            }
        })
        .collect();

    if redacted.is_empty() {
        base.to_string()
    } else {
        format!("{base}?{}", redacted.join("&"))
    }
}

/// Masks a credential for display: `sk-1234…cdef`. The full value is never recoverable from
/// this, and it is the only form that ever crosses IPC.
pub fn mask_secret(secret: &str) -> String {
    let chars: Vec<char> = secret.chars().collect();
    if chars.len() <= 8 {
        return "…".repeat(4);
    }
    let head: String = chars.iter().take(4).collect();
    let tail: String = chars.iter().skip(chars.len() - 4).collect();
    format!("{head}…{tail}")
}

/// Last-resort scrub for a free-form string that may embed a known secret value.
pub fn scrub(text: &str, known_secrets: &[String]) -> String {
    let mut out = text.to_string();
    for secret in known_secrets {
        if secret.len() >= 8 {
            out = out.replace(secret.as_str(), "REDACTED");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_known_secret_parameters() {
        let url = "https://api.example.com/quote?symbol=AAPL&api_key=super-secret-value";
        let redacted = redact_url(url);

        assert!(redacted.contains("symbol=AAPL"));
        assert!(redacted.contains("api_key=REDACTED"));
        assert!(!redacted.contains("super-secret-value"));
    }

    #[test]
    fn redaction_is_case_insensitive() {
        let redacted = redact_url("https://api.example.com/q?ApiKey=abc123xyz");
        assert!(!redacted.contains("abc123xyz"));
    }

    #[test]
    fn drops_fragments() {
        assert_eq!(
            redact_url("https://example.com/page#token=leaked"),
            "https://example.com/page"
        );
    }

    #[test]
    fn leaves_urls_without_queries_alone() {
        assert_eq!(
            redact_url("https://example.com/path"),
            "https://example.com/path"
        );
    }

    #[test]
    fn mask_reveals_only_the_ends() {
        let masked = mask_secret("sk-abcdefghijklmnop");
        assert_eq!(masked, "sk-a…mnop");
        assert!(!masked.contains("efghijkl"));
    }

    #[test]
    fn short_secrets_are_fully_masked() {
        // A short value would be largely reconstructable from head+tail, so show nothing.
        assert_eq!(
            mask_secret("abc123"),
            "…………".chars().take(4).collect::<String>()
        );
        assert!(!mask_secret("abc123").contains('a'));
    }

    #[test]
    fn scrub_removes_known_values() {
        let text = "request failed with key supersecretvalue123";
        let scrubbed = scrub(text, &["supersecretvalue123".to_string()]);
        assert!(!scrubbed.contains("supersecretvalue123"));
        assert!(scrubbed.contains("REDACTED"));
    }

    #[test]
    fn scrub_ignores_values_too_short_to_be_keys() {
        // Replacing a 3-character "secret" would mangle unrelated log text.
        let scrubbed = scrub("the cat sat", &["cat".to_string()]);
        assert_eq!(scrubbed, "the cat sat");
    }
}
