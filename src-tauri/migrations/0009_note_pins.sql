-- A note can name the day it is about.
--
-- Notes already attach to an asset, which answers "what is this about" but not "when". The
-- question a research note actually has to survive is "why did I buy here", asked a year later
-- while looking at the point on the chart. That needs the note to know its date.
--
-- Nullable, and null is the normal case. Most notes are about a holding rather than a moment,
-- and forcing a date onto them would mean inventing one — the same objection as filling in a
-- missing published_at on a news article.
--
-- Deliberately not the note's own created_at. A note written today can be about last March, and
-- pinning it to when it happened to be typed would put the marker in the wrong place on exactly
-- the note whose whole point is where it sits.
ALTER TABLE notes ADD COLUMN pinned_at INTEGER;

-- Chart markers are fetched per asset over a visible range, so both columns are in the lookup.
CREATE INDEX idx_notes_pinned ON notes (asset_id, pinned_at) WHERE pinned_at IS NOT NULL;
