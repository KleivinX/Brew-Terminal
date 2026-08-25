# Brew Terminal — session handoff

**Written for a fresh Claude Code session picking this project up mid-build.** Read this first;
it is the fastest path to being useful without re-deriving decisions that are already made.

_Last updated: end of Phase 4 plus logo integration, 2026-08-23._

---

## 1. What this is, in one paragraph

Brew Terminal is a local-first, open-source desktop app (Tauri 2 + Rust + React/TS) for market
research and financial literacy. It is **not** a trading platform, a portfolio tracker, or an
adviser, and refusing to become one is a design constraint rather than a missing feature. The
owner supplied a detailed brief (`~/Desktop/brew-terminal-claude-megaprompt.md`) specifying a
seven-phase build. Phases 0–4 are done. **Phase 5 (Model Desk) is next.**

Reference hardware is a 2016 Intel MacBook — which is also the development machine, so every
performance number in the docs was measured on the target.

## 2. Where things stand

| Phase | Scope                                                        | State    |
| ----- | ------------------------------------------------------------ | -------- |
| 0     | Architecture, scope, threat model, data model                | Done     |
| 1     | App shell, 3 themes, command palette, SQLite, mock providers | Done     |
| 2     | Pulse, watchlists, live providers, OS keychain               | Done     |
| 3     | Research Lab, charts, notes, risk checklist                  | Done     |
| 4     | Learn — 50-term glossary, 5 paths, 17 lessons                | Done     |
| 5     | **Model Desk — local and cloud AI**                          | **Next** |
| 6     | Community temperature, encrypted `.brewprofile` export       | Planned  |
| 7     | Release readiness                                            | Planned  |

**434 tests passing** — 236 frontend (vitest), 198 Rust. Clippy clean at `-D warnings`, both
formatters clean, app binary links, initial bundle 97.3 KB gzipped against a 200 KB budget.

## 3. Read these, in this order

Everything important is documented in the repo. Do not re-derive it.

1. `docs/PRODUCT_SCOPE_V0_1.md` — features, **non-goals**, per-phase acceptance criteria with checkboxes showing what is done
2. `docs/DECISIONS.md` — **28 ADRs**. The highest-value file in the repo; each records what was chosen, what was rejected, and why
3. `docs/ARCHITECTURE.md` — process model, IPC, service layer, provider routing, caching, performance budget
4. `docs/PROVIDERS.md` — verified terms, rate limits and API quirks for every provider
5. `docs/THREAT_MODEL.md` — what is protected, what explicitly is not
6. `docs/AI_POLICY.md` — **read before touching Phase 5.** Contains the guardrail system prompt
7. `docs/DATA_MODEL.md`, `docs/UI_MAP.md`, `docs/DEPENDENCIES.md`, `docs/PERFORMANCE.md`

## 4. The safety stance — the thing most easily eroded

This is what makes the product what it is, and it is the easiest thing to accidentally undo.
Every one of these is enforced by a test, a lint rule, or the type system.

- **No number renders without its provider and its age.** The IPC `Envelope<T>` carries `providerId`, `providerName`, `fetchedAt`, `source`, `stale` and `degraded`. The frontend cannot obtain data without provenance.
- **No causal claims about price moves.** The brief asked for a "What moved this?" panel; it is titled **"Published around this time"** and its body says explicitly that adjacency in time is not causation (ADR-021).
- **No verdicts.** The crypto risk checklist has no checkboxes and no score — anything that adds up is a legitimacy judgement (ADR-022).
- **No advice-shaped language.** A custom ESLint rule (`eslint-rules/local.js`) bans a phrase list in source; `tests/safety/copy.test.ts` sweeps source and fixtures; the Learn content validator sweeps the content bundle.
- **Fixtures are never the default in a release.** The mock provider is seeded enabled only under `debug_assertions` (ADR-018).
- **API keys never travel outward over IPC.** They go into the OS keychain; the IPC surface returns a boolean and a masked hint. Asserted by tests at both layers.
- **Nothing leaves the device without an explicit user action.**

If a change would weaken any of these, that is a conversation with the owner, not a refactor.

