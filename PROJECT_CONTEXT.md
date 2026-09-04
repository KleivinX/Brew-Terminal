# Brew Terminal — Project Context

> **Purpose of this file.** A briefing for an AI assistant that has no access to this codebase,
> so it can help write accurate, technically credible social posts about the project.
>
> **Sourcing convention used throughout:**
>
> - **[fact]** — read directly from the codebase, config, docs or git history in this repo.
> - **[inference]** — a reasonable conclusion drawn from those facts, not stated anywhere.
> - **[unknown]** — not determinable from the repo; do not assert it.
>
> Everything below was gathered by inspecting the repository on **2026-09-02**, at version
> **0.2.1** **[fact]**. No secrets, keys or credentials appear in this file, and none were found
> stored in the repo.

---

## 1. Project overview

**Brew Terminal is a local-first, open-source desktop application for market research and
financial literacy, covering crypto and stocks.** **[fact — `README.md`, `Cargo.toml` description]**

Its positioning line is _"Markets, minus the gatekeeping."_ **[fact — README]**

**The problem it addresses** **[fact — `docs/PRODUCT_SCOPE_V0_1.md` §1, README]**: market tools
generally fall into two camps — professional terminals that assume you already know the
vocabulary and cost a great deal, or consumer apps that simplify by hiding where numbers come
from and nudging you toward trades. Brew Terminal is a third thing: a research and literacy tool
that shows the provenance of every figure and teaches the vocabulary, while explicitly refusing
to tell you what to buy.

**What it is not**, stated as deliberate exclusions rather than missing features **[fact — README,
`docs/PRODUCT_SCOPE_V0_1.md` §3]**: not a broker, not a financial adviser, no order placement, no
accounts, no telemetry, no buy/sell/hold recommendations, no price targets, no scam scores, no
legitimacy verdicts, no ranking of opinions.

---

## 2. Motivation

Stated motivations found in the repository **[fact]**:

- **Provenance as a first-class constraint.** The architecture doc's stated rule is that "no
  number renders without its provider and its age" — enforced structurally, not by convention
  (see §5, the `Envelope<T>` type). **[fact — `docs/ARCHITECTURE.md` §2.2]**
- **Local-first and account-free.** No sign-up, no server, no cloud sync. Watchlists, notes and
  preferences live in a SQLite file on the user's own machine. **[fact — README]**
- **No telemetry.** The README's claim is that the app "makes no request you did not cause",
  with one stated exception: price alerts poll in the background, and are off until enabled.
  **[fact — README]**
- **Runs on modest hardware.** The stated reference machine is a **2016 Intel MacBook**, and
  performance budgets are written against it. **[fact — `docs/PERFORMANCE.md`, `Cargo.toml`
  release profile comments]**
- **Teaching over verdicts.** A crypto risk checklist ships with _no checkboxes and no tally_,
  on the reasoning that "anything that adds up is a verdict". **[fact — ADR-022]**

