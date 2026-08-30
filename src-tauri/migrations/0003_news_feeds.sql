-- User-configurable RSS/Atom feeds, replacing the fixture news provider.
--
-- Feeds live in the database rather than in a config constant because they are the user's
-- choice, not the app's: PRODUCT_SCOPE_V0_1.md §4 committed to "adapter + user-configurable
-- RSS/Atom feeds", and a list that cannot be edited is neither.
--
-- `is_default` marks the small set seeded on first run. It exists so removing a default is
-- remembered — without it, re-seeding on the next launch would silently resurrect a feed the
-- user deleted, which is the sort of quiet override this project does not do.
CREATE TABLE news_feeds (
  id          TEXT PRIMARY KEY,
  -- The title the user sees. Seeded from the feed's own <title> on first successful fetch if
  -- the user did not supply one, but never overwritten afterwards: their label wins.
  title       TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  -- Which tab in the news panel this feed answers for. A feed is assigned one category rather
  -- than having its items classified: guessing a category per article would be a judgement,
  -- and this project does not make those. See PRODUCT_SCOPE_V0_1.md §3.
  category    TEXT NOT NULL CHECK (category IN ('crypto','stocks','macro','other')),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  added_at    INTEGER NOT NULL,
  -- Last outcome, so the settings panel can show which feeds are actually working without
  -- refetching. `last_error` holds a short reason, never a URL or a response body.
  last_ok_at  INTEGER,
  last_error  TEXT
);

CREATE INDEX idx_news_feeds_enabled ON news_feeds (enabled, category);

-- Records that a seeded default was deliberately removed, so first-run seeding stays
-- idempotent across upgrades. Keyed by URL because that is what identifies a feed.
CREATE TABLE news_feed_removals (
  url        TEXT PRIMARY KEY,
  removed_at INTEGER NOT NULL
);
