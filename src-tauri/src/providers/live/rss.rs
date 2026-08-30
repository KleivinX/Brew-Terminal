//! RSS/Atom news adapter.
//!
//! This replaces the fixture news provider that shipped in v0.1.0. The feeds are the user's
//! own list, seeded with a small default set; see `db::repo_news_feeds`.
//!
//! Two things here are safety decisions rather than plumbing:
//!
//! * **Nothing a feed sends is rendered as markup.** Summaries arrive as HTML and are reduced
//!   to plain text in `to_plain_text` before they ever leave this module. The app has no HTML
//!   renderer and this keeps it that way — see THREAT_MODEL.md §3 on untrusted provider
//!   strings.
//! * **A feed cannot decide which asset a story is about.** Articles inherit the category of
//!   the feed they came from and nothing else. Inferring per-article relevance would be a
//!   judgement, and PRODUCT_SCOPE_V0_1.md §3 excludes those.
//!
//! One slow or broken feed must not take the panel down with it, so fetches run concurrently
//! and each failure is recorded against its own feed and otherwise ignored.

use async_trait::async_trait;
use tokio::task::JoinSet;

use crate::db::{repo_news_feeds, DbPool};
use crate::error::AppResult;
use crate::models::{
    now_epoch_secs, NewsArticle, NewsCategory, NewsFeed, NewsFilter, ProviderHealth,
};
use crate::providers::{http, NewsProvider};

pub const RSS_PROVIDER_ID: &str = "rss";
pub const RSS_PROVIDER_NAME: &str = "Your news feeds";

/// Summaries are trimmed to something a panel can show. Feeds routinely put an entire article
/// — or an entire tracking pixel farm — in `<description>`.
const MAX_SUMMARY_CHARS: usize = 320;

/// A ceiling on how many entries are taken from any single feed, so one prolific publisher
/// cannot crowd out every other source in the merged list.
const MAX_ENTRIES_PER_FEED: usize = 40;

/// The shipped default feeds.
///
/// Chosen on three grounds: each publishes a public feed intended for syndication, which is
/// what RSS is for; each was fetched and parsed successfully before being listed here; and none
/// of them appears in the "deliberately not used" list in `docs/PROVIDERS.md`. Yahoo Finance's
/// feed works and was tested, but Yahoo is on that list over its unofficial quote endpoints —
/// shipping it as a default would read as a contradiction even though a syndication feed is a
/// different thing entirely. A user can still add it.
///
/// The two government sources are US public domain. Everything here is removable, and a removal
/// is remembered — see `0003_news_feeds.sql`.
pub const DEFAULT_FEEDS: &[(&str, &str, NewsCategory)] = &[
    (
        "CoinDesk",
        "https://www.coindesk.com/arc/outboundfeeds/rss",
        NewsCategory::Crypto,
    ),
    (
        "Cointelegraph",
        "https://cointelegraph.com/rss",
        NewsCategory::Crypto,
    ),
    (
        "SEC press releases",
        "https://www.sec.gov/news/pressreleases.rss",
        NewsCategory::Stocks,
    ),
    (
        "Federal Reserve press releases",
        "https://www.federalreserve.gov/feeds/press_all.xml",
        NewsCategory::Macro,
    ),
];

pub struct RssNewsProvider {
    client: reqwest::Client,
    pool: DbPool,
}

impl RssNewsProvider {
    pub fn new(client: reqwest::Client, pool: DbPool) -> Self {
        Self { client, pool }
    }

    fn enabled_feeds(&self) -> Vec<NewsFeed> {
        self.pool
            .get()
            .ok()
            .and_then(|conn| repo_news_feeds::list_enabled(&conn).ok())
            .unwrap_or_default()
    }

    fn record(&self, feed_id: &str, error: Option<&str>, title: Option<&str>) {
        let Ok(conn) = self.pool.get() else { return };
        let _ = repo_news_feeds::record_result(&conn, feed_id, error);
        if let Some(title) = title {
            let _ = repo_news_feeds::fill_missing_title(&conn, feed_id, title);
        }
    }
}

/// Reduces provider HTML to plain text.
///
/// Deliberately not an HTML sanitiser: sanitising implies the output will be rendered as
/// markup, and it never is. Tags are dropped, the five XML entities plus numeric escapes are
/// decoded, and whitespace is collapsed. Decoding happens *after* tag removal so that an
/// encoded `&lt;script&gt;` cannot be turned back into a tag by this function.
pub fn to_plain_text(input: &str) -> String {
    let mut without_tags = String::with_capacity(input.len());
    let mut depth = 0usize;

    for ch in input.chars() {
        match ch {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => without_tags.push(ch),
            _ => {}
        }
    }

    let decoded = decode_entities(&without_tags);

    // Collapse every run of whitespace, including the newlines feeds pad markup with.
    let mut out = String::with_capacity(decoded.len());
    let mut in_space = false;
    for ch in decoded.chars() {
        if ch.is_whitespace() {
            if !in_space && !out.is_empty() {
                out.push(' ');
            }
            in_space = true;
        } else {
            out.push(ch);
            in_space = false;
        }
    }

    truncate_chars(out.trim(), MAX_SUMMARY_CHARS)
}

