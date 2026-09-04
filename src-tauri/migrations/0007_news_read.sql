-- Which headlines have been read.
--
-- Keyed by URL, not by the article id the provider hands out. That id is `{feed_id}:{guid}`, so
-- removing a feed and adding it back gives every one of its stories a new identity and marks the
-- whole backlog unread again. It also means two feeds carrying the same wire story are two
-- different rows. The URL is what actually identifies an article, and it is already what the RSS
-- adapter dedupes on.
--
-- No foreign key to anything. A read mark has to outlive the feed it came from — that is the
-- entire point of keying it this way — and the article itself is never stored, only fetched.
CREATE TABLE news_read (
  url     TEXT PRIMARY KEY,
  read_at INTEGER NOT NULL
);

-- Pruning is by recency, so the index has to support ordering by it.
CREATE INDEX idx_news_read_at ON news_read (read_at DESC);
