//! Finding a site's feed from its address.
//!
//! Until now adding a feed meant already knowing its URL, which is a thing almost nobody knows
//! and increasingly few sites advertise. Paste `coindesk.com` and this finds what it publishes.
//!
//! It works the way the web says it should: a site that has a feed declares it in its own
//! `<head>` as `<link rel="alternate" type="application/rss+xml" href="...">`. That is the
//! published autodiscovery convention, so reading it is the site telling us where its feed is
//! rather than us guessing — which keeps this on the right side of ADR-008. There is no
//! third-party feed-search API in the loop and no credential to hold.
//!
//! Two things it deliberately does not do. It does not scrape article content — the only thing
//! read out of the page is link elements in the head. And it does not invent a feed for a site
//! that has none; sites without one come back empty, and empty is the honest answer.

use serde::Serialize;
use tokio::task::JoinSet;

use crate::error::{AppError, AppResult};
use crate::models::NewsFeed;
use crate::providers::http;
use crate::providers::live::rss;
use crate::state::AppState;

/// One feed found for a site, already checked.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct FeedCandidate {
    pub url: String,
    /// The feed's own title, or the `title` attribute of the link that pointed at it.
    pub title: Option<String>,
    #[cfg_attr(test, ts(type = "number"))]
    pub item_count: usize,
    /// The newest headline, as proof this is the feed the user expected.
    pub newest_title: Option<String>,
}

/// How much of a page to read while looking for link elements.
///
/// The head is at the top by definition. Reading a whole news homepage — often several
/// megabytes of inlined markup — to find a tag in the first few kilobytes would make this the
/// most expensive request the app makes.
const MAX_HTML_BYTES: usize = 512 * 1024;

/// How many candidates to verify. A site advertising more feeds than this is a directory, and
/// checking all of them would be a burst of requests on someone else's server.
const MAX_CANDIDATES: usize = 6;

/// Feed types worth following. `feed_rs` parses all three.
const FEED_TYPES: &[&str] = &[
    "application/rss+xml",
    "application/atom+xml",
    "application/feed+json",
    "application/json",
];

/// Turns what someone typed into a URL worth fetching.
///
/// A bare host is the normal input here — people type `coindesk.com`, not a scheme — so the
/// missing `https://` is added rather than rejected. Anything with a scheme still has to be
/// https, by the same rule as every other feed address.
pub fn normalise_input(raw: &str) -> AppResult<url::Url> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation {
            field: "url".into(),
            detail: "Enter a site address.".into(),
        });
    }

    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    NewsFeed::validate_url(&candidate).map_err(|detail| AppError::Validation {
        field: "url".into(),
        detail,
    })
}

/// One `<link>` element's attributes, as far as we care about them.
#[derive(Debug, Default, PartialEq)]
struct LinkTag {
    rel: String,
    type_attr: String,
    href: String,
    title: String,
}

/// Reads the value of an HTML attribute starting at `rest`, handling all three quoting styles.
///
/// Returns the value and how many bytes were consumed.
fn read_attr_value(rest: &str) -> (String, usize) {
    let mut chars = rest.char_indices();
    let Some((_, first)) = chars.next() else {
        return (String::new(), 0);
    };

    if first == '"' || first == '\'' {
        // Quoted: everything up to the matching quote. An unterminated quote takes the rest,
        // which is what a browser does too.
        match rest[1..].find(first) {
            Some(end) => (rest[1..1 + end].to_string(), 1 + end + 1),
            None => (rest[1..].to_string(), rest.len()),
        }
    } else {
        // Unquoted: up to whitespace or the end of the tag.
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(rest.len());
        (rest[..end].to_string(), end)
    }
}