The owner's own framing, recorded in the disclaimer copy, is that the app is a tool and
responsibility for its use sits with the user rather than the app posing as an adviser
**[fact — disclaimer text: "A research tool, not an adviser. Your decisions, and their
consequences, are your own."]**.

---

## 3. Key features

All confirmed present in the codebase **[fact]** — nine routes in the primary navigation
(`src/components/layout/navItems.ts`):

| Route            | What it does                                                                         |
| ---------------- | ------------------------------------------------------------------------------------ |
| **Pulse**        | Market overview: crypto and stock tables, watchlist, news panel                      |
| **Portfolio**    | Positions derived from a transaction ledger; FIFO or average cost basis              |
| **Screener**     | Filters on reported facts — price, change, market cap, volume                        |
| **Research Lab** | Single-asset deep dive: chart, indicators, news, notes, risk checklist               |
| **Compare**      | Multi-asset indexed comparison, correlation matrix, macro backdrop, market sentiment |
| **Notes**        | Local research journal with SQLite FTS5 full-text search                             |
| **Learn**        | 50-term glossary and 5 learning paths, entirely offline                              |
| **Model Desk**   | Optional AI assistant — local or bring-your-own-key, off by default                  |
| **Settings**     | Providers, credentials, privacy, encrypted profile export/import, about              |

Feature detail worth knowing:

- **Two Fear & Greed indices** **[fact — `src-tauri/src/services/sentiment.rs`]**. The crypto one
  is _reported_ from Alternative.me's published API. The equity one is _computed in-app_ from
  five Federal Reserve (FRED) series, because no free documented equity index exists to report.
  Every component of the computed index ships with its input series, raw reading, arithmetic and
  inversion flag.
- **Encrypted portable profile** (`.brewprofile`) **[fact — `docs/THREAT_MODEL.md` §6]**:
  Argon2id + XChaCha20-Poly1305, zstd-compressed before encryption, containing **no API keys**.
- **Local AI model downloads** **[fact — `src-tauri/src/localai/`]**: the app can fetch a
  llama.cpp engine build and GGUF weights, each pinned to a SHA-256 taken from the publisher's
  metadata. Catalogue currently includes Qwen2.5 0.5B Instruct (~491 MB) and Llama 3.2 1B
  Instruct (~808 MB), both Q4_K_M quantised.
- **Price alerts**, local and polled, off by default **[fact — `services/alerts.rs`, README]**.
- **Outbound AI log**: before anything goes to a model the user gets an itemised list, and every
  send is recorded locally **[fact — README, `docs/AI_POLICY.md` §2]**.

---

## 4. Tech stack

### Desktop shell

- **Tauri 2.11** — Rust core + system webview **[fact — `Cargo.toml`]**
- **Rust edition 2021**, **MSRV 1.77.2**, pinned to match Tauri 2.11 **[fact]**
- Release profile tuned for the reference machine: `opt-level = "s"`, `lto = true`,
  `codegen-units = 1`, `strip = true`, `panic = "abort"` **[fact]**

### Rust dependencies **[fact — `Cargo.toml`]**

`rusqlite` (bundled SQLite, FTS5) · `r2d2` + `r2d2_sqlite` (pooling) · `tokio` · `reqwest`
(rustls + rustls-native-certs, deliberately **not** native-tls) · `serde`/`serde_json` ·
`thiserror` · `tracing` + `tracing-subscriber` · `chrono` · `uuid` · `async-trait` · `keyring`
(OS keychain) · `argon2` · `chacha20poly1305` · `zeroize` · `zstd` · `feed-rs` (RSS/Atom) ·
`sha2` · `flate2` + `tar` + `zip` (engine archives) · `url`
Dev: `tempfile`, `ts-rs`.

### Frontend **[fact — `package.json`]**

- **React 19.2** + **TypeScript 5.9** + **Vite 8**
- **TanStack Query 5** (server state) · **Zustand 5** (UI state) · **React Router 7** (hash history)
- **TanStack Virtual** (table virtualisation) · **lightweight-charts 5** (price charts)
- **Zod 4** (validation) · Inter + JetBrains Mono via Fontsource
- **CSS Modules** with a design-token layer — chosen over Tailwind **[fact — ADR / ARCHITECTURE §6]**

### Testing & tooling **[fact]**

Vitest 4 + Testing Library + jsdom · axe-core (accessibility) · ESLint 9 + typescript-eslint ·
`eslint-plugin-jsx-a11y` · Prettier · **three custom ESLint rules** written for this project:
`no-banned-copy`, `no-cross-feature-import`, `no-raw-html` **[fact — `eslint-rules/local.js`]**

### Data providers **[fact — `docs/PROVIDERS.md`, `src-tauri/src/providers/live/`]**

| Provider             | Purpose                                              | Credential                   |
| -------------------- | ---------------------------------------------------- | ---------------------------- |
| CoinGecko            | Crypto quotes, market lists, charts                  | Optional demo key            |
| FRED (St. Louis Fed) | Macro series + sentiment index inputs                | **None** — CSV endpoint      |
| Alternative.me       | Published crypto Fear & Greed index                  | **None**                     |
| RSS/Atom feeds       | News (CoinDesk, Cointelegraph, SEC, Federal Reserve) | None                         |
| Finnhub              | Equity quotes/profiles                               | Required, off until supplied |
| Alpha Vantage        | Equity charts                                        | Required, off until supplied |

### CI/CD **[fact — `.github/workflows/`]**

GitHub Actions. Frontend job on Ubuntu (format → lint → typecheck → content validation → test →
build → **bundle-size budget enforcement**). Rust job as a **three-OS matrix** (Ubuntu, macOS,
Windows) running fmt, clippy and tests. Separate release workflow builds and publishes desktop
bundles.

---

## 5. Architecture

Documented across 12 files in `docs/` **[fact]**, most relevantly `ARCHITECTURE.md` (12 numbered
sections), `DATA_MODEL.md`, `THREAT_MODEL.md` (10 sections), `AI_POLICY.md`, `PERFORMANCE.md`.

### The trust boundary

**All network I/O lives in Rust; the webview never makes an outbound request.**
**[fact — ARCHITECTURE §2.1]** The frontend never sends SQL and never sends a URL — commands are
verb-shaped and typed. The IPC map is the entire contract; anything not listed cannot be called.
**[fact — `src/lib/ipc.ts` header comment, ADR-002]**

### The `Envelope<T>` pattern — the project's signature idea

Every data-returning command replies with an envelope carrying the payload _plus_ provenance:
provider id, provider name, `fetchedAt` timestamp, source (`live` / `cache` / `mock`), a `stale`
flag and an optional `degraded` reason. **[fact — `src-tauri/src/models/envelope.rs`]**

The comment in that file states the intent plainly: the frontend _cannot obtain data without
also receiving attribution, timestamp and degraded state_ — dropping provenance would take
deliberate effort. **[fact]** This is the structural mechanism behind the product promise.
**[inference]**

### Layering

```
Tauri command  →  service (&AppState)  →  provider registry  →  adapter
                        ↓                                          ↓
                  SQLite (r2d2 pool)                        validate / normalize
                        ↓                                          ↓
                          ────────  Envelope<T>  ────────────────────
```

Commands are thin `#[tauri::command]` wrappers; logic lives in services taking `&AppState`
rather than `tauri::State`, which is what makes the full path testable without standing up a
Tauri app. **[fact — `src-tauri/src/services/mod.rs` header]**

### Type parity

Rust domain types export TypeScript definitions via **ts-rs**, generated during `cargo test`.
**66 generated type files** currently exist. **[fact — `src/types/generated/`]** The frontend
imports these rather than hand-written mirrors, so a Rust shape change breaks the TS build.
**[inference from the setup]**

### Caching

Read-through cache with stale-while-revalidate: ask the provider → on success write cache and
return fresh → on failure fall back to cache marked stale + degraded → with nothing cached,
return an empty payload _that still carries the degraded reason_. TTLs are set per data class
(quote 60s, intraday chart 5m, historical chart 6h, news 10m, search 24h, sentiment 3h).
**[fact — `src-tauri/src/services/market.rs`, `src-tauri/src/providers/cache.rs`]**

### Persistence

SQLite with WAL, forward-only migrations (**5 migration files**), FTS5 virtual table for note
search. Positions are **never stored** — they are derived by replaying the transaction ledger,
so cost basis, realised gain and the position itself can only ever agree.
**[fact — `src-tauri/migrations/0004_portfolio.sql` header comment]**

### Security posture **[fact — `src-tauri/tauri.conf.json`, `docs/THREAT_MODEL.md`]**

- Strict CSP: `default-src 'self'`, `object-src 'none'`, `frame-src 'none'`, `form-action 'none'`
- `freezePrototype: true`
- API keys go to the OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret
  Service) and are read inside the Rust HTTP layer at request time — **never sent over IPC**.
  The IPC surface returns only a boolean and a masked hint.