fn decode_entities(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;

    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];

        // An entity is short; anything longer is a stray ampersand, not an escape.
        let Some(end) = tail[..tail.len().min(12)].find(';') else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };

        let entity = &tail[1..end];
        let replacement = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            other => other
                .strip_prefix('#')
                .and_then(|digits| match digits.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok(),
                    None => digits.parse::<u32>().ok(),
                })
                .and_then(char::from_u32),
        };

        match replacement {
            Some(ch) => {
                out.push(ch);
                rest = &tail[end + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }

    out.push_str(rest);
    out
}

/// Truncates on a character boundary, adding an ellipsis only if something was cut.
fn truncate_chars(input: &str, max: usize) -> String {
    if input.chars().count() <= max {
        return input.to_string();
    }
    let mut out: String = input.chars().take(max).collect();
    while out.ends_with(char::is_whitespace) {
        out.pop();
    }
    out.push('…');
    out
}

/// Turns one parsed feed into articles, dropping anything that fails validation.
fn entries_to_articles(feed: &NewsFeed, parsed: feed_rs::model::Feed) -> Vec<NewsArticle> {
    let mut out = Vec::new();

    for entry in parsed.entries.into_iter().take(MAX_ENTRIES_PER_FEED) {
        // No link, nothing to open. A headline the user cannot follow is not worth showing.
        let Some(link) = entry.links.iter().find(|l| l.href.starts_with("https://")) else {
            continue;
        };

        let title = entry
            .title
            .as_ref()
            .map(|t| to_plain_text(&t.content))
            .unwrap_or_default();

        if title.trim().is_empty() {
            continue;
        }

        let summary = entry
            .summary
            .as_ref()
            .map(|t| t.content.as_str())
            .or(entry.content.as_ref().and_then(|c| c.body.as_deref()))
            .map(to_plain_text)
            .filter(|s| !s.trim().is_empty());

        // `published` is what the publisher meant; `updated` is the fallback. Neither is
        // invented when both are absent — the model allows `None` and the UI shows no date.
        let published_at = entry
            .published
            .or(entry.updated)
            .map(|dt| dt.timestamp())
            // A feed dated in the future is a publisher bug; clamping would hide it, so the
            // article keeps no date rather than a wrong one.
            .filter(|ts| *ts <= now_epoch_secs() + 3600);

        let article = NewsArticle {
            // The feed's own guid, namespaced by feed so two feeds carrying the same wire
            // story do not collide on id before the URL dedupe runs.
            id: format!("{}:{}", feed.id, entry.id),
            // Titles are capped at 500 by `validate`; cut here so a long one is shown
            // truncated rather than dropped entirely.
            title: truncate_chars(&title, 300),
            url: link.href.clone(),
            summary,
            source_name: feed.title.clone(),
            category: feed.category,
            published_at,
        };

        match article.validate() {
            Ok(()) => out.push(article),
            Err(reason) => {
                tracing::debug!(feed = %feed.id, reason, "dropping an invalid feed entry");
            }
        }
    }

    out
}

/// A short, safe reason for the settings panel. Never echoes a provider string.
fn describe(error: &crate::error::AppError) -> &'static str {
    use crate::error::AppError;
    match error {
        AppError::Network { .. } => "Could not be reached.",
        AppError::RateLimited { .. } => "The publisher is rate limiting requests.",
        AppError::ProviderError { .. } => "The publisher returned an error.",
        AppError::InvalidResponse { .. } => "The response was not a readable feed.",
        _ => "Could not be loaded.",
    }
}

#[async_trait]
impl NewsProvider for RssNewsProvider {
    fn id(&self) -> &str {
        RSS_PROVIDER_ID
    }

    fn display_name(&self) -> &str {
        RSS_PROVIDER_NAME
    }

    fn attribution(&self) -> &str {
        "Headlines belong to the publishers that produced them. Brew Terminal shows the title, \
         a short extract and a link, and opens the article in your browser."
    }

    async fn health(&self) -> ProviderHealth {
        if self.enabled_feeds().is_empty() {
            ProviderHealth::NotConfigured
        } else {
            ProviderHealth::Ok
        }
    }