/// Pulls the attributes we care about out of one `<link ...>` tag body.
fn parse_link_tag(body: &str) -> LinkTag {
    let mut tag = LinkTag::default();
    let bytes = body.as_bytes();
    let mut i = 0;

    while i < body.len() {
        // Skip to the start of a name.
        if !body.is_char_boundary(i) || bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }

        let name_start = i;
        while i < body.len() && !bytes[i].is_ascii_whitespace() && bytes[i] != b'=' {
            i += 1;
        }
        let name = body[name_start..i].to_ascii_lowercase();

        // Skip whitespace before '='.
        while i < body.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= body.len() || bytes[i] != b'=' {
            continue; // A valueless attribute; nothing we want is one.
        }
        i += 1;
        while i < body.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }

        let (value, consumed) = read_attr_value(&body[i..]);
        i += consumed.max(1);

        match name.as_str() {
            "rel" => tag.rel = value.to_ascii_lowercase(),
            "type" => tag.type_attr = value.to_ascii_lowercase(),
            "href" => tag.href = value,
            "title" => tag.title = value,
            _ => {}
        }
    }

    tag
}

/// Every feed URL a page declares, in the order the page declares them.
///
/// Resolved against `base`, because `href="/feed"` is the common form and a relative URL is
/// useless on its own. Duplicates are dropped: sites routinely declare the same feed twice with
/// different `type` values.
pub fn find_declared_feeds(html: &str, base: &url::Url) -> Vec<(url::Url, Option<String>)> {
    // The declaration lives in the head. Stopping there avoids walking a homepage's worth of
    // markup and avoids picking up a `<link>` some article body happened to contain.
    let scope = match html.to_ascii_lowercase().find("</head") {
        Some(end) => &html[..end],
        None => html,
    };

    let lower = scope.to_ascii_lowercase();
    let mut out: Vec<(url::Url, Option<String>)> = Vec::new();
    let mut cursor = 0;

    while let Some(found) = lower[cursor..].find("<link") {
        let start = cursor + found + "<link".len();
        let end = lower[start..]
            .find('>')
            .map(|i| start + i)
            .unwrap_or(lower.len());
        // Clamped to the length. A document ending in a bare `<link` puts `start + 1` past the
        // end and the next iteration would slice out of bounds — markup that never closes a tag
        // is exactly the input this loop has to survive.
        cursor = end.max(start + 1).min(lower.len());

        let tag = parse_link_tag(&scope[start..end]);

        // `rel` is a space-separated set, so this is a membership test rather than equality.
        let is_alternate = tag.rel.split_whitespace().any(|value| value == "alternate");
        let is_feed = FEED_TYPES.contains(&tag.type_attr.as_str());
        if !is_alternate || !is_feed || tag.href.is_empty() {
            continue;
        }

        let Ok(resolved) = base.join(&tag.href) else {
            continue;
        };
        // Same rule as every other feed address: https only. A site declaring an http feed is
        // declaring one this app will not fetch.
        if resolved.scheme() != "https" {
            continue;
        }
        if out.iter().any(|(existing, _)| existing == &resolved) {
            continue;
        }

        let title = Some(tag.title).filter(|t| !t.trim().is_empty());
        out.push((resolved, title));
    }

    out
}

/// Finds the feeds a site publishes.
///
/// The address itself is tried as a feed first: someone pasting a URL that already is one
/// should not be told to go and find it. Otherwise the page is fetched and its declarations
/// are read.
pub async fn discover(state: &AppState, input: String) -> AppResult<Vec<FeedCandidate>> {
    let url = normalise_input(&input)?;
    let client = state.registry.http_client();

    // Is it already a feed?
    if let Ok(candidate) = check_one(&client, url.clone(), None).await {
        return Ok(vec![candidate]);
    }

    let bytes = http::get_bytes(&client, rss::RSS_PROVIDER_ID, url.as_str()).await?;
    let truncated = &bytes[..bytes.len().min(MAX_HTML_BYTES)];

    // Lossy on purpose. A page in a legacy encoding still declares its feed in ASCII, and
    // refusing to look because a byte elsewhere was not UTF-8 would fail for no benefit.
    let html = String::from_utf8_lossy(truncated);
    let declared = find_declared_feeds(&html, &url);

    if declared.is_empty() {
        return Ok(Vec::new());
    }

    // Verified concurrently, so one slow feed does not decide how long the whole thing takes.
    // Same shape as the news fetch, and for the same reason.
    let mut set = JoinSet::new();
    for (feed_url, link_title) in declared.into_iter().take(MAX_CANDIDATES) {
        // The client, not the state: `AppState` is not `Clone` and a spawned task must own
        // what it holds.
        let client = client.clone();
        set.spawn(async move { check_one(&client, feed_url, link_title).await });
    }

    let mut found = Vec::new();
    while let Some(joined) = set.join_next().await {
        if let Ok(Ok(candidate)) = joined {
            found.push(candidate);
        }
    }

    // Most items first: of several feeds a site offers, the fullest is almost always the one
    // someone typing the bare domain meant.
    found.sort_by_key(|candidate| std::cmp::Reverse(candidate.item_count));
    Ok(found)
}

