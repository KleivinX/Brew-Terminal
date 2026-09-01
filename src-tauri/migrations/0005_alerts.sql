-- Price alerts.
--
-- This is the first feature in the app that makes a request the user did not directly cause, so
-- it is off until switched on and the setting that switches it on says exactly what changes.
-- ARCHITECTURE.md and the README both state "the app makes no request you did not cause"; that
-- sentence now carries an exception, and an exception that is not written down is a lie.
--
-- `triggered_at` is what stops an alert firing on every poll once its condition holds. An alert
-- fires once, records when, and then stays quiet until the user re-arms it. Hysteresis on the
-- price was considered and rejected: "re-fire when it crosses back" needs a second threshold the
-- user did not set, and guessing one would produce alerts nobody asked for.
CREATE TABLE alerts (
  id           TEXT PRIMARY KEY,
  asset_id     TEXT NOT NULL,
  -- Label snapshot, so an alert still reads correctly if the asset leaves the cache.
  symbol       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('price-above','price-below','change-above','change-below')),
  -- A price for the price kinds, a percentage for the change kinds.
  threshold    REAL NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  note         TEXT,
  created_at   INTEGER NOT NULL,
  -- Null until it fires. Set once, and cleared only by the user re-arming it.
  triggered_at INTEGER,
  -- The value that tripped it, kept so the notification can say what happened rather than only
  -- that something did.
  triggered_value REAL
);

CREATE INDEX idx_alerts_active ON alerts (enabled, triggered_at);
CREATE INDEX idx_alerts_asset ON alerts (asset_id);
