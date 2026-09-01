# Brew Terminal — session handoff

**Written for a fresh Claude Code session picking this project up.** Read this first; it is the
fastest path to being useful without re-deriving decisions that are already made.

_Last updated: end of Phase 7, 2026-08-25._

---

## 1. What this is, in one paragraph

Brew Terminal is a local-first, open-source desktop app (Tauri 2 + Rust + React/TS) for market
research and financial literacy. It is **not** a trading platform, a portfolio tracker, or an
adviser, and refusing to become one is a design constraint rather than a missing feature. The
owner supplied a detailed brief (`~/Desktop/brew-terminal-claude-megaprompt.md` — still on the
Desktop, not in the repo) specifying a
seven-phase build. **All seven phases are implemented.** What remains is verification that can
only happen outside this machine — see §8.

Reference hardware is a 2016 Intel MacBook — which is also the development machine, so every
performance number in the docs was measured on the target.

## 2. Where things stand

| Phase | Scope                                                        | State |
| ----- | ------------------------------------------------------------ | ----- |
| 0     | Architecture, scope, threat model, data model                | Done  |
| 1     | App shell, 3 themes, command palette, SQLite, mock providers | Done  |
| 2     | Pulse, watchlists, live providers, OS keychain               | Done  |
| 3     | Research Lab, charts, notes, risk checklist                  | Done  |
| 4     | Learn — 50-term glossary, 5 paths, 17 lessons                | Done  |
| 5     | Model Desk — local and hosted AI                             | Done  |
| 6     | Community temperature, encrypted `.brewprofile`              | Done  |
| 7     | Release readiness                                            | Done  |

**Since v0.1.0 shipped** (all on `main`, none released yet):

| Change                                                                          | State                                   |
| ------------------------------------------------------------------------------- | --------------------------------------- |
| RSS/Atom news adapter; fixture news provider **deleted**                        | Done                                    |
| `source_for` bug fix — fixture data was labelled `source: live`                 | Done                                    |
| Local model downloads: pinned catalogue, verified downloader, engine supervisor | Done, **never run end to end**          |
| Manual update check (no polling)                                                | Done                                    |
| Bundled Inter + JetBrains Mono                                                  | Done                                    |
| Credits panel                                                                   | Done                                    |
| `.gitattributes`; CI emits failures as readable annotations                     | Done, **unverified — needs a push**     |
| Repositioned from "educational only" to a liability disclaimer                  | Done                                    |
| Portfolio: transactions, FIFO/average cost basis, realised and unrealised P&L   | Done                                    |
| Indicators: SMA, EMA, RSI, MACD, Bollinger as chart overlays                    | Done                                    |
| Alpha Vantage adapter — equities finally have charts                            | Done, **no live call made**             |
| Screener over the cached market list                                            | Done                                    |
| Price alerts with a background poller                                           | Done, **poller never observed running** |
| Contribution/DCA backtest                                                       | Done                                    |

**620 tests passing** — 327 frontend (vitest), 293 Rust. Clippy clean at `-D warnings`, both
formatters clean, entry bundle 94.5 KB gzipped against a 200 KB budget, `npm audit` clean.

**The performance budget is measured, not estimated.** A packaged release build was produced
(17m 48s) and exercised: installer 5.0 MB against 15 MB, idle RSS 115.5 MB against 300 MB, idle
CPU 0.0 %. Two cells in `docs/PERFORMANCE.md` §3 are still blank — start-to-interactive needs a
first-paint mark that does not exist, and the doc says so rather than substituting
launch-to-idle.

**A git repository now exists** with one commit on `main`. There is no remote and nothing has
been pushed — that is the owner's call.

## 3. Read these, in this order

Everything important is documented in the repo. Do not re-derive it.

1. `docs/PRODUCT_SCOPE_V0_1.md` — features, **non-goals**, per-phase acceptance criteria with checkboxes, including honest notes on what each criterion does _not_ cover
2. `docs/DECISIONS.md` — **36 ADRs**. The highest-value file in the repo; each records what was chosen, what was rejected, and why
3. `docs/ARCHITECTURE.md` — process model, IPC, service layer, provider routing, caching, performance budget
4. `docs/PROVIDERS.md` — verified terms, rate limits and API quirks for every provider, plus a "Not verified" section that matters
5. `docs/THREAT_MODEL.md` — what is protected, what explicitly is not
6. `docs/AI_POLICY.md` — the guardrail system prompt and the privacy boundary
7. `docs/DATA_MODEL.md`, `docs/UI_MAP.md`, `docs/DEPENDENCIES.md`, `docs/PERFORMANCE.md`

