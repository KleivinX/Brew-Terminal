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

## Deliberately not used

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