- Provider content treated as untrusted input; a `no-raw-html` lint rule bans `dangerouslySetInnerHTML`.

### Scale **[fact — measured on 2026-09-02]**

- ~22,300 lines of Rust across 97 files
- ~21,100 lines of TS/TSX across 112 files (excluding generated types)
- ~5,800 lines of frontend tests
- **82 IPC commands**
- **37 Architecture Decision Records**

---

## 6. Contributions and authorship

**What the repository shows** **[fact]**: `git log` records **26 commits**, all authored by
**Kleivin Gjuzi**, between **2026-08-25 and 2026-09-02** — nine days. Three release tags exist:
`v0.1.0`, `v0.2.0`, `v0.2.1`. Copyright in the code is attributed to Kleivin Gjuzi in
`TRADEMARK.md`.

**Scope of the work, as evidenced in the repo** **[fact]**: this is a solo project covering the
entire stack — the Rust core, the provider adapter layer, the SQLite schema and migrations, the
React frontend, the design-token system, the test suites, the CI matrix, the release pipeline,
and roughly 12 architecture/policy documents including 37 ADRs.

> **Honesty note for whoever writes the posts.** Git attributes every commit to one author, and
> several commits in this repository carry a `Co-Authored-By: Claude` trailer **[fact]** — this
> project was built with AI assistance in the loop. That is normal in 2026 and worth being
> relaxed about, but posts should not imply that every line was hand-typed if that is not the
> case. The genuinely defensible claims are about **direction, architecture, and the standards
> the project holds itself to** — the provenance rule, the refusal to ship verdicts, the terms
> review before any provider goes live, the ADR discipline. Those are authorship of a real kind.
> **[inference — flagged deliberately so the post does not overclaim.]**