## 4. The safety stance — the thing most easily eroded

This is what makes the product what it is, and it is the easiest thing to accidentally undo.
Every one of these is enforced by a test, a lint rule, or the type system.

- **No number renders without its provider and its age.** The IPC `Envelope<T>` carries `providerId`, `providerName`, `fetchedAt`, `source`, `stale` and `degraded`. The frontend cannot obtain data without provenance.
- **No causal claims about price moves.** The brief asked for a "What moved this?" panel; it is titled **"Published around this time"** and its body says explicitly that adjacency in time is not causation (ADR-021).
- **No verdicts.** The crypto risk checklist has no checkboxes and no score. The community panel has no sentiment, no ranking and no "trending" — anything that adds up is a legitimacy judgement (ADR-022, ADR-035).
- **No advice-shaped language.** A custom ESLint rule (`eslint-rules/local.js`) bans a phrase list in source; `tests/safety/copy.test.ts` sweeps source and fixtures; the Learn content validator sweeps the content bundle; and the same list scans model output at runtime, with a test asserting the two lists cannot drift apart.
- **Fixtures are never the default in a release.** The mock provider is seeded enabled only under `debug_assertions` (ADR-018).
- **API keys never travel outward over IPC.** They go into the OS keychain; the IPC surface returns a boolean and a masked hint. Asserted by tests at both layers, and `has_credential` is forced to `false` on profile import.
- **Nothing leaves the device without an explicit user action.** For the Model Desk this is enforced in Rust, not just the UI: `bootstrap_configures_nothing_and_sends_nothing` asserts startup sends nothing, and every send is written to `ai_outbound_log` before the request goes out.
- **"Local · offline" is earned.** It appears only when the configured host actually resolves to a loopback address, and resolution failure fails closed (ADR-029).

If a change would weaken any of these, that is a conversation with the owner, not a refactor.

## 5. Hard-won facts you would otherwise rediscover the slow way

### Environment

- **The project lives at `~/Developer/Brew Terminal`. Keep it out of `~/Desktop` and `~/Documents`** — both are iCloud-synced on this machine, and iCloud was actively corrupting the build.

  What it did, while the project was on the Desktop: evicted three `.node` native bindings
  (rolldown, lightningcss, `@tauri-apps/cli`) and replaced them with `.icloud` placeholder
  stubs, which killed the whole test suite with "Cannot find native binding". `brctl download`
  would not bring them back — `rm -rf` on the affected package directories plus `npm install`
  did. It had also evicted 196 files out of `target/debug/deps` and left _conflict copies_
  (`index 2.html`) in `dist/`.

  It was also syncing **10 GB of cargo build cache** to iCloud, on a disk that was 88% full.
  Moving the project and deleting `src-tauri/target` took it to 79%.

- Diagnose a recurrence with `find node_modules -name "*.icloud"`. If anything shows up, the
  project has ended up somewhere synced again.
- The four sibling projects under `~/Desktop/Kleivin/Coding projects/` are still on iCloud and
  have the same exposure.

### Provider quirks (all verified against live APIs, recorded in `docs/PROVIDERS.md`)

- **CoinGecko free/Demo tiers cap history at 365 days.** `days=max` fails with error 10012, so `ChartRange::Max` is deliberately **absent** from its capabilities and the UI renders no Max button.
- **CoinGecko sends millisecond timestamps.** Everything else in the app is seconds; converted at the adapter boundary.
- **CoinGecko returns a real HTTP 429** on rate limit (not 200-with-error-body), so `http.rs` maps it correctly.
- **CoinGecko `/coins/markets` returns a whole watchlist plus sparklines in one request** — this is why it is viable on a 10,000-calls/month budget.
- **Finnhub `/quote` takes one symbol per call. There is no batch endpoint.** 25 symbols = 25 calls against 60/minute. The adapter reserves budget up front and fans out 4 at a time.
- **Finnhub supports `X-Finnhub-Token` header auth** — used instead of the `token` query param so keys never enter URLs or logs (ADR-019).
- Sparklines arrive as 168 hourly points and are downsampled to 24 at the adapter boundary.

