# Mock fixtures

Deterministic development and test data. **None of this is real market data.**

Every value here is synthetic — prices, percentages, volumes, headlines and URLs are invented
for development. Real company and asset names appear so the UI can be exercised at realistic
string lengths; the numbers attached to them are meaningless and the article URLs point at
`example.org`.

`community.json` deserves its own note: the posts, authors and engagement counts are all
invented, and the URLs point at `example.invalid` — a domain reserved by RFC 2606 precisely so
it can never resolve. Nobody wrote these posts, and no real discussion is being quoted.

The app never presents this data as real. Fixtures are served by the mock provider, whose
display name is "Mock provider (fixtures)", and every panel showing them renders a
`source: 'mock'` badge. The status bar shows mock mode for the whole session.

## Files

| File                 | Shape                           | Used by                              |
| -------------------- | ------------------------------- | ------------------------------------ |
| `crypto_quotes.json` | `Quote[]`                       | Pulse crypto table                   |
| `stock_quotes.json`  | `Quote[]`                       | Pulse stocks table (equities + ETFs) |
| `search_index.json`  | `Asset[]`                       | Universal search, command palette    |
| `chart_series.json`  | `Record<assetId, ChartPoint[]>` | Research Lab charts (Phase 3)        |
| `news.json`          | `NewsArticle[]`                 | News feed                            |
| `community.json`     | `CommunityPost[]`               | Community temperature                |

## Determinism

Generated with a fixed RNG seed and a frozen base timestamp (`2025-08-22T00:00:00Z`) so that
the same data appears on every machine and every run. Tests assert against these values, so
regenerating fixtures is a deliberate act that will fail tests until they are updated.

Both the Rust mock provider (`include_str!`) and the browser harness (`import`) read these same
files, so there is exactly one copy of the data.
