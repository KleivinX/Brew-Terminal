-- Holdings, stored as the transactions that produced them.
--
-- Positions are derived, never stored. A `holdings` table with a quantity column would be a
-- second source of truth that has to be kept in step with the history that explains it, and the
-- first time they disagree the user has no way to tell which is right. Cost basis, realised
-- gain and the position itself all fall out of replaying this table in order, so there is only
-- ever one thing to be correct.
--
-- Money is REAL. SQLite has no decimal type, and f64 carries about 15 significant digits, which
-- is far more than the precision of any price this app will ever be handed. It is not exact
-- decimal arithmetic and this is not an accounting ledger — see `services::portfolio` for what
-- that means in practice and where rounding is applied.
CREATE TABLE portfolio_transactions (
  id           TEXT PRIMARY KEY,
  -- Canonical id, as everywhere else: `crypto:cg:bitcoin`, `stock:us:AAPL`.
  asset_id     TEXT NOT NULL,
  -- A snapshot of how the asset was labelled when the entry was made, so a position still
  -- renders when the asset is not in the cache — offline, or a provider that has since dropped
  -- it. Display only; `asset_id` remains the identity.
  symbol       TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('buy','sell')),
  quantity     REAL NOT NULL CHECK (quantity > 0),
  -- Per unit, excluding fee.
  unit_price   REAL NOT NULL CHECK (unit_price >= 0),
  fee          REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
  currency     TEXT NOT NULL,
  -- When the trade happened, which is not when it was typed in.
  executed_at  INTEGER NOT NULL,
  note         TEXT,
  created_at   INTEGER NOT NULL
);

-- Replay is always per asset in execution order, which is exactly this index.
CREATE INDEX idx_portfolio_tx_asset ON portfolio_transactions (asset_id, executed_at);
CREATE INDEX idx_portfolio_tx_executed ON portfolio_transactions (executed_at);
