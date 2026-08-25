-- Brew Terminal — initial schema.
-- Mirrors docs/DATA_MODEL.md. Forward-only; never edit a migration that has shipped.
--
-- Note what is deliberately absent: no holdings, no cost basis, no quantity, no P&L, no
-- alerts, no telemetry, no user table, and no secret column anywhere. Portfolio accounting is
-- an explicit v0.1 non-goal and the schema does not leave a door open for it.

CREATE TABLE assets (
  id            TEXT PRIMARY KEY,
  asset_type    TEXT NOT NULL CHECK (asset_type IN ('crypto','stock','etf','index')),
  symbol        TEXT NOT NULL,
  name          TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  exchange      TEXT,
  region        TEXT,
  logo_cached   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_assets_symbol ON assets (symbol);
CREATE INDEX idx_assets_type_region ON assets (asset_type, region);

CREATE TABLE asset_provider_refs (
  asset_id        TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  provider_id     TEXT NOT NULL,
  provider_symbol TEXT NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (asset_id, provider_id)
);

CREATE INDEX idx_apr_provider ON asset_provider_refs (provider_id, provider_symbol);

CREATE TABLE watchlists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE watchlist_items (
  watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  asset_id     TEXT NOT NULL REFERENCES assets(id)     ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  added_at     INTEGER NOT NULL,
  PRIMARY KEY (watchlist_id, asset_id)
);

CREATE INDEX idx_wl_items_order ON watchlist_items (watchlist_id, position);

CREATE TABLE preferences (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- `has_credential` is a boolean flag. The key itself lives in the OS keychain and never
-- touches this database. See THREAT_MODEL.md §4.
CREATE TABLE provider_config (
  provider_id    TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('market','news','community','ai')),
  enabled        INTEGER NOT NULL DEFAULT 0,
  has_credential INTEGER NOT NULL DEFAULT 0,
  base_url       TEXT,
  config_json    TEXT NOT NULL DEFAULT '{}',
  last_ok_at     INTEGER,
  last_error     TEXT,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE cache_entries (
  cache_key    TEXT PRIMARY KEY,
  provider_id  TEXT NOT NULL,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL,
  ttl_seconds  INTEGER NOT NULL,
  etag         TEXT,
  byte_size    INTEGER NOT NULL
);

CREATE INDEX idx_cache_kind_fetched ON cache_entries (kind, fetched_at);
CREATE INDEX idx_cache_provider ON cache_entries (provider_id);

CREATE TABLE rate_limit_state (
  provider_id          TEXT PRIMARY KEY,
  window_started_at    INTEGER NOT NULL,
  request_count        INTEGER NOT NULL DEFAULT 0,
  retry_after_until    INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  backoff_until        INTEGER,
  updated_at           INTEGER NOT NULL
);

CREATE TABLE news_articles (
  id           TEXT PRIMARY KEY,
  provider_id  TEXT NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL UNIQUE,
  summary      TEXT,
  source_name  TEXT NOT NULL,
  category     TEXT,
  published_at INTEGER,
  fetched_at   INTEGER NOT NULL
);

CREATE INDEX idx_news_published ON news_articles (published_at DESC);

-- link_kind is a safety mechanism: only 'provider_tagged' rows may be described as being
-- about an asset. 'time_adjacent' rows render under explicitly non-causal copy.
CREATE TABLE news_asset_links (
  article_id TEXT NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
  asset_id   TEXT NOT NULL REFERENCES assets(id)        ON DELETE CASCADE,
  link_kind  TEXT NOT NULL DEFAULT 'time_adjacent'
             CHECK (link_kind IN ('provider_tagged','symbol_match','time_adjacent')),
  PRIMARY KEY (article_id, asset_id)
);

CREATE TABLE community_posts (
  id            TEXT PRIMARY KEY,
  provider_id   TEXT NOT NULL,
  asset_id      TEXT REFERENCES assets(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  author        TEXT,
  community     TEXT,
  score         INTEGER,
  comment_count INTEGER,
  posted_at     INTEGER,
  fetched_at    INTEGER NOT NULL
);

CREATE INDEX idx_community_asset ON community_posts (asset_id, posted_at DESC);

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  asset_id   TEXT REFERENCES assets(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  body_md    TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_notes_asset ON notes (asset_id, updated_at DESC);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, body_md, content='notes', content_rowid='rowid'
);

CREATE TABLE learning_progress (
  item_id      TEXT PRIMARY KEY,
  path_id      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('not_started','in_progress','completed')),
  completed_at INTEGER,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX idx_progress_path ON learning_progress (path_id, status);

CREATE TABLE bookmarks (
  kind       TEXT NOT NULL CHECK (kind IN ('glossary','lesson','article','asset')),
  ref_id     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, ref_id)
);

CREATE TABLE ai_conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT 'Untitled',
  provider_id TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('local','cloud')),
  model_name  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE ai_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE INDEX idx_ai_messages_conv ON ai_messages (conversation_id, created_at);

-- Transparency log: that a send happened, to whom, and how much — never the prompt text.
CREATE TABLE ai_outbound_log (
  id               TEXT PRIMARY KEY,
  provider_id      TEXT NOT NULL,
  mode             TEXT NOT NULL,
  conversation_id  TEXT,
  char_count       INTEGER NOT NULL,
  included_context TEXT NOT NULL DEFAULT '[]',
  created_at       INTEGER NOT NULL
);
