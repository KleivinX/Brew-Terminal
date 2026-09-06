# Connectors

Where Brew Terminal can get data, how much this project actually knows about each source, and
which screens use what.

The in-app version of this is `/connectors`. This file is the part that does not fit in a table:
the policy, the mapping, and the reasoning.

> **Connector and provider are different words here.** A **provider** is a running adapter — it
> has code, a place in the registry, and it answers requests. A **connector** is a catalogue
> entry. Every provider is a connector; most connectors are not providers.

---

## The three stages, and why a catalogue needs them

ADR-008 says no source is wired live until its terms and limits have been read and recorded in
[PROVIDERS.md](PROVIDERS.md). A catalogue listing a hundred sources with a rate limit beside each
would quietly assert a hundred terms reviews. A table is a very convincing place to state
something untrue, and this is an app whose entire premise is that a figure arrives with its
provenance.

So every entry has a stage, and the stage gates the rest of the row:

| Stage            | What it means                                                          | What the row carries               |
| ---------------- | ---------------------------------------------------------------------- | ---------------------------------- |
| **Wired**        | Terms read, recorded, adapter written, tests passing                   | Limits, licence, attribution, auth |
| **Declined**     | Terms read, and the answer was no — or not yet                         | The reason, in full                |
| **Not reviewed** | A name and a category. Nobody has read a word of this provider's terms | Nothing else. Deliberately.        |

`catalogue::tests::a_candidate_carries_no_claim_about_anyones_terms` enforces the third row: a
candidate with a rate limit, a risk level, an auth type or an attribution requirement fails the
build.

This is deliberately not a "tier 0 / tier 1 / tier 2" split. Tiers describe how much a _user_ is
trusted with something. Stages describe how much _this project actually knows_, which is the
question the screen exists to answer.

## Terms risk, for the connectors that have been reviewed

| Badge                             | Meaning                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------- |
| Free, documented, fine to ship    | The terms permit a distributed desktop app to poll it                           |
| Free but tightly limited          | The allowance stretches to occasional or user-initiated use, not a refresh loop |
| Free to evaluate, paid to rely on | The free tier exists for evaluation; sustained use is expected to be paid       |
| Needs a written agreement         | The terms require an agreement before an application may use it at all          |

Only one connector currently sits in the last row — OpenSky — and it is the reason the row
exists. See ADR-040.

## What is wired today

Eleven adapters. Nine are switchable in Settings; two are not, and the catalogue says so rather
than showing a toggle that would do nothing.

| Connector      | Category   | Auth         | Switchable | Default |
| -------------- | ---------- | ------------ | ---------- | ------- |
| CoinGecko      | Crypto     | Key optional | yes        | on      |
| Finnhub        | Equities   | API key      | yes        | off     |
| Alpha Vantage  | Equities   | API key      | yes        | off     |
| FRED           | Macro      | Keyless      | **no**     | always  |
| Alternative.me | Crypto     | Keyless      | **no**     | always  |
| RSS / Atom     | News       | Keyless      | yes        | on      |
| World Bank     | Macro      | Keyless      | yes        | on      |
| Frankfurter    | FX         | Keyless      | yes        | on      |
| USGS           | Geospatial | Keyless      | yes        | on      |
| NWS            | Geospatial | Keyless      | yes        | on      |
| OpenSky        | Geospatial | OAuth2       | yes        | **off** |

FRED and Alternative.me have no `provider_config` row because the services that use them
construct them directly. Neither needs a credential and neither serves market data, so there has
never been anything to configure — but a catalogue that showed them as absent, or as switchable,
would be wrong in different ways.

## Feature to connector

**What each route uses today.** This is description, not aspiration.

| Route        | Connectors in use                                          |
| ------------ | ---------------------------------------------------------- |
| Pulse        | CoinGecko, Finnhub, RSS, Alternative.me, FRED              |
| Atlas        | CoinGecko, Finnhub (through the rotation manager, ADR-039) |
| Screener     | CoinGecko, Finnhub                                         |
| Research Lab | CoinGecko, Finnhub, Alpha Vantage (charts), RSS            |
| Compare      | CoinGecko, Finnhub, Alpha Vantage, FRED                    |
| Portfolio    | CoinGecko, Finnhub — for valuing what the user typed in    |
| Sentry       | USGS, NWS, World Bank, Frankfurter, OpenSky (opt-in)       |
| Notes, Learn | None. Both are local-only.                                 |
| Model Desk   | **None directly** — see below                              |

**Where a reviewed candidate would go.** Not commitments; a note for whoever does the review, so
the work has a destination.