---

## 7. Interesting technical challenges

All of these are documented in the repo, in code comments, ADRs or commit messages **[fact]**.

### A WAF that dropped connections instead of refusing them

FRED sits behind a WAF that **drops the connection** for a bare `Name/Version` user agent — no
status code, no body, just a hang until the client's own timeout. That surfaced as "could not
reach the provider", which sends you looking at the network rather than at a header. **Every FRED
request the app made was failing this way, including a feature that had already shipped in
v0.2.0.** Verified empirically: `BrewTerminal/0.2.0` refused 3/3; adding the conventional
`(+url)` contact comment succeeded 3/3. A Chrome user agent was **also** refused — so the fix
was to identify the client properly, not to imitate a browser (imitating one is ruled out by
ADR-008 anyway). **[fact — commit "Identify the client properly, or FRED drops the connection"]**

### Look-ahead bias in a computed index

The equity sentiment index scores each component by percentile rank over a trailing window. A
past reading must be ranked only against data that preceded it — otherwise the history looks
sharper than the index ever was in real time, the same mistake that flatters a backtest. There
is a test that truncates the input series and asserts a given day's reading does not move.
**[fact — `services/sentiment.rs`]**

### Calendar joins, not positional zips

The Treasury and corporate-bond calendars differ from the equity calendar by a handful of days a
year. Lining the series up by array index silently compares a Thursday with a Friday for the
entire remainder of the series after the first divergence. The code joins on timestamps.
**[fact — `services/sentiment.rs` `join_with`]**

### A flat market reading as maximum fear

Percentile rank using the naive "fraction strictly below" definition returns **0** for a
perfectly flat series — which would print _extreme fear_ for a quiet market. The implementation
uses the mid-rank convention (ties count half). **[fact]**

### A dev-only module that was not dev-only in the bundle

`ipc.browser.ts` — a development fixture harness that never runs in the shipped desktop app —
statically imported every fixture file. `chart_series.json` alone is 30 KB gzipped. That put
~35 KB of fixtures in the **entry chunk of the production app**, and it had been leaking since
Phase 1. Converting it to a dynamic import fixed it; the harness chunk has since grown to
38.5 KB, which would have been a 38.5 KB regression on every start. **[fact — `docs/PERFORMANCE.md`,
ADR-023]**

### Windows CI red for the entire project history

The fix was `.gitattributes` with `* text=auto eol=lf`: GitHub's Windows runners check out with
`core.autocrlf=true`, and several content files are `include_str!`'d directly into the Rust
binary. **[fact — recorded in project history]**

### An editor that blanked out the instant you saved

In the Notes route, saving asks the router to navigate to the new note's URL — but that
navigation is asynchronous. It had not landed by the time the list refetch rendered, so for a
frame the app had saved the note, was showing it in the list, and had collapsed the editor to
its "Nothing open" empty state. Fixed by sourcing the open note from `noteId ?? savedId` so the
URL still wins but the saved id covers the gap. Verified by sampling the editor every 40 ms
across a save: zero frames showing the empty state. **[fact — commit message]**

### Floating-point noise presented as someone's holding