/// Fetches one candidate and confirms it parses.
async fn check_one(
    client: &reqwest::Client,
    url: url::Url,
    link_title: Option<String>,
) -> AppResult<FeedCandidate> {
    let preview = super::news_feeds::preview_with(client, url.to_string()).await?;

    Ok(FeedCandidate {
        url: url.to_string(),
        // The feed's own title wins; the link's `title` attribute is the fallback, and it is
        // often the more useful of the two ("Markets RSS" rather than the site's name again).
        title: preview.title.or(link_title),
        item_count: preview.item_count,
        newest_title: preview.newest_title,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> url::Url {
        url::Url::parse("https://example.org/news/").unwrap()
    }

    fn urls(html: &str) -> Vec<String> {
        find_declared_feeds(html, &base())
            .into_iter()
            .map(|(u, _)| u.to_string())
            .collect()
    }

    #[test]
    fn finds_the_declaration_a_site_publishes() {
        let html = r#"<html><head>
            <link rel="alternate" type="application/rss+xml" href="https://example.org/feed.xml">
        </head><body>x</body></html>"#;
        assert_eq!(urls(html), vec!["https://example.org/feed.xml"]);
    }

    /// `href="/feed"` is the common form. A relative URL is useless on its own.
    #[test]
    fn resolves_a_relative_href_against_the_page() {
        let html = r#"<head><link rel="alternate" type="application/rss+xml" href="/feed"></head>"#;
        assert_eq!(urls(html), vec!["https://example.org/feed"]);

        let relative =
            r#"<head><link rel="alternate" type="application/rss+xml" href="rss.xml"></head>"#;
        assert_eq!(urls(relative), vec!["https://example.org/news/rss.xml"]);
    }

    #[test]
    fn reads_attributes_in_any_order_and_any_quoting() {
        for html in [
            r#"<head><link href="/a" type="application/rss+xml" rel="alternate"></head>"#,
            r#"<head><link rel='alternate' type='application/rss+xml' href='/a'></head>"#,
            r#"<head><link rel=alternate type=application/rss+xml href=/a></head>"#,
            r#"<head><link  rel = "alternate"  type = "application/rss+xml"  href = "/a" /></head>"#,
        ] {
            assert_eq!(
                urls(html),
                vec!["https://example.org/a"],
                "failed on {html}"
            );
        }
    }

    #[test]
    fn is_not_confused_by_case() {
        let html = r#"<HEAD><LINK REL="ALTERNATE" TYPE="APPLICATION/RSS+XML" HREF="/a"></HEAD>"#;
        assert_eq!(urls(html), vec!["https://example.org/a"]);
    }

    /// `rel` is a space-separated set, so this has to be a membership test. Real sites write
    /// `rel="alternate home"`.
    #[test]
    fn accepts_alternate_among_several_rel_values() {
        let html =
            r#"<head><link rel="home alternate" type="application/atom+xml" href="/a"></head>"#;
        assert_eq!(urls(html), vec!["https://example.org/a"]);
    }

    #[test]
    fn ignores_links_that_are_not_feeds() {
        let html = r#"<head>
            <link rel="stylesheet" href="/style.css">
            <link rel="icon" type="image/png" href="/favicon.png">
            <link rel="canonical" href="https://example.org/news/">
            <link rel="alternate" hreflang="fr" href="https://example.org/fr/">
        </head>"#;
        assert!(urls(html).is_empty());
    }

    /// The declaration belongs in the head. Scanning the body would pick up whatever an
    /// article happened to quote, and would mean walking megabytes of homepage markup.
    #[test]
    fn stops_at_the_end_of_the_head() {
        let html = r#"<head><link rel="alternate" type="application/rss+xml" href="/real"></head>
            <body><link rel="alternate" type="application/rss+xml" href="/inside-an-article"></body>"#;
        assert_eq!(urls(html), vec!["https://example.org/real"]);
    }

    /// Sites routinely declare the same feed twice under different type values.
    #[test]
    fn does_not_offer_the_same_feed_twice() {
        let html = r#"<head>
            <link rel="alternate" type="application/rss+xml" href="/feed">
            <link rel="alternate" type="application/atom+xml" href="/feed">
        </head>"#;
        assert_eq!(urls(html), vec!["https://example.org/feed"]);
    }

    /// A site declaring an http feed is declaring one this app will not fetch, so it is not
    /// offered — the same rule the manual add path enforces.
    #[test]
    fn refuses_a_feed_declared_over_plain_http() {
        let html = r#"<head><link rel="alternate" type="application/rss+xml" href="http://example.org/feed"></head>"#;
        assert!(urls(html).is_empty());
    }

    #[test]
    fn keeps_the_order_the_page_declared_them_in() {
        let html = r#"<head>
            <link rel="alternate" type="application/rss+xml" href="/first">
            <link rel="alternate" type="application/rss+xml" href="/second">
        </head>"#;
        assert_eq!(
            urls(html),
            vec!["https://example.org/first", "https://example.org/second"]
        );
    }

    #[test]
    fn carries_the_links_own_title_when_it_has_one() {
        let html = r#"<head><link rel="alternate" type="application/rss+xml" title="Markets" href="/m"></head>"#;
        let found = find_declared_feeds(html, &base());
        assert_eq!(found[0].1.as_deref(), Some("Markets"));
    }

    #[test]
    fn survives_markup_that_never_closes_a_tag() {
        // Malformed input must not panic or hang; finding nothing is an acceptable answer.
        for html in [
            "<head><link rel=\"alternate\"",
            "<link",
            "<head><link href=\"",
            "",
        ] {
            let _ = urls(html);
        }
    }

    #[test]
    fn a_page_with_no_feed_yields_nothing_rather_than_a_guess() {
        assert!(urls("<html><head><title>No feed here</title></head></html>").is_empty());
    }

    #[test]
    fn multi_byte_content_does_not_split_a_character() {
        // The whole page is scanned as text, and byte indexing over “ or é is how the RSS
        // entity decoder used to panic.
        let html = r#"<head><title>Märkte — “news”</title>
            <link rel="alternate" type="application/rss+xml" href="/feed"></head>"#;
        assert_eq!(urls(html), vec!["https://example.org/feed"]);
    }

    #[test]
    fn a_bare_host_gains_the_scheme_people_did_not_type() {
        assert_eq!(
            normalise_input("coindesk.com").unwrap().as_str(),
            "https://coindesk.com/"
        );
        assert_eq!(
            normalise_input("  example.org/news  ").unwrap().as_str(),
            "https://example.org/news"
        );
    }

    #[test]
    fn an_explicit_scheme_is_still_held_to_the_https_rule() {
        assert!(normalise_input("https://example.org").is_ok());
        assert!(normalise_input("http://example.org").is_err());
        assert!(normalise_input("javascript:alert(1)").is_err());
        assert!(normalise_input("file:///etc/passwd").is_err());
        assert!(normalise_input("   ").is_err());
    }
}