## 5. Hard-won facts you would otherwise rediscover the slow way

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
- **Test timeout is 15s, not the 5s default** — the longer interaction flows time out on a loaded dual-core machine. Verified stable while a Rust build runs concurrently.

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
     ├ mock/               fixtures, debug builds only
     ├ governor.rs         rate limits, backoff — pure logic, fully tested
     └ http.rs             HTTPS-only, 15s timeout, 2MB cap, URL redaction
   db/         rusqlite bundled, WAL, forward-only migrations
   security/   keychain + log redaction
```

**Key invariant:** all network I/O is in Rust. The webview's CSP sets `connect-src` to IPC only,
and an ESLint rule bans `fetch`. This is what keeps API keys out of the process that renders
untrusted provider strings (ADR-002).

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
actually look at it. Four real bugs this session were found by looking, not by tests — collapsed
panels, stale chart theming, clipped table columns, and a palette that navigated to Microsoft
when asked for the Soft theme.

**Conventions:** feature slices may not import each other (enforced by lint — shared code moves
into `lib/` or `components/`). Optional props need `| undefined` (`exactOptionalPropertyTypes`).
Components reference semantic CSS tokens, never raw hex. Direction is never colour alone.

## 8. Outstanding — carry these forward

### Blocking-ish, needs the owner

- **Bundle identifier** — assumed `com.brewterminal.app` in `tauri.conf.json`.
- **Copyright holder** — `TRADEMARK.md` has a literal `[COPYRIGHT HOLDER]` placeholder.

### Measurement debt (outstanding since Phase 1)

**Cold start, warm start, idle memory, idle CPU, installer size, and scroll frame rate are all
unmeasured.** `docs/PERFORMANCE.md` §3 deliberately leaves them blank with the method rather
than plausible-looking numbers. They need a packaged release build (`npm run tauri:build`),
which is slow on this machine and belongs in a dedicated pass.

### Never run

**CI has never executed** — there is no git repository and no remote. Windows and Linux are in
the matrix but unproven. `git init` has not been run.

### Smaller gaps

- News is category-matched, not asset-tagged. `news_asset_links.link_kind` exists and is unused.
- Notes render as plain text; a Markdown renderer would add an injection surface.
- Charts are crypto-only (Finnhub candles are premium; its capabilities correctly advertise none).
- No cross-linking from market data into the glossary yet.
- Logo artwork is in and the icon set is generated, but the highest-resolution copy of the
  mark in the supplied sheet is 485 px, so the 1024 px icon source is a ~2.1x upscale. A
  larger export would sharpen it; `src-tauri/icons/README.md` records the method.
- `ts-rs` type generation (ADR-010) is committed to but not wired up; `src/types/domain.ts` is currently hand-maintained and says so.

## 9. Phase 5 — start here

Acceptance criteria are in `docs/PRODUCT_SCOPE_V0_1.md` §5. **Read `docs/AI_POLICY.md` first** —
it contains the guardrail system prompt and the privacy boundary, both already written.

**Recommended first slice: the local model path only.** An OpenAI-compatible endpoint on
loopback, the system prompt applied, and `ai_outbound_log` recording every send. Local-first is
the honest starting point — no credential, nothing leaves the machine, and it exercises the
whole chain (provider config → system prompt → pre-send consent → outbound log). Cloud providers
then reuse that path with a key and a stronger warning, rather than being built alongside it.

Already in place for this:

- `ai_conversations`, `ai_messages`, `ai_outbound_log` tables (migration `0001_init.sql`)
- `content/ai/system-prompt.md` — **does not exist yet.** `content/ai/` is an empty directory. The prompt text is already written in `docs/AI_POLICY.md` §4; extract it to that file so the Rust side can `include_str!` it and a test can assert it is applied unmodified to every request.
- `ExplainWithModel` in `src/features/learn/` — the consent-dialog pattern to reuse (ADR-028)
- `ModelDeskRoute` — currently the correct not-configured state
- `secrets.rs` — keychain storage, already used by Finnhub

**The label rule:** "Local · offline" may only be shown when the configured host resolves to a
loopback address. Anything else reads "Local endpoint · network".

## 10. Tone

The owner asked for work that is honest about its limits. That has meant, repeatedly:

- Saying "not measured" rather than estimating
- Recording what could **not** be verified (`docs/PROVIDERS.md` has a "Not verified" section)
- Deviating from the brief where following it would mislead — and flagging it, with reasoning, rather than doing it silently
- Fixing the code when a test caught a real bug, and fixing the test when the test was wrong

Keep that. It is the most valuable thing about this codebase, and the easiest to lose.
