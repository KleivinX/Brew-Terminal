# Provider terms review

ADR-008 requires that no provider is wired live until its terms and limits have been read and
recorded here. This is that record.

Everything below was verified on **2026-08-22** against the sources cited. Where something
could not be verified from a source, it says so rather than guessing.

> This is an engineering record, not legal advice. Terms change; re-check before a release.

---

## CoinGecko — crypto market data

|                 |                                                       |
| --------------- | ----------------------------------------------------- |
| **Status**      | Live, enabled by default (keyless)                    |
| **Adapter**     | `src-tauri/src/providers/live/coingecko.rs`           |
| **Base URL**    | `https://api.coingecko.com/api/v3`                    |
| **Credential**  | Optional. Demo key sent as `x-cg-demo-api-key` header |
| **Attribution** | Required — rendered by the provider badge             |

### Limits

| Plan                      | Limit                                      | Source                                                                                                                                  |
| ------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Demo (free, key required) | **100 calls/min**, **10,000 calls/month**  | [CoinGecko support](https://support.coingecko.com/hc/en-us/articles/4538771776153-What-is-the-rate-limit-for-CoinGecko-API-public-plan) |
| Keyless public            | Lower and explicitly not guaranteed stable | same                                                                                                                                    |

The adapter is configured at **50 calls/min without a key** and **100 with one**. The keyless
figure is deliberately below anything documented: the public tier's limit is described as
unstable, so a conservative ceiling is the only honest setting. The monthly cap is the tighter
constraint in practice — 10,000 calls/month is roughly 13 per hour sustained — which is why
quotes are batched into a single `/coins/markets` call and the default refresh interval is 60s.

### Attribution

The published requirement is that products display **"Data provided by CoinGecko"** with a
hyperlink to <https://www.coingecko.com/en/api>. That obligation is stated for the commercial
plans (Basic, Analyst, Lite, Pro); the sources reviewed did not spell out a separate obligation
for the Demo/keyless tier. Brew Terminal attributes on every tier regardless — it costs nothing,
and the app's own rule is that no number renders without its provider.

Source: [CoinGecko attribution guide](https://brand.coingecko.com/resources/attribution-guide).

### Endpoint used

`GET /coins/markets?vs_currency=usd&order=market_cap_desc&per_page=N&page=1&sparkline=true&price_change_percentage=7d`

Response shape verified against a real call. Fields consumed: `id`, `symbol`, `name`,
`current_price`, `market_cap`, `total_volume`, `price_change_percentage_24h`,
`price_change_percentage_7d_in_currency`, `sparkline_in_7d.price`, `last_updated`.

Notes that shaped the adapter:

- `current_price` and friends arrive as **either integer or float** JSON. Deserialized as `f64`.
- `sparkline_in_7d.price` carries **168 points** (hourly over 7 days). Downsampled to 24 at the adapter boundary so the UI never receives a series it would have to thin itself.
- `market_cap` and `total_volume` can be `null` for some coins — typed `Option`.
- One call returns the whole market list _and_ the sparklines, so a dashboard refresh is a single request. This is the main reason CoinGecko is viable on a free tier where Finnhub is not.

### Chart endpoint

`GET /coins/{id}/market_chart?vs_currency=usd&days=N`

Returns `{prices: [[unix_millis, price], …], market_caps, total_volumes}`. Only `prices` is
consumed. Granularity is chosen by CoinGecko, not requested:

| `days` | Points returned | Spacing   |
| ------ | --------------- | --------- |
| 1      | 289             | 5 minutes |
| 7      | 169             | hourly    |
| 30     | 721             | hourly    |
| 365    | 366             | daily     |

Two findings that shaped the adapter, both verified against the live API:

1. **Timestamps are milliseconds.** Every other timestamp in this app is seconds; the adapter converts at the boundary.
2. **`days=max` is refused on the free tiers** with error code 10012: _"Public API users are limited to querying historical data within the past 365 days."_ So `ChartRange::Max` is **absent from `capabilities().charts`**, and the UI renders no Max button rather than one that always fails. A paid plan lifts the limit, at which point the adapter can add it.

Series are capped at 750 points. A 90-day hourly series is ~2,160 points, and on the reference
machine each one costs parsing, IPC serialization and a JS array entry for detail no display
can show at chart width.

### Error responses

CoinGecko returns a real HTTP **429** when the rate limit is exceeded — verified by hitting it
during development — so the shared HTTP layer maps it to `RateLimited` correctly. Some APIs
return 200 with an error body instead, which would have been parsed as a malformed response;
this one does not.

### Permitted use

Desktop-client use and local caching are consistent with the documented plans. No scraping and
no undocumented endpoints are used — see ADR-008.

---

## Finnhub — equities

|                 |                                                                 |
| --------------- | --------------------------------------------------------------- |
| **Status**      | Adapter implemented, **disabled until the user supplies a key** |
| **Adapter**     | `src-tauri/src/providers/live/finnhub.rs`                       |
| **Base URL**    | `https://finnhub.io/api/v1`                                     |
| **Credential**  | **Required.** Sent as `X-Finnhub-Token` header                  |
| **Attribution** | Rendered by the provider badge                                  |

### Limits

|            | Limit                                                    | Source                                                   |
| ---------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Free plan  | **60 API calls/minute**                                  | [Finnhub pricing](https://finnhub.io/pricing)            |
| All plans  | **30 API calls/second** ceiling on top of the plan limit | [Finnhub limits](https://finnhub.io/docs/api/rate-limit) |
| Over limit | HTTP **429**                                             | same                                                     |

The adapter is configured at 60/min with a concurrency cap of 4 in-flight requests, which keeps
it well under the 30/second ceiling.

### Credential handling

Finnhub accepts the key either as a `token` **query parameter** or as an `X-Finnhub-Token`
**header**. The adapter uses the header. A key in a query string ends up in request logs,
proxy logs and any error string that echoes a URL; the header keeps it out of all of them. The
log redaction layer still strips `token=` as a second line of defence.

### The batching problem, stated plainly

`GET /quote` takes **one symbol per call**. There is no batch quote endpoint on this API.

A 25-symbol watchlist therefore costs 25 calls, not one. At 60 calls/minute that allows roughly
two full refreshes per minute with nothing left over — so the adapter:

- fans out with a concurrency cap of 4 and counts **each symbol as one request** against the governor;
- refuses batches larger than the remaining per-minute allowance rather than issuing calls it knows will 429;
- returns whatever succeeded plus a degraded marker, rather than failing the whole table because the tail of the list ran out of budget.

This is a genuine constraint of the provider, not something the adapter layer can engineer
away, and it is the strongest argument for keeping the stock refresh interval longer than the
crypto one.

### Endpoints used

Shapes taken from Finnhub's own OpenAPI document (`https://finnhub.io/static/swagger.json`),
not from prose documentation:

| Endpoint          | Params     | Fields consumed                                                                                |
| ----------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `/quote`          | `symbol`   | `c` current, `d` change, `dp` percent change, `h` high, `l` low, `o` open, `pc` previous close |
| `/search`         | `q`        | `result[].symbol`, `.description`, `.displaySymbol`, `.type`                                   |
| `/stock/profile2` | `symbol`   | `name`, `ticker`, `exchange`, `currency`, `marketCapitalization`, `weburl`                     |
| `/news`           | `category` | `headline`, `summary`, `url`, `source`, `datetime`, `category`                                 |

`/quote` returns **no symbol, name, or currency** — only prices. The adapter fills those from
the locally stored canonical asset, which is why an asset must exist before it can be quoted.

### Not verified

- Whether the free plan carries a monthly cap in addition to the per-minute limit. Not stated on the pricing page. The adapter enforces only the documented per-minute and per-second limits.
- Whether attribution is contractually required. Not found in the reviewed sources. The app attributes anyway.

---

## Alpha Vantage — equity charts

Added in v0.2 to close a gap that made the Stocks tab worse than useless: Finnhub serves quotes
on its free tier but its candle endpoint is paid, so a stock had a price and no history at all.

### What it is used for, and what it is not

**Charts only.** `capabilities()` advertises no quotes, no search and no profiles even though the
API offers all three, and the registry never routes them here. The reason is the limit below: one
quote spent is one chart the user cannot open later.

### Limits

|            |                                                               |
| ---------- | ------------------------------------------------------------- |
| Free tier  | **25 API requests per day**                                   |
| Verified   | 2026-08-30, from alphavantage.co/premium                      |
| Credential | Required. The user's own free key, stored in the OS keychain. |

That is the tightest budget of any provider here by a wide margin, and it drives two decisions.
Only daily-derived ranges are offered — intraday is a separate endpoint and would double the cost
of the same screen. And `outputsize=compact` (100 trading days) is requested for everything but
MAX, because pulling twenty years to draw one month costs the same request and wastes the
response.

The existing cache layer does the rest of the work: a daily close changes once a day, so a cached
series stays valid far longer than the request budget takes to refill.

### The endpoint

`GET /query?function=TIME_SERIES_DAILY&symbol=…&outputsize=…&apikey=…`

The response is an **object keyed by date, not an array**, so ordering is the adapter's job — a
chart drawn from hash order is noise. Field names are prefixed (`"4. close"`).

**Exhausting the budget returns HTTP 200 with a prose `Note`, not a 429.** The adapter detects
that and reports it as rate-limited, because a user told "invalid response" would go looking for
the wrong problem.

### Rejected alternatives

- **Stooq.** No key, free CSV, and it was the obvious first choice. It now sits behind a JavaScript proof-of-work bot check, so using it would mean defeating bot detection. Not shipped, and not something this project will do.
- **Twelve Data.** A larger free allowance on paper, but its pricing page describes free access as trial symbols "for evaluation and testing purposes", which is not what shipping an app to users is. Not wired without clearer terms.
- **Yahoo Finance.** Its RSS and quote endpoints both work. Still excluded under ADR-008 — see "Deliberately not used" below.

### Not verified

- **The full terms of service have not been read line by line.** What was verified is the published free-tier limit and that the endpoint returns real data for real symbols on a free key.
- Whether the 25/day limit is per key, per IP, or both.

## News — RSS and Atom feeds

News comes from feeds the user configures. There is no news API, no key, and no fixture
fallback.

**Correcting the record.** Until v0.2 this section claimed Finnhub `/news` was used when a key
was present, with a fixture fallback otherwise. The code never did that: `registry.news()`
returned the fixture provider unconditionally, in release builds as well as debug. A shipped
v0.1.0 therefore showed invented headlines, and — because `source_for` only recognised the
market mock — labelled them `source: live`. The fixture news provider has been deleted, not
merely disabled.

### Terms position

An RSS or Atom feed is published for syndication; reading one with a feed reader is its intended
use. That is the whole basis for this adapter, and it is why no per-publisher agreement is
claimed here. The app stores nothing but what the feed itself carries, shows title, a short
extract and attribution, and opens the article in the user's browser rather than reproducing it.

The user can add any feed. Anything they add is their choice and outside this review.

### Shipped defaults

| Feed                           | Section | Basis                        |
| ------------------------------ | ------- | ---------------------------- |
| CoinDesk                       | Crypto  | Public syndication feed      |
| Cointelegraph                  | Crypto  | Public syndication feed      |
| SEC press releases             | Stocks  | US Government, public domain |
| Federal Reserve press releases | Macro   | US Government, public domain |

Each was fetched and parsed successfully on 2026-08-29 before being listed. Each is removable,
and a removal is remembered so seeding does not undo it.

**Yahoo Finance's feed was tested and works**, but is not shipped as a default: Yahoo appears
under "deliberately not used" below over its unofficial quote endpoints, and shipping its feed
would read as a contradiction even though a syndication feed is a different thing. A user who
wants it can add it.

### Limits

No published rate limit applies to a feed read at the intervals this app uses. Responses share
the shared HTTP client's caps — HTTPS only, 2 MB body limit, 15 s timeout, 3 redirects. At most
40 entries are taken from any one feed so a prolific publisher cannot crowd out the rest.

### Not verified

- **No individual publisher's terms of service have been read line by line.** The position above rests on what RSS is for, not on a per-outlet agreement.
- Feed availability is not monitored. A feed that stops working shows its error in Settings → News feeds rather than disappearing.

---

## Alternative.me — crypto Fear & Greed Index

|                 |                                                                 |
| --------------- | --------------------------------------------------------------- |
| **Status**      | Live, enabled by default (keyless)                              |
| **Adapter**     | `src-tauri/src/providers/live/alternative_me.rs`                |
| **Base URL**    | `https://api.alternative.me/fng/`                               |
| **Credential**  | None. No key, no account                                        |
| **Attribution** | **Required, next to the data** — rendered by the provider badge |

Verified against the live API and their published API section on **2026-09-01**.

### Terms

Their two stated rules, quoted from <https://alternative.me/crypto/fear-and-greed-index/>:

- You may not use their data to impersonate them, or to create a service that could be confused
  with their offering.
- Commercial use is allowed **as long as the attribution is given right next to the display of
  the data**. This applies to all of their fear and greed data, not only the API.

The second is stricter than a footer credit, and it is the reason the reading renders inside a
card carrying its own `ProviderBadge` rather than relying on a page-level attribution line. The
first is why the app never presents the number as its own: the card is labelled _Published
figure_, and where their classification differs from this app's band the card prints theirs too.

No rate limit is published. The index updates once a day, so the adapter's cache TTL is three
hours and a running app makes at most a handful of calls a day.

### Endpoint used

`GET /fng/?limit=90`

Response shape verified against a real call. Three findings that shaped the adapter:

1. **Every scalar is a JSON string**, numbers included — `"value": "69"`, `"timestamp": "1788220800"`. A struct typed with `i32` fails on every response.
2. **Errors arrive with HTTP 200** and a message in `metadata.error`. The status code alone is not a success signal, so the adapter checks that field first.
3. **`date_format` is not sent.** With it, timestamps become `MM-DD-YYYY` and `time_until_update` goes negative. The default is unix seconds, which is unambiguous.

Entries are newest-first; the adapter re-sorts. Anything outside the published 0–100 scale is
dropped rather than clamped, because clamping would invent a reading the publisher never issued.

### What it actually measures

Bitcoin. Their own documentation says so: the index is built from Bitcoin volatility (25%),
market momentum and volume (25%), social media (15%), BTC dominance (10%) and Google Trends
(10%), with a survey input (15%) listed as paused. The rest of the crypto market usually follows
Bitcoin but does not always, and the card says this rather than presenting the number as
whole-market sentiment.

---

## Stock Fear & Greed — computed here, not fetched

**Not a provider.** There is no equity sentiment index this app can report: the well-known one
publishes no documented API, only an endpoint its own site calls, and ADR-008 rules that out.
The choice was between shipping no equity index and computing one.

It is computed, from five FRED series (see below), in
`src-tauri/src/services/sentiment.rs`. Four components — market momentum, market volatility,
safe-haven demand and junk bond demand — each scored by percentile rank over the trailing 252
sessions, combined as an equal-weighted mean.

This sits close to a line drawn elsewhere in this codebase: `providers::live::fred` says the app
"reports published figures rather than running models over them", and a composite sentiment
score is a model. What makes it acceptable is that nothing is hidden. Every component ships with
its input series, its raw reading, the arithmetic and whether it was inverted; the UI renders all
of it, labels the card _Computed here_, and states in as many words that nobody publishes the
number. A figure the reader can recompute is a teaching instrument. The same figure with its
inputs withheld would be an oracle.

**Provider identity:** `brew-stock-sentiment`, named "Computed by Brew Terminal from FRED".
Deliberately not attributed to FRED — they publish the inputs, not the index, and naming them as
the source of a composite they have never heard of would be a provenance error.

**Not included:** put/call ratios, net new 52-week highs, and a breadth measure — all used by the
published equity index, none with a free, documented, daily source that clears ADR-008. The index
has four components and says so rather than approximating the missing three.

---

## FRED — macroeconomic series

|                 |                                                           |
| --------------- | --------------------------------------------------------- |
| **Status**      | Live, enabled by default (keyless)                        |
| **Adapter**     | `src-tauri/src/providers/live/fred.rs`                    |
| **Base URL**    | `https://fred.stlouisfed.org/graph/fredgraph.csv`         |
| **Credential**  | None. The JSON API wants a key; the CSV endpoint does not |
| **Attribution** | Rendered by the provider badge                            |

The data is US federal government output in the public domain. This is the only provider that
works on first run with nothing configured.

### The User-Agent finding — 2026-09-01

FRED sits behind a WAF that **drops the connection** for a bare `Name/Version` user agent. No
status code, no body: the request hangs until the client's own timeout and surfaces as "could not
reach the provider", which sends you looking at the network rather than at a header.

`BrewTerminal/0.2.0` was refused three times out of three. `BrewTerminal/0.2.0
(+https://github.com/KleivinX/Brew-Terminal)` succeeded three out of three, as did plain
`curl/8.4.0`. A Chrome user agent was **also refused**, which is worth recording: the fix is to
identify the client properly, not to imitate a browser — and imitating one would be the sort of
thing ADR-008 exists to rule out.

The agent is now defined once, in `providers::http::USER_AGENT`, and covered by tests that fail
if the contact URL is dropped or a browser token is added. Every FRED request in the app —
including the macro backdrop, which shipped in v0.2.0 — was failing before this was found.

### Series requested

Two allowlists, both in the adapter. Nothing user-supplied ever reaches the query string.

- `SERIES` — the seven offered in the macro picker: `DGS10`, `DGS2`, `T10Y2Y`, `FEDFUNDS`, `CPIAUCSL`, `UNRATE`, `DTWEXBGS`.
- `INDEX_INPUTS` — five fetched only as inputs to the computed sentiment index, and deliberately kept out of the picker: `SP500`, `VIXCLS`, `BAMLH0A0HYM2`, `BAMLC0A0CM`, `BAMLCC0A0CMTRIV`. All daily; a weekly series in a daily composite would make the index step on whichever weekday that series updates, which reads as a market event and is not one.

Missing observations are written as `.` and are skipped rather than read as zero.

---

## Atlas — the rotation manager

Atlas is a live ticker that draws on the providers above rather than adding one of its own. It
holds a per-provider allowance well below each published limit, counts **calls** rather than
ticks (Finnhub is one symbol per call, CoinGecko batches), books a call when it is made rather
than when it succeeds, and rests a provider that returns 429 for longer than it asked.

| Market   | Provider  | Atlas allowance | Notes                                                |
| -------- | --------- | --------------- | ---------------------------------------------------- |
| Crypto   | CoinGecko | 20/min, 200/day | Batches — one call serves the whole ticker.          |
| Equities | Finnhub   | 20/min          | One symbol per call; twelve symbols is twelve calls. |

Both figures are a slice of the provider's limit, not the whole of it, because the Research Lab
and the screener draw on the same account.

**Not in the rotation, and why** — see ADR-039:

- **Alpha Vantage.** One symbol per call against 25 requests a day. A twelve-symbol watchlist
  would spend half the daily budget on a single tick. It stays a chart-only provider.
- **Binance.** A genuine second crypto source, documented and keyless, but not yet through the
  ADR-008 terms review — and geo-restricted in the US, with Binance.US a separate API under
  separate terms.

## Deliberately not used

- **The well-known equity Fear & Greed index's data endpoint.** It is reachable and it is what that site's own charts call, but it is not offered as a public API and its terms do not cover third-party use. This is why the equity index in this app is computed rather than reported — see above.
- **Any undocumented or reverse-engineered endpoint**, including the unofficial Yahoo Finance endpoints. They work, they are widely used, and they are not offered as a public API. ADR-008 treats that as a decision about the project's standing rather than a technical question.
- **Scraping** of any provider's website.
- **Alpha Vantage**, for now: its free tier's daily budget is small enough that a refreshing watchlist would exhaust it and leave the UI permanently rate-limited — see ADR-013.

## Re-review checklist

Before each release, and whenever an adapter changes:

- [ ] Rate limits still match what the adapter is configured with
- [ ] Attribution wording and link unchanged
- [ ] Response shapes unchanged (adapter tests run against recorded fixtures, so a silent upstream change will not fail CI — check by hand)
- [ ] Desktop-client use and caching still permitted

## Community providers

**None is wired in.** The community pipeline exists in full — an opt-in gate enforced in Rust, a
`CommunityProvider` trait, validation, caching, and a UI that labels every post unverified with
its source and timestamp — but the only adapter that ships is the fixture one, and it is seeded
disabled.

The reason is the standard this document sets. Every provider listed above has had its terms
read and recorded. No discussion platform's terms have been, so none has been wired, and the app
says so in the panel rather than showing an empty list or implying a source exists.

Wiring one is a small piece of work — implement `CommunityProvider`, register it, seed it
disabled — behind a terms review that has not happened.

## AI providers

Two, both configured entirely by the user:

| Provider                          | Id             | Terms                                          | Notes                                                                                                                                                                              |
| --------------------------------- | -------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local OpenAI-compatible endpoint  | `local-openai` | None — it is the user's own server             | Ollama, llama.cpp's server, LM Studio and similar. Plain HTTP is permitted only when the host resolves to loopback (ADR-029).                                                      |
| Hosted OpenAI-compatible endpoint | `cloud-openai` | **Whatever the user's chosen service imposes** | Deliberately generic. The app names no vendor, because it cannot verify how any of them handle a prompt and putting a name on the settings page would imply that it can (ADR-032). |

### Not verified

Neither AI path has been exercised against a live endpoint. There is no model server and no
hosted account on the build machine, so the request path is covered by unit tests, the guardrail
suite and the browser harness — not by a real response from a real model. The adapter speaks the
OpenAI-compatible `/v1/chat/completions` shape; that it works against any specific server is
untested.