| Route        | What is missing today                    | Candidates that would serve it                                             |
| ------------ | ---------------------------------------- | -------------------------------------------------------------------------- |
| Pulse        | A second crypto source; equities breadth | CoinCap, Coinpaprika; Marketstack, Twelve Data, StockData                  |
| Screener     | Fundamentals to filter on                | Financial Modeling Prep, Twelve Data                                       |
| Research Lab | Filings, and on-chain context            | SEC EDGAR; DefiLlama, Coin Metrics, Dune                                   |
| Compare      | A third opinion on the same asset        | Any reviewed second crypto source — the disagreement is the teaching point |
| Portfolio    | Read-only wallet balances                | Covalent, Ethplorer, Blockchair, Mempool                                   |
| Sentry       | Global event context                     | GDELT — but its tone measure is computed, so ADR-022 applies first         |

Two of those need a decision before any review starts:

- **Wallet connectors** would mean the app reads an address the user supplies. That is a privacy
  surface this app does not currently have, and it needs its own ADR — what is sent, to whom,
  what is cached, and what the offline story is — before an adapter is written.
- **GDELT tone** is a model output, not a published figure. Drawing it beside earthquake
  magnitudes without saying so would be exactly the conflation ADR-022 and ADR-035 rule out.

**Compare is the one route where a second source is the feature, not redundancy.** Two providers
quoting the same asset differently is a fact about how markets and aggregators work, and showing
both with their provenance teaches it. That only works if both are reviewed and both are labelled.

## The Model Desk fetches nothing

The AI never reaches the network for data. It has no HTTP access at all — the webview cannot make
requests (ADR-002) and the model is either local or a user-configured endpoint. When it needs a
figure, it names a command, the Rust side runs it through the same provider → cache → envelope
path as every screen, and the answer comes back with its provider and age attached.

That is not a limitation to work around. A model that fetched its own data would be a number on
screen with no provider id, which is the one thing this app does not produce.

## Rate limits and caching

Two tiers, and they are kept in step deliberately: the frontend's `staleTime` and the Rust
`CacheKind::ttl_seconds` describe the same freshness, so one tier does not consider something
fresh while the other refetches it.

| Cache kind        | TTL | Why                                                                  |
| ----------------- | --- | -------------------------------------------------------------------- |
| `Quote`           | 60s | Matches the default refresh interval                                 |
| `ChartIntraday`   | 5m  | Intraday shape does not change second to second                      |
| `ChartHistorical` | 6h  | Daily closes are immutable once the day is done                      |
| `Profile`         | 7d  | Company descriptions do not move                                     |
| `News`            | 10m | Feeds publish on the order of minutes                                |
| `Search`          | 24h | An asset list is near-static                                         |
| `Sentiment`       | 3h  | Both Fear & Greed indices are daily figures                          |
| `Hazard`          | 15m | How long an earthquake or aircraft position is worth falling back to |
| `Reference`       | 24h | Annual indicators and daily central bank rates                       |

`cached_or_degraded` always asks the provider first and reads the cache only when that fails, so
these TTLs govern **how long a fallback stays useful**, not how often anything is fetched. How
often is decided by the refresh interval of the screen: 60s for quotes, 90s for Atlas, 3 minutes
for Sentry, and nothing at all for a screen nobody is looking at — every interval in the app is
`refetchIntervalInBackground: false`.

**Rules for anything added later.**

1. **Set the ceiling below what the provider publishes.** A client running at exactly the
   documented limit is one clock skew from a 429, and the margin costs nothing at these cadences.
2. **Count calls, not ticks.** Finnhub takes one symbol per request; CoinGecko returns a whole
   list. A manager counting ticks is wrong by the length of the watchlist. ADR-039.
3. **Book the call when it is made, not when it succeeds.** The provider counted it either way,
   and booking on success lets a run of failures walk through a daily cap.
4. **A tight daily allowance means user-initiated only.** Alpha Vantage's 25 requests a day
   cannot serve a refreshing screen, so it serves charts and its `quotes()` returns nothing on
   purpose. Anything with a comparable budget gets the same treatment rather than a smaller
   interval.
5. **Rest longer than asked.** Atlas backs off exponentially from a 60-second floor to a
   15-minute cap after repeated failures, and honours `Retry-After` when it is longer than that.

## Adding a connector

In this order, and the order is the point:

1. Read the terms. Record them in [PROVIDERS.md](PROVIDERS.md) — limits, licence, attribution,
   what is permitted for a distributed desktop client.
2. Verify the response shape against a real request, not against the documentation.
3. Write the adapter, with tests over a captured fixture.
4. Change the stage in `services/connectors/catalogue.rs` and fill in the rest of the row.
5. Decide the default. Off unless there is a reason it should be on, and "it is free" is not one
   — OpenSky is free.

The catalogue entry is step four, not step one. A row that appears before the review has happened
is the thing this whole design exists to prevent.