The positions table rendered `{p.quantity}` raw. A quantity is a sum of what the user typed in,
and binary floating point does not hold decimal fractions exactly — buying 0.25 BTC then 0.1
more leaves `0.35000000000000003` in an f64. That landed in front of a user as their holding.
**Found by taking screenshots of the app**, not by any test. **[fact — commit "Stop the portfolio
showing floating-point noise as a holding"]**

### A CSS variable referenced 15 times and never defined

`--surface-raised` was used across the stylesheets but never declared in the token layer, so
every one of those surfaces silently rendered transparent. **[fact — fixed in commit "Define the
tokens the stylesheets were already reading"]**

---

## 8. Notable engineering decisions

Selected from the **37 ADRs** in `docs/DECISIONS.md` **[fact]**:

- **ADR-002 — Verb-shaped, typed IPC only.** The frontend never sends SQL or URLs. The command
  map is the whole contract.
- **ADR-003 — Bundled SQLite.** One version, one set of compile flags, identical behaviour on
  three platforms. A migration test asserts the FTS5 virtual table can actually be created, so
  an upstream change fails the suite rather than silently dropping note search.
- **ADR-008 — Mock providers first; live integrations gated on a terms review.** No provider is
  wired live until its terms, rate limits and attribution requirements are read and recorded in
  `PROVIDERS.md`. **No scraping and no undocumented endpoints, even where technically reachable
  — explicitly framed as a decision about the project's standing rather than a technical limit.**
- **ADR-009 — React Router with hash history.** Avoids custom-protocol path-resolution
  differences across three webviews; gives real deep links. Route-level `React.lazy` is the main
  lever for the bundle budget.
- **ADR-022 — The risk checklist has no checkboxes and no score.** "Anything that adds up is a
  verdict."
- **ADR-035 — Community shows what is being discussed, never what the discussion concludes.** No
  sentiment, no rank, no trend on user-generated content. A test asserts the model has no such
  field and the panel never uses the vocabulary.
- **ADR-037 — A market sentiment index is allowed; a verdict about an asset is still not.** The
  newest ADR, written specifically because the Fear & Greed feature sat against ADR-022/035. The
  line it draws: those forbid scoring an _asset's legitimacy_ or aggregating _opinion_; a market
  index describes _conditions_ from published measurements, attaches to no individual asset, and
  shows all its inputs. Its formulation is quotable: _the rule is not "no scores" but "no score
  whose inputs are hidden"._
- **rustls over native-tls** — identical TLS on three platforms, no OpenSSL build dependency on
  Linux; `rustls-native-certs` still reads the OS trust store so corporate proxies work.
- **CSS Modules + tokens over Tailwind** — recorded with reasoning in ARCHITECTURE §6.
- **`opt-level = "s"` over `"3"`** — the workload is I/O and SQLite, not computation, so binary
  size and page-in cost matter more than throughput on the reference machine.

---

## 9. Unique or impressive aspects

Things a developer audience would find genuinely notable **[fact unless marked]**:

1. **Provenance enforced by the type system.** `Envelope<T>` makes it structurally awkward to
   render a number without its source and age. Most apps make this a convention; this one makes
   it a type.
2. **A colour palette validated against colour-vision deficiency, not chosen by eye.** The chart
   palette is checked for lightness band, chroma floor, **CVD separation**, normal-vision floor
   and contrast, per theme. The token file's comment says outright: _"looks fine to me" is
   exactly the judgement the checks exist to replace._ Correlation uses a diverging orange↔blue
   pair rather than red-green, because red-green is precisely the pair a deuteranope cannot read.
3. **Three custom ESLint rules enforcing product policy in code**: `no-banned-copy` (bans
   verdict language — "guaranteed returns", "risk-free", "strong buy", "scam score"),
   `no-cross-feature-import`, `no-raw-html`.
4. **37 ADRs for a nine-day-old project.** The decision log is unusually disciplined, and several
   ADRs record decisions _not_ to build something.
5. **A computed financial index that shows its working.** The equity Fear & Greed index publishes
   every component's input series, raw value, arithmetic and inversion flag so the number can be
   recomputed by hand.
6. **Terms-review gate on data sources.** `PROVIDERS.md` records rate limits, attribution
   obligations and permitted use for each provider, with dates and source links — and a
   "Deliberately not used" section naming what was rejected and why.
7. **Cross-language constant pinning.** A test reads the Rust source and asserts the TypeScript
   note-size limits match, so the UI's character counter can't reassure a writer their note fits
   while the save fails validation.
8. **Navigation consistency enforced by test.** One `NAV_ITEMS` list drives the rail, both
   keyboard shortcut maps and the About page's shortcut table; six tests fail if a route is added
   without wiring it up everywhere.
9. **Performance budgets that are measured and published**, including honest blanks where a
   metric could not be measured properly.

---

## 10. Current state

### Working and verified **[fact — measured 2026-09-02]**

- **590 Rust tests** passing (unit + integration), **clippy clean at `-D warnings`**
- **491 frontend tests** across 34 files passing; ESLint clean; production build passes
- CI green across **Ubuntu, macOS and Windows**
- Released through **v0.2.1**, with desktop bundles published (`.dmg`, `.msi`, `.exe`,
  `.AppImage`, `.deb`, `.rpm`)
- Live provider integrations verified against real APIs: CoinGecko, FRED, Alternative.me, RSS

### Measured performance **[fact — `docs/PERFORMANCE.md`, on the 2016 Intel MacBook]**

| Metric                           | Budget   | Measured                        |
| -------------------------------- | -------- | ------------------------------- |
| Initial JS+CSS payload (gzipped) | —        | **99.8 KB**                     |
| Installer size (`.dmg`)          | ≤ 15 MB  | **5.0 MB**                      |
| Idle RSS, 60 s after launch      | ≤ 300 MB | **115.5 MB** across 3 processes |
| Idle CPU, focused                | < 1 %    | **0.0 %**                       |
| Launch → CPU settled (warm)      | —        | 2.66 s                          |

> Note: the build/test timing table in `PERFORMANCE.md` still cites 96 Rust and 139 frontend
> tests and is **out of date** relative to the current 590/491. **[fact]**

### Incomplete, unverified, or explicitly not done **[fact]**

- **The AI cannot see the user's data.** `AiContextItem` and the consent dialog exist, but the
  Model Desk has no access to the portfolio, watchlist, screener results or the current chart.
  This is the single largest known gap.
- **Neither AI path has been exercised against a live endpoint** — no model server or hosted
  account exists on the build machine. Covered by unit tests, guardrail suite and the browser
  harness only. **[fact — `docs/PROVIDERS.md`]**
- **No community provider is wired in.** The full pipeline exists (opt-in gate, trait,
  validation, caching, labelled UI) backed by a fixture provider only, because no discussion
  platform's terms have been reviewed.
- **Finnhub and Alpha Vantage adapters are implemented but disabled** until the user supplies a key.
- No live Alpha Vantage call has been made; the alert poller has not been observed over a real
  interval; the portfolio has not been reconciled against a broker statement.
- `PRODUCT_SCOPE_V0_1.md` describes v0.1 and is annotated as superseded: four of its stated
  non-goals have since shipped deliberately (portfolio cost basis, price alerts, RSI, sentiment).
- 5 of the 6 README screenshots use bundled demo fixtures rather than live data; the README says so.

---

## 11. Results and impact

**Measurable, from the repo** **[fact]**:

- Ships in **5.0 MB** against a 15 MB budget; **99.8 KB** initial payload against a 200 KB budget
- **115.5 MB** idle RSS against a 300 MB budget; **0.0 %** idle CPU
- **1,081 automated tests** (590 Rust + 491 frontend) for a nine-day-old project
- Cross-platform CI on three operating systems, green
- Three tagged releases in nine days

**Explicitly unknown** **[unknown]**: user counts, downloads, stars, external contributors,
adoption, revenue, or any third-party feedback. Nothing in the repo evidences these. **Do not
claim them.**

---

## 12. Lessons learned

Drawn from what the repo actually records **[fact]**, phrased as they could be told:

1. **A silent failure is worse than a loud one.** FRED's WAF dropped connections rather than
   returning an error, so a completely broken integration looked like flaky networking — and
   shipped in a release that way. Only an end-to-end test against the real API caught it.
2. **Tests can pass while the product is broken.** Two of the formatting bugs were found by
   _looking at screenshots of the app_, not by any of the 1,000+ tests.
3. **Timeouts can hide real defects.** A flaky test was "fixed" by adding a longer wait, and it
   then failed deterministically — revealing a genuine UX flaw where the editor blanked out after
   a save. The first instinct would have hidden it behind a green suite.
4. **A dev-only module reachable through a static import is not dev-only in the bundle.**
5. **Documents drift from the code, and drift is a bug.** The README claimed there was no
   sentiment score anywhere in the app while two shipped; keyboard shortcuts advertised routes
   that did not exist. Deriving copy from a single source list is the durable fix.
6. **Fixture data has to express what it claims.** Several test fixtures were "wrong" in a way
   that looked right — a linearly rising VIX reads as _calmer_ over time in percentage terms, so
   a fixture meant to represent fear actually represented calm.
7. **Naming things for what they sit on beats naming them for context.** The two logo ink
   variants are named for the background they go on, because getting it backwards makes the mark
   vanish rather than merely look wrong.

---

## 13. Post ideas

Ten angles, each grounded in something specific and verifiable in this repository.

1. **"A WAF that hangs up instead of saying no."**
   FRED silently dropped every request with a bare `Name/Version` user agent — no status, no
   body — so a completely dead integration looked like a flaky network and shipped that way. A
   Chrome user agent was _also_ refused, so the fix was identifying the client properly, not
   imitating a browser. Strong hook: _"my app had been broken in production for a release and
   the tests couldn't have known."_

2. **"Provenance as a type, not a convention."**
   Every data-returning command returns `Envelope<T>` carrying provider, timestamp, source,
   staleness and degraded reason. You cannot get the data without the attribution. Great for a
   short code-shaped post about making a product promise structurally enforced.

3. **"I shipped a sentiment score, then had to write an ADR explaining why I was allowed to."**
   The project had two prior decisions saying "anything that adds up is a verdict". ADR-037 draws
   the line: those forbid scoring an _asset_ or aggregating _opinion_; a market index describes
   _conditions_ from published measurements. The quotable line: **the rule is not "no scores" but
   "no score whose inputs are hidden."** Unusually reflective engineering content.

4. **"Screenshots found two bugs my thousand tests didn't."**
   `0.35000000000000003` rendered as someone's Bitcoin holding, and `$0.00000000` as a realised
   gain. Both invisible to the suite, both obvious the moment you looked at the app. Ties to a
   broader point about the limits of automated testing.

5. **"The flaky test was telling the truth."**
   A test failed 3 runs in 4. Adding a longer timeout made it fail _consistently_ — which
   revealed a real bug: the notes editor blanked to its empty state for a frame after every
   save, because it was waiting on an async router navigation for something it already knew.
   Measured the fix by sampling the DOM every 40 ms.

6. **"I don't pick chart colours by eye."**
   A validator checks every palette entry for lightness band, chroma floor, colour-vision-
   deficiency separation and contrast, per theme. Correlation uses orange↔blue rather than
   red-green because red-green is exactly the pair a deuteranope can't read. Pairs well with a
   screenshot.

7. **"Three ESLint rules that enforce product policy, not code style."**
   `no-banned-copy` fails the build on words like "guaranteed returns", "risk-free" and "strong
   buy". If the product promise is "we never give verdicts", the linter should be able to say so.

8. **"A 5 MB desktop app with a 99.8 KB initial payload, built for a 2016 MacBook."**
   Real numbers against published budgets: 115.5 MB idle RSS, 0.0 % idle CPU, 2.66 s warm launch.
   Includes the story of a dev-only fixture harness that had been leaking ~35 KB into the
   production entry chunk since Phase 1.

9. **"No scraping, even where it works."**
   The well-known equity Fear & Greed index has a reachable endpoint its own site calls. The
   project refuses to use it, and computes an index from Federal Reserve data instead — showing
   every component. Framed in ADR-008 as a decision about the project's standing rather than a
   technical limitation.

10. **"37 ADRs in nine days — and several of them record decisions _not_ to build something."**
    The risk checklist with no checkboxes. The community panel with no ranking. Writing down what
    you deliberately didn't build, and why, as a first-class engineering artefact.

---

## 14. Demo and setup

**[fact — `package.json`, README]**

```bash
npm install
npm run dev          # frontend only, in a browser, backed by a fixture harness
npm run tauri:dev    # the full desktop app
npm run check        # format + lint + typecheck + test
npm run tauri:build  # produce desktop bundles
```

Rust side: `cargo test`, `cargo clippy --all-targets -- -D warnings` from `src-tauri/`.
Live-provider tests are `#[ignore]`d by default and run with
`cargo test --test live_network -- --ignored --nocapture`.

**Demo notes:**

- Outside Tauri the app runs against a **browser fixture harness** — the same fixture files the
  Rust mock provider reads — so `npm run dev` works with no network and no keys. The status bar
  says "Mock data — development fixtures, not real market data" so a demo is never mistaken for
  live. **[fact]**
- In a **release build**, CoinGecko, FRED, Alternative.me and RSS all work **with no API key at
  all**, so a fresh install shows real market data immediately. **[fact]**
- Screenshots live in `docs/screenshots/` and are embedded in the README. **[fact]**

**Licensing** **[fact]**: code is **AGPL-3.0-or-later**. The name, logo and visual identity are
_not_ covered by it — `TRADEMARK.md` requires forks to rename and re-brand. Worth mentioning in
any post that shows the logo.

**Repository**: `github.com/KleivinX/Brew-Terminal` **[fact — git remote]**