    async fn news(&self, filter: &NewsFilter) -> AppResult<Vec<NewsArticle>> {
        let wanted = filter.category.to_lowercase();

        let feeds: Vec<NewsFeed> = self
            .enabled_feeds()
            .into_iter()
            .filter(|feed| {
                wanted == "all"
                    || serde_json::to_value(feed.category)
                        .ok()
                        .and_then(|v| v.as_str().map(str::to_string))
                        .is_some_and(|c| c == wanted)
            })
            .collect();

        if feeds.is_empty() {
            return Ok(Vec::new());
        }

        // Concurrent, so the panel waits for the slowest feed rather than the sum of them.
        let mut set: JoinSet<(NewsFeed, AppResult<Vec<u8>>)> = JoinSet::new();
        for feed in feeds {
            let client = self.client.clone();
            let url = feed.url.clone();
            set.spawn(async move {
                let bytes = http::get_bytes(&client, RSS_PROVIDER_ID, &url).await;
                (feed, bytes)
            });
        }

        let mut articles: Vec<NewsArticle> = Vec::new();

        while let Some(joined) = set.join_next().await {
            let Ok((feed, result)) = joined else {
                continue;
            };

            let bytes = match result {
                Ok(bytes) => bytes,
                Err(error) => {
                    self.record(&feed.id, Some(describe(&error)), None);
                    continue;
                }
            };

            match feed_rs::parser::parse(bytes.as_slice()) {
                Ok(parsed) => {
                    let feed_title = parsed.title.as_ref().map(|t| to_plain_text(&t.content));
                    self.record(&feed.id, None, feed_title.as_deref());
                    articles.extend(entries_to_articles(&feed, parsed));
                }
                Err(error) => {
                    tracing::warn!(feed = %feed.id, ?error, "could not parse a feed");
                    self.record(
                        &feed.id,
                        Some("The response was not a readable feed."),
                        None,
                    );
                }
            }
        }

        // Newest first; undated articles sort last rather than being hidden.
        articles.sort_by(|a, b| {
            b.published_at
                .unwrap_or(0)
                .cmp(&a.published_at.unwrap_or(0))
        });

        // Wire stories get syndicated, so the same URL arrives from several feeds. Dedupe
        // after sorting so the copy that is kept is the one with the best timestamp.
        let mut seen = std::collections::HashSet::new();
        articles.retain(|article| seen.insert(article.url.clone()));

        articles.truncate(filter.limit as usize);
        Ok(articles)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed() -> NewsFeed {
        NewsFeed {
            id: "feed-1".into(),
            title: "A Publisher".into(),
            url: "https://example.org/feed.xml".into(),
            category: NewsCategory::Crypto,
            enabled: true,
            is_default: false,
            added_at: 0,
            last_ok_at: None,
            last_error: None,
        }
    }

    fn parse(xml: &str) -> feed_rs::model::Feed {
        feed_rs::parser::parse(xml.as_bytes()).expect("fixture should parse")
    }

    #[test]
    fn strips_tags_and_decodes_entities() {
        assert_eq!(to_plain_text("<p>Hello <b>there</b></p>"), "Hello there");
        assert_eq!(to_plain_text("Tom &amp; Jerry"), "Tom & Jerry");
        assert_eq!(to_plain_text("caf&#233;"), "café");
        assert_eq!(to_plain_text("caf&#xe9;"), "café");
        assert_eq!(to_plain_text("a &nbsp; b"), "a b");
    }

    #[test]
    fn a_stray_ampersand_survives_intact() {
        assert_eq!(to_plain_text("Profit & loss"), "Profit & loss");
        assert_eq!(to_plain_text("AT&T earnings"), "AT&T earnings");
    }

    /// The ordering guarantee that matters: decoding runs after tags are stripped, so an
    /// encoded tag cannot be reconstituted into one by this function.
    #[test]
    fn an_encoded_tag_is_not_turned_back_into_markup() {
        let out = to_plain_text("&lt;script&gt;alert(1)&lt;/script&gt;");
        assert_eq!(out, "<script>alert(1)</script>");
        // It is text, and it is never rendered as markup — but prove the function did not
        // re-enter tag stripping and silently swallow it.
        assert!(out.contains("alert(1)"));
    }

    #[test]
    fn collapses_the_whitespace_feeds_pad_markup_with() {
        assert_eq!(to_plain_text("  a\n\n\t  b  "), "a b");
    }

    #[test]
    fn long_summaries_are_truncated_on_a_character_boundary() {
        let long = "é".repeat(1000);
        let out = to_plain_text(&long);
        assert!(out.chars().count() <= MAX_SUMMARY_CHARS + 1);
        assert!(out.ends_with('…'));
    }

    #[test]
    fn parses_rss_and_keeps_the_publisher_date() {
        let xml = r#"<?xml version="1.0"?>
        <rss version="2.0"><channel>
          <title>A Publisher</title>
          <item>
            <title>Rates held steady</title>
            <link>https://example.org/a</link>
            <description>&lt;p&gt;The committee &amp;amp; the minutes.&lt;/p&gt;</description>
            <pubDate>Mon, 25 Aug 2025 12:00:00 GMT</pubDate>
          </item>
        </channel></rss>"#;

        let articles = entries_to_articles(&feed(), parse(xml));

        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].title, "Rates held steady");
        assert_eq!(articles[0].url, "https://example.org/a");
        assert_eq!(
            articles[0].summary.as_deref(),
            Some("The committee & the minutes.")
        );
        assert_eq!(articles[0].published_at, Some(1_756_123_200));
        assert_eq!(articles[0].source_name, "A Publisher");
    }

    #[test]
    fn parses_atom_as_well_as_rss() {
        let xml = r#"<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>An Atom Publisher</title>
          <entry>
            <title>An Atom headline</title>
            <link href="https://example.org/atom-1"/>
            <updated>2025-08-25T12:00:00Z</updated>
            <summary>Plain enough.</summary>
          </entry>
        </feed>"#;

        let articles = entries_to_articles(&feed(), parse(xml));

        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].title, "An Atom headline");
        assert_eq!(articles[0].url, "https://example.org/atom-1");
    }

    /// The https-only rule, enforced on the article and not merely on the feed address.
    #[test]
    fn entries_linking_to_plain_http_are_dropped() {
        let xml = r#"<?xml version="1.0"?>
        <rss version="2.0"><channel><title>T</title>
          <item><title>Insecure</title><link>http://example.org/a</link></item>
          <item><title>Fine</title><link>https://example.org/b</link></item>
        </channel></rss>"#;

        let articles = entries_to_articles(&feed(), parse(xml));

        assert_eq!(articles.len(), 1);
        assert_eq!(articles[0].url, "https://example.org/b");
    }

    #[test]
    fn an_entry_without_a_title_is_dropped_rather_than_shown_blank() {
        let xml = r#"<?xml version="1.0"?>
        <rss version="2.0"><channel><title>T</title>
          <item><link>https://example.org/a</link></item>
        </channel></rss>"#;

        assert!(entries_to_articles(&feed(), parse(xml)).is_empty());
    }

    #[test]
    fn a_future_date_is_dropped_rather_than_shown_wrong() {
        let xml = r#"<?xml version="1.0"?>
        <rss version="2.0"><channel><title>T</title>
          <item>
            <title>From the future</title>
            <link>https://example.org/a</link>
            <pubDate>Mon, 25 Aug 2099 12:00:00 GMT</pubDate>
          </item>
        </channel></rss>"#;

        let articles = entries_to_articles(&feed(), parse(xml));
        assert_eq!(articles.len(), 1);
        assert_eq!(
            articles[0].published_at, None,
            "an implausible date is omitted, not clamped"
        );
    }

    /// Articles carry the category of the feed they came from. Nothing infers a category per
    /// story, because that would be a judgement the project does not make.
    #[test]
    fn articles_inherit_the_feed_category() {
        let xml = r#"<?xml version="1.0"?>
        <rss version="2.0"><channel><title>T</title>
          <item><title>H</title><link>https://example.org/a</link>
            <category>Politics</category></item>
        </channel></rss>"#;

        let mut macro_feed = feed();
        macro_feed.category = NewsCategory::Macro;

        let articles = entries_to_articles(&macro_feed, parse(xml));
        assert!(matches!(articles[0].category, NewsCategory::Macro));
    }

    #[test]
    fn one_feed_cannot_flood_the_merged_list() {
        let items: String = (0..200)
            .map(|i| {
                format!("<item><title>H{i}</title><link>https://example.org/{i}</link></item>")
            })
            .collect();
        let xml = format!(
            r#"<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>{items}</channel></rss>"#
        );

        let articles = entries_to_articles(&feed(), parse(&xml));
        assert_eq!(articles.len(), MAX_ENTRIES_PER_FEED);
    }

    #[test]
    fn every_shipped_default_feed_is_https_and_parseable_as_a_url() {
        assert!(!DEFAULT_FEEDS.is_empty());
        for (title, url, _) in DEFAULT_FEEDS {
            assert!(!title.trim().is_empty(), "{url} has no title");
            NewsFeed::validate_url(url)
                .unwrap_or_else(|reason| panic!("default feed {url} is invalid: {reason}"));
        }
    }
}
