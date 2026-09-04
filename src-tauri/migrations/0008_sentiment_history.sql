-- A local record of the Fear & Greed readings this app has seen.
--
-- Both indices are range-limited by what produces them. Alternative.me returns a bounded window
-- of its published history, and the computed equity index only reaches as far back as the FRED
-- series it is derived from and the 90 days of composite the service builds. Neither grows on
-- its own, so a chart of "the last year of market mood" is not something either can answer today
-- and never will be.
--
-- Storing each reading as it is fetched means the app accumulates that range itself. After six
-- months it holds six months, from nobody's API and at nobody's discretion.
--
-- Only the composite value is kept, deliberately. The components of the computed index are
-- arithmetic over source series that FRED revises; storing them would freeze one vintage of a
-- calculation next to a live one and invite the two to disagree with no way to tell which was
-- which. The composite is what the trend line draws, and it is the only thing here that is
-- worth a row.
CREATE TABLE sentiment_history (
  -- 'crypto' or 'stocks'. Checked, so a third index cannot land here unnoticed and be drawn on
  -- the wrong chart.
  market TEXT NOT NULL CHECK (market IN ('crypto','stocks')),
  -- The day the reading is *for*, not when it was fetched. A daily index retrieved at noon is
  -- still the previous close, and the provider tells us which day it means.
  as_of  INTEGER NOT NULL,
  -- 0-100. Bounded here as well as in Rust, because a value outside it would render as a gauge
  -- pointing off its own dial.
  value  INTEGER NOT NULL CHECK (value BETWEEN 0 AND 100),
  PRIMARY KEY (market, as_of)
);

CREATE INDEX idx_sentiment_history_market_as_of ON sentiment_history (market, as_of DESC);
