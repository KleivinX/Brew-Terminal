-- Sentry's sources are a fifth kind of provider.
--
-- `provider_config.kind` carries a CHECK constraint listing the kinds that existed when the
-- table was written. SQLite cannot alter a CHECK in place, so widening it means rebuilding the
-- table: create the new shape, copy every row, drop the old one, rename. That is the standard
-- procedure from the SQLite documentation's "Making Other Kinds Of Table Schema Changes", and
-- it is why this migration is longer than the one-line ALTER it would be elsewhere.
--
-- Everything else about the table is reproduced exactly. A rebuild that quietly drops a column
-- default or a NOT NULL is the classic way this goes wrong, so the new definition below is the
-- old one with a single token added to the CHECK list.
--
-- Foreign keys are left alone deliberately: nothing references provider_config, so there are no
-- child rows to repoint, and the migration runner already wraps this in a transaction.

CREATE TABLE provider_config_new (
  provider_id    TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('market','news','community','ai','sentry')),
  enabled        INTEGER NOT NULL DEFAULT 0,
  has_credential INTEGER NOT NULL DEFAULT 0,
  base_url       TEXT,
  config_json    TEXT NOT NULL DEFAULT '{}',
  last_ok_at     INTEGER,
  last_error     TEXT,
  updated_at     INTEGER NOT NULL
);

INSERT INTO provider_config_new (
  provider_id, kind, enabled, has_credential, base_url, config_json, last_ok_at, last_error, updated_at
)
SELECT
  provider_id, kind, enabled, has_credential, base_url, config_json, last_ok_at, last_error, updated_at
FROM provider_config;

DROP TABLE provider_config;

ALTER TABLE provider_config_new RENAME TO provider_config;
