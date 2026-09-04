-- Saved views: a screener filter set or a compare selection, kept by name.
--
-- Both screens already build a precise, fiddly piece of state — six filter fields and a sort,
-- or up to six assets and a range — and both threw it away on reload. That made them things you
-- played with rather than things you returned to, which is the difference between a toy and a
-- tool.
--
-- `payload` is JSON rather than columns. The two kinds have nothing in common, a third kind is
-- likely, and modelling the union in SQL would mean a wide table of mostly-null columns and a
-- migration every time a filter is added. The frontend owns the shape, the same way it owns the
-- column choices in a CSV export, and validates it on read — a payload written by an older
-- version that no longer parses is dropped with a message rather than crashing the screen.
--
-- Deliberately no `is_default` and no auto-apply. A view is applied because the user picked it.
-- A screen that silently restored a filter set would leave someone looking at a filtered market
-- wondering where everything went, which is the same failure as a stale number with no age on it.
CREATE TABLE saved_views (
  id         TEXT PRIMARY KEY,
  -- Which screen this belongs to. Checked, so a view cannot be applied to a screen that has no
  -- idea what its payload means.
  kind       TEXT NOT NULL CHECK (kind IN ('screener','compare')),
  name       TEXT NOT NULL,
  -- JSON. Opaque to Rust; see the note above.
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Names are per-kind, not global: "Large caps" is a reasonable name for both a screen and a
-- comparison, and forcing one to be renamed because the other exists would be arbitrary.
-- Saving over an existing name replaces it, which is what the UI offers.
CREATE UNIQUE INDEX idx_saved_views_kind_name ON saved_views (kind, name);

-- The list is drawn newest-updated first, per kind.
CREATE INDEX idx_saved_views_kind_updated ON saved_views (kind, updated_at DESC);