### Toolchain constraints

- **TypeScript is pinned to 5.9.3, not 7.x** — `typescript-eslint` caps at `<6.1.0`, and the custom lint rules are load-bearing (ADR-014).
- **ESLint is pinned to 9.39.5, not 10** — `eslint-plugin-jsx-a11y` supports 9 at most.
- **`reqwest` 0.13 renamed the feature to `rustls`**, not `rustls-tls`.
- **`keyring` 4's default `v1` feature** already covers all three platforms.
- **MSRV is 1.77.2**, matching Tauri. Do not use APIs stabilised after that (clippy's `incompatible_msrv` catches it).
- **rusqlite has no `fts5` feature** — FTS5 is compiled into the `bundled` build. The migration test proves it.
- **`tauri-driver` has no macOS support.** E2E runs on Linux/Windows in CI only; macOS relies on component tests plus the mocked-`invoke` browser harness.

### Gotchas found by breaking things

- **A dev-only module reachable through a static import is not dev-only in the bundle.** `ipc.browser.ts` statically imported every fixture, putting ~35 KB into the shipped entry chunk since Phase 1. Now a dynamic import (ADR-023).
- **`lightweight-charts` paints theme colours into a canvas at creation** — it needs the theme as an effect dependency or it keeps dark-theme grid lines on a white background (ADR-025).
- **An inline-arrow `onClose` prop makes a focus effect thrash.** In `Modal` this restored focus to the trigger on every keystroke; typing a space then closed the dialog. Fixed with a ref.
- **`Panel` fills its parent only with `fill`** — `flex: 1` by default squashed every panel in a scrolling column (ADR-024).
- **jsdom reports every element as 0×0**, so `@tanstack/react-virtual` renders no rows. `vitest.setup.ts` patches element dimensions.
- **Test timeout is 15s, not the 5s default** — the longer interaction flows time out on a loaded dual-core machine.
- **The React Compiler lint rule bans `setState` inside an effect.** Both places that tripped it were better written as derived state anyway — see `AiPanel`'s `endpointEdit ?? status?.endpoint ?? ''` pattern.
- **Prettier reformats `content/ai/system-prompt.md`,** inserting blank lines around its plain-text headings and changing the bytes sent to a model. `content/ai/` is in `.prettierignore` for that reason.
- **The harness writes `ai_outbound_log` before the request resolves** (by design — the log records attempts). A test that waits on the log races the mutation; wait on the assistant message instead.

## 6. Architecture in brief

```
Webview (React 19, no secrets, no network — CSP blocks connect-src)
   Feature UI → TanStack Query → src/lib/ipc.ts (typed contract)
        │ invoke()
Rust core (Tauri 2)
   commands/*  thin wrappers, unwrap State
   services/*  ALL logic lives here, takes &AppState  ← testable without Tauri (ADR-016)
   providers/  registry routes BY ASSET TYPE, merges results (ADR-017)
     ├ live/coingecko.rs   crypto, enabled by default, keyless
     ├ live/finnhub.rs     equities, disabled until keyed
     ├ mock/               fixtures, seeded enabled in debug builds only
     ├ ai.rs               OpenAI-compatible chat; its OWN http client (ADR-029)
     ├ governor.rs         rate limits, backoff — pure logic, fully tested
     └ http.rs             HTTPS-only, 15s timeout, 2MB cap, URL redaction
   db/         rusqlite bundled, WAL, forward-only migrations
   security/   keychain, log redaction, .brewprofile envelope
```

**Key invariant:** all network I/O is in Rust. The webview's CSP sets `connect-src` to IPC only,
and an ESLint rule bans `fetch`. This is what keeps API keys out of the process that renders
untrusted provider strings (ADR-002).

**One deliberate exception:** `providers/ai.rs` builds its own HTTP client and permits plain
HTTP when — and only when — the host resolves to loopback. Every local model server serves plain
HTTP on `127.0.0.1` and ships no certificate. ADR-029 and THREAT_MODEL.md §7 record it.

**Canonical asset ids** (`crypto:cg:bitcoin`, `stock:us:AAPL`) are how provider routing works
and why user data survives a provider swap. User data never references a provider id.

## 7. Working on this

```bash
npm run tauri:dev      # the real desktop app
npm run dev            # UI in a browser against the same fixtures — much faster loop
npm run check          # format, lint, typecheck, tests
npm run validate:content   # Learn content gate (also runs in `npm run build`)
cd src-tauri && cargo test
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo test --test live_network -- --ignored   # real network, opt-in
```

**Verification habit that has repeatedly paid off:** run the app in the browser preview and
actually look at it. Bugs found by looking rather than by tests, across sessions: collapsed
panels, stale chart theming, clipped table columns, a palette that navigated to Microsoft when
asked for the Soft theme.

**Conventions:** feature slices may not import each other (enforced by lint — shared code moves
into `lib/` or `components/`; cross-feature handover uses router state, as Learn → Model Desk
does). Optional props need `| undefined` (`exactOptionalPropertyTypes`). Components reference
semantic CSS tokens, never raw hex. Direction is never colour alone.

## 8. Outstanding — carry these forward

### Needs the owner

- **Bundle identifier** — assumed `com.brewterminal.app` in `tauri.conf.json`.
- **CI is red on `main`.** The Windows Rust leg fails; macOS, Linux, the frontend and the audit
  all pass. The failure has never been diagnosed because job logs need repo-admin rights to
  download — which is why the `Test` step now echoes failures as workflow annotations, which
  _are_ publicly readable. The next push to `main` should make the cause visible without
  anyone having to open the log.
- **The v0.1.0 release has an empty body and is not flagged pre-release.** Confirmed from the
  API: `name=''`, `body=''`, `prerelease=false`. `tauri-action` only writes those when it
  _creates_ the release, and this one already existed, so it just uploaded assets. Users get no
  unsigned-app instructions. Fix in the GitHub UI, and consider having the workflow create the
  release explicitly before the matrix runs.
- **The repository has no description, no topics and no homepage.**
- **Code signing.** The app is unsigned, so a `.dmg` that is downloaded or AirDropped anywhere
  is blocked by Gatekeeper. A locally built one opens fine because it carries no quarantine
  flag. Distributing to anyone else needs an Apple Developer ID certificate plus notarization.

### Not verified, and honestly so

- **A model has now answered, on this machine, end to end.** The Model Desk's request path is
  no longer covered only by tests: `cargo test --test live_localai -- --ignored` downloads the
  pinned engine and the 0.5B model, starts the server on loopback and gets a real completion
  back. On the run that proved it, engine and weights both matched their published checksums
  byte-for-byte, the server was ready in two seconds, and the model replied `"ready"`.

  Set `BREW_TEST_ENGINE_DIR` and `BREW_TEST_MODEL` to reuse cached files — 470 MB per run makes
  a test nobody runs twice.

  Still open: no request has gone to a _hosted_ provider with a real API key. That path shares
  `assemble_messages` and the outbound log with the local one, so most of it is exercised, but
  the cloud adapter itself has never made a live call.

- **The local model path is now partly proven, for real.** `src-tauri/tests/live_localai.rs`
  holds three `#[ignore]` tests that download the actual files. The engine one has been run:
  11 MB fetched from the pinned URL, checksum and byte length both matching the catalogue, the
  archive unpacked, and `llama-server` found where `store::server_binary` looks for it. Run them
  with `cargo test --test live_localai -- --ignored --nocapture`.

  **Running them immediately found a bug that would have shipped.** The downloader used the
  shared HTTP client, whose `REQUEST_TIMEOUT` caps the _entire_ request including the body at 15
  seconds. That is right for a JSON API response and impossible for model weights: no 470 MB
  download completes in 15 seconds on any domestic connection, so every model download would
  have failed — and failed as `AppError::Network`, which reads as "your connection is bad"
  rather than "this was never going to work". The 11 MB engine passed only because it happened
  to fit. `http::build_download_client` now has no total timeout and instead uses
  `read_timeout`, so a genuinely stalled transfer is still caught while a slow one is not.

  Worth noting how this was missed: every unit test used fixtures or tempdirs, and every one of
  them passed. Nothing in the suite could see a timeout that only bites above a certain file
  size. That is the argument for keeping these live tests, ignored but present.

  **It found three more before the path worked.** In order:

  1. The server's stdout and stderr went to `Stdio::null()`, so a server that died left nothing
     but "it did not start" — useless to a user and to whoever is debugging it. Output now goes
     to `engine/llama-server.log`, and the tail is returned in the error.
  2. The readiness check added for (1) used `std::thread::sleep` inside a function called from
     an async command, blocking a runtime worker — the thing ARCHITECTURE.md §8 rules out.
     `start` is async now.
  3. The app reported "Running" as soon as the process existed. `llama-server` binds only
     _after_ loading weights, so for the first few seconds the Model Desk was pointed at an
     endpoint refusing connections. `engine::wait_until_ready` polls the server's own `/health`
     instead of guessing.

  The last was found because the test hit the same trap in mirror image: it health-checked
  through the `https_only` download client, which refuses a plain-HTTP loopback URL, and so
  reported the server dead while the server's own log said `listening`.

- **`docs/PROVIDERS.md` used to describe a news path the code never had.** It claimed Finnhub
  `/news` was used with a fixture fallback; `registry.news()` in fact returned fixtures
  unconditionally, in release builds too. Both the code and the doc are fixed. Worth
  remembering as the failure mode: a doc that was accurate when written and silently stopped
  being true.
- **No live community provider is wired in.** The pipeline is complete and opt-in; only a
  fixture adapter ships, because no discussion platform's terms have been read (ADR-035).
- **Start-to-interactive is still unmeasured.** Everything else in the performance budget now
  has a real number. Closing this needs a `performance.mark` on the first paint of the Pulse
  table, reported through IPC so it reaches the Rust log and can be read from a packaged build.
  `docs/PERFORMANCE.md` §3 explains why launch-to-idle is not a substitute.

### The one promise that changed

"The app makes no request you did not cause" is no longer unconditional. Price alerts poll in the
background, because an alert that only fires while you are looking at the screen is not an alert.
The exception is bounded — off by default, no request without an armed alert, only the named
assets fetched, one firing per crossing — and README, ARCHITECTURE.md and THREAT_MODEL.md all now
say so rather than continuing to state something untrue.

If that trade is ever revisited, the thing to preserve is not the polling but the honesty: an
exception nobody wrote down would be worse than the requests themselves.

### Not verified in the v0.2 features

- **No live Alpha Vantage call has been made.** The adapter is unit tested against recorded response shapes; nobody has held a real key and drawn a real stock chart. The free tier is 25 requests a day, so the first person to try should expect that to bite quickly.
- **The alert poller has never been observed running.** `check_once` is tested directly and thoroughly; the two-minute loop around it has not been watched over a real interval.
- **The portfolio has not been reconciled against a broker statement.** The arithmetic is tested, including eight-decimal crypto quantities and the FIFO/average divergence, but "agrees with a real exchange's own P&L" is a different claim and is not made.

### Smaller gaps

- News is category-matched, not asset-tagged. `news_asset_links.link_kind` exists and is unused. Feeds carry one category each; nothing classifies an individual story, deliberately.
- `set_mock_behavior` is registered in release builds. The mock provider it drives is seeded off there, so it is inert, but gating the command itself would match how the rest of the dev surface is handled.
- Notes render as plain text; a Markdown renderer would add an injection surface.
- Charts are crypto-only (Finnhub candles are premium; its capabilities correctly advertise none).
- No cross-linking from market data into the glossary yet.
- `ts-rs` type generation (ADR-010) is **done**, having been outstanding since Phase 0. 46 types generate into `src/types/generated/`; `domain.ts` is re-exports plus two frontend narrowings. Derives are behind `#[cfg_attr(test, ...)]` so nothing reaches the release binary, and CI diffs the generated output. See ADR-010 for the `i64`/`bigint` trap, which is the part to read before touching it.

- The community panel is not asset-filtered — `CommunityFilter.assetId` is plumbed through and ignored by the fixture adapter.
- AI conversations are excluded from `.brewprofile` in v0.1, as DATA_MODEL.md §6 specifies. Including them would need a separate opt-in.

## 9. Tone

The owner asked for work that is honest about its limits. That has meant, repeatedly:

- Saying "not measured" rather than estimating
- Recording what could **not** be verified (`docs/PROVIDERS.md` has a "Not verified" section, and so does the README)
- Deviating from the brief where following it would mislead — and flagging it, with reasoning, rather than doing it silently
- Fixing the code when a test caught a real bug, and fixing the test when the test was wrong

Keep that. It is the most valuable thing about this codebase, and the easiest to lose.
