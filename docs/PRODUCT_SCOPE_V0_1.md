# Brew Terminal — v0.1 Product Scope

**Positioning:** a local-first, open-source market research and learning terminal.
**Tagline:** Markets, minus the gatekeeping.
**What it is not:** a trading platform, a broker, a portfolio tracker, or a financial adviser.

> **This document describes v0.1. The app is past it.**
>
> Four items in the §3 non-goals list have since shipped, each as a deliberate decision rather
> than by drift:
>
> | Was a v0.1 non-goal                          | Now                                                              |
> | -------------------------------------------- | ---------------------------------------------------------------- |
> | Portfolio accounting, cost basis, P&L        | Shipped — FIFO and average cost, local only, no broker connection |
> | Price alerts                                 | Shipped — local, polled, no notification-driven prompts           |
> | Technical indicators beyond price (`no RSI`) | Shipped — RSI and moving averages in the research chart           |
> | Sentiment classification                     | Shipped — the two Fear & Greed indices, see ADR-037               |
>
> The positioning above is unchanged, and so is everything in §3 that has *not* shipped: no
> order placement, no accounts or telemetry, no buy/sell/hold recommendations, no price targets,
> no scam scores or coin-legitimacy verdicts. What moved was the line on what counts as
> research, not the line on giving advice.
>
> This file is kept as the v0.1 record rather than edited in place, so the original scope stays
> readable next to what was actually built.

---

## 1. Product interpretation

Brew Terminal is a _research and literacy_ tool wearing a terminal's clothes. The terminal
aesthetic buys density and keyboard speed; it does not buy the implication that the user is
about to trade. Three audiences share one surface: a beginner needs the glossary within reach of
the price; a retail researcher needs sources, timestamps and notes; a crypto-native user needs
speed and context. The design answer is one dense workspace with a command palette, where
every number carries its provider and its age, and every explanation is one keystroke away.

The hardest product constraint is honesty. Market apps drift toward implied causality ("BTC up
on ETF news"), implied legitimacy ("trending, 40k mentions") and implied advice ("strong buy").
Brew Terminal structurally refuses all three: news near a move is labelled time-adjacent,
community volume is labelled unverified discussion, and the AI is constrained to explanation.
Those labels are enforced in the data model and the IPC envelope, not left to copywriting.

---

## 2. v0.1 feature list

### Shell

- Tauri 2 desktop app for macOS, Windows, Linux.
- Left navigation rail: Pulse · Research Lab · Learn · Model Desk · Settings.
- Command palette (`⌘K` / `Ctrl+K`): search assets, add to watchlist, navigate to any section, switch theme, open settings.
- Three themes — Dark (default), Light, Soft — with a token layer and `prefers-reduced-motion` support.
- Full keyboard navigation; visible focus rings; skip-to-content.
- Global error boundaries; the shell survives any single panel failing.

### Pulse

- Crypto table: name, ticker, price, 24 h change, 7 d change, market cap, volume, sparkline.
- Stock table: a default set of widely recognised equities (no endorsement implied), region-aware.
- Personal watchlist: add, remove, reorder, rename lists; persisted locally.
- Universal asset search across types.
- News feed with filters: all · crypto · stocks · macro · selected asset.
- Per-panel status: provider attribution, last-updated, loading skeleton, empty, stale, rate-limited, error, not-configured.

### Research Lab

- Asset header: name, symbol, type, price, daily change, last refreshed, provider.
- Price chart with 1D / 1W / 1M / 3M / 1Y / max, limited to the ranges the provider actually supports.
- Key metrics by asset class (crypto: market cap, volume, supply; equity: market cap, volume, day range, 52-week range).
- Profile/description, sourced and attributed where a provider supplies one.
- Related news.
- "What moved this?" — time-adjacent stories, labelled as context, never as cause.
- Local research notes with full-text search.
- Risk checklist for crypto: neutral prompts to verify official links, contract/address data, market availability, team and audit disclosures, impersonation risk. No score, no verdict.
- Community temperature: **off by default**, opt-in, source-linked, timestamped, labelled unverified.

### Learn

- Searchable glossary, offline, ~40 beginner entries at v0.1.
- Five learning paths: Stocks Basics · Crypto Basics · Reading Financial News · Risk and Scams · How Markets Work.
- Local progress tracking.
- "Explain this" entry point into Model Desk that sends only the selected term and shows a privacy notice when the target model is remote.

### Model Desk

- Provider selection: local endpoint or cloud API with the user's own key. Disabled until configured.
- Status line: mode (Local · offline / Cloud · API), model name, connection state, settings shortcut.
- Educational starter prompts.
- Explicit, per-send consent for any context attached from a note, glossary entry or article.
- Guardrail system prompt; advice-shaped prompts get an educational reframing offer.
- History stored locally only, with per-conversation and clear-all deletion.
- Persistent "Educational information only — not financial advice" notice.

### Settings

- Theme, region, refresh interval, reduced motion.
- Data providers: enable/disable, status, docs link, masked credential entry, test connection.
- AI providers: local endpoint config, cloud key, privacy explanation, outbound-send log.
- Cache: size by kind, clear per kind, clear all.
- Encrypted `.brewprofile` export/import.
- Privacy page: plain-language local-vs-cloud explanation.
- About: version, licence, acknowledgements, provider attributions, disclaimer.

---

## 3. Explicit non-goals for v0.1

Not built, and not designed for:

- Brokerage connections, order placement, or any trade execution.
- Portfolio accounting, holdings, cost basis, P&L, or tax reporting.
- User accounts, cloud sync, social features, or telemetry of any kind.
- Buy/sell/hold recommendations, price targets, allocation guidance, or entry/exit timing.
- Price alerts or notification-driven trading prompts.
- An exhaustive global exchange database — regions ship as providers support them.
- Sentiment classification, "scam scores", or coin-legitimacy verdicts.
- Bundled model weights.
- Technical indicators beyond basic price series and factual metrics — no RSI, MACD, or signal overlays.
- Currency conversion (the schema records `display_currency`; conversion arrives later).
- Mobile or responsive-below-desktop layouts.

---

## 4. Provider plan for v0.1

| Slot                          | v0.1 status                                                             | Notes                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Mock market/news/community/AI | **Ships enabled in dev builds**                                         | Fixtures drive every UI state including failures                                                                            |
| Crypto — CoinGecko            | Wire in Phase 2 after terms review                                      | Public/demo tier; attribution required; rate limits recorded in `docs/PROVIDERS.md`                                         |
| Stocks — **Finnhub**          | Adapter written first against Finnhub; requires the user's own free key | Disabled until a key is entered. Terms and current rate limits recorded in `docs/PROVIDERS.md` before the adapter goes live |
| News                          | **Shipped in v0.2**: RSS/Atom adapter, user-configurable feeds          | Free, keyless, permitted. Four defaults, all removable. The fixture news provider was deleted — see `PROVIDERS.md`.         |
| Community                     | Phase 6, opt-in, **disabled by default**                                | Confirmed in scope by the owner. Requires a recorded terms review before it can be enabled at all                           |
| AI                            | Local OpenAI-compatible endpoint + one cloud adapter                    | Both off until configured                                                                                                   |

No scraping. No undocumented endpoints. Any provider that forbids desktop-client use or caching
is not shipped, regardless of technical feasibility.

---

## 5. Acceptance criteria by phase

Each phase is done when every box is checked and CI is green on all three platforms.

### Phase 0 — Architecture and foundation _(this deliverable)_

- [x] `ARCHITECTURE.md`, `PRODUCT_SCOPE_V0_1.md`, `DECISIONS.md`, `DATA_MODEL.md`, `THREAT_MODEL.md`, `UI_MAP.md`, `DEPENDENCIES.md`, `AI_POLICY.md` written.
- [x] Dependency list with per-package justification and licence.
- [x] Schema and migration strategy proposed.
- [x] Threat model covering keys, local data, exports, cloud AI, untrusted provider content.
- [x] Route/navigation map and v0.1 acceptance criteria.
- [x] Owner approval to begin Phase 1.

### Phase 1 — App shell and visual system

- App builds and runs on macOS, Windows, Linux; installers produced by CI.
- Cold start on the reference 2016 Intel MacBook ≤ 2.0 s, measured and recorded in `docs/PERFORMANCE.md`.
- [x] All five routes reachable by mouse and keyboard; focus order sane; skip link works.
- [x] Three themes switch instantly with no flash; choice survives restart; `prefers-reduced-motion` honoured.
- [x] Command palette opens on `⌘K`/`Ctrl+K` with 14 working commands.
- [x] SQLite created and migrated on first run; a downgraded database is refused with a clear message rather than corrupted (tested).
- [x] Mock providers serve every UI state; the dev panel forces loading/empty/stale/rate-limited/error/not-configured, verified in the running app.
- [x] Initial bundle 110.7 KB gzipped, against a 200 KB budget.
- [x] `axe-core` reports no violations on any route; contrast verified numerically at ≥ 4.5:1 body / ≥ 3:1 UI across all three themes (`tests/a11y/contrast.test.ts`).

### Phase 2 — Pulse and watchlists

- Crypto and stock tables render from mock data with correct formatting, sorting and column semantics.
- Watchlist create/add/remove/reorder/rename persists across restart.
- Search returns results in < 100 ms against mock data; keyboard-selectable; reachable from the palette.
- Region setting changes the default stock set.
- Every panel shows provider, last-updated and a correct freshness state; the stale path is covered by a test.
- A 500-row table scrolls at ≥ 50 fps on the reference machine (virtualization verified).
- Quotes are batched — a test asserts that rendering N rows issues one provider call, not N.
- Then, and only then, one crypto provider is wired live behind the adapter, with a recorded terms review.

### Phase 3 — Research Lab and news

- Asset detail reachable from search, tables, watchlist and deep link.
- Chart renders all supported ranges; unsupported ranges are hidden, not broken.
- Every chart has a text alternative: accessible data table plus range/high/low/change summary.
- Notes create/edit/delete/search, persisted, with FTS working.
- "What moved this?" renders only time-adjacent-labelled items with non-causal copy; a test asserts the disclaimer is present.
- Risk checklist renders with no scoring or verdict language; a lint rule bans the banned-phrase list.
- Stale and error states verified for every panel.

### Phase 4 — Learn

- Content schema documented and validated at build time; malformed content fails CI.
- ≥ 40 glossary entries covering the brief's required terms; ≥ 5 paths with ≥ 3 lessons each.
- Glossary search is instant and works fully offline with the network disabled.
- Progress persists; reset works.
- "Explain this" opens Model Desk with only the selected term attached, and shows the cloud warning when the active provider is remote.

### Phase 5 — Model Desk

- [x] Local endpoint and one cloud provider both work end to end. The cloud provider is a
      user-supplied OpenAI-compatible endpoint rather than a named vendor — see ADR-032.
      **Not verified against a live endpoint of either kind** (no model server and no hosted
      account available on the build machine); the request path is covered by unit tests and by
      the browser harness, not by a real round trip.
- [x] Key saved to the OS keychain; never returned unmasked; tests assert no key appears in IPC
      payloads, error payloads or status (`tests/features/modelDesk.test.tsx`,
      `src-tauri/tests/ai_guardrails.rs`). Export coverage lands with `.brewprofile` in Phase 6.
- [x] No request leaves the device without an explicit user action, and the outbound log records
      each one — including connection tests. `bootstrap_configures_nothing_and_sends_nothing`
      asserts startup sends nothing.
- [x] Guardrail prompt applied to every request; a test asserts the shipped prompt is byte-identical
      to AI_POLICY.md §4, and an advice-shaped prompt suite verifies the reframing path.
- [x] History stored locally; per-conversation and clear-all deletion verified.
- [x] Disclaimer visible and non-dismissible, on the desk and beside every model answer.

### Phase 6 — Community and encrypted profile

- [x] Community provider opt-in only; every post shows source, timestamp and an unverified label.
      Both gates — the `communityEnabled` preference and an enabled provider — are enforced in
      Rust, not only in the UI. **Only a fixture provider ships**: no live discussion platform is
      wired in, because no platform's terms have been read (ADR-035). The panel says so.
- [x] `.brewprofile` round-trips: export → import restores watchlists, notes, preferences,
      progress, bookmarks and provider settings, through a real file on disk.
- [x] Wrong password fails cleanly with no partial write; tampered file fails authentication.
      Both produce the same error — telling the user which one it was tells an attacker too.
- [x] Import shows a summary and requires an explicit merge/replace choice; a pre-import backup
      is written, after the file authenticates so a bad password leaves nothing behind.
- [x] Export contains no credential material — asserted by `no_credential_material_is_gathered`
      over the payload and `the_file_on_disk_reveals_nothing` over the written bytes.
      `has_credential` is forced to `false` on import, so a profile cannot claim a key the new
      machine does not have.
- [x] KDF parameters are recorded in the file header and bound as associated data, so weakening
      them invalidates the tag. A file written with non-default parameters still opens
      (`parameters_are_read_from_the_file_not_from_the_defaults`), and a newer `format_ver` is
      refused rather than guessed at.

### Phase 7 — Release readiness

- [x] `README.md` (setup, privacy model, attribution, limitations, disclaimer), `CONTRIBUTING.md`,
      `TRADEMARK.md`, `SECURITY.md`, `LICENSE`, issue/PR templates. The README carries a
      "What has not been verified" section, because a status page listing only successes is not
      a status page.
- [~] CI: fmt, clippy, eslint, tsc strict, Rust tests, frontend tests, bundle-size budget,
  dependency audits and an app build on all three platforms. **The workflow covers all of it
  and has still never executed** — a git repository now exists with one commit on `main`, but
  there is no remote, so Windows and Linux remain unproven. This is the one criterion that
  cannot be closed from this machine.
- [x] Accessibility audit recorded: `axe-core` reports no violations on any route or panel,
      including the Model Desk in use, the community panel switched on, and the hosted-AI
      settings form. Contrast verified numerically across all three themes.
- [x] Performance budget filled with **measured** numbers from a packaged release build — see
      `docs/PERFORMANCE.md` §3. Installer 5.0 MB against 15 MB; idle RSS 115.5 MB against
      300 MB; idle CPU 0.0 % against 1 %. Two cells stay blank: start-to-interactive needs a
      first-paint mark that does not exist, and §3 says so rather than reporting launch-to-idle
      in its place.
- [x] No banned-phrase violations, enforced by a lint rule and two sweeps. Disclaimer present on
      every surface showing prices, news, community content or AI output — asserted in
      `tests/a11y/routes.a11y.test.tsx` → `disclaimer coverage`, which is what caught its
      absence from the community panel.

---

## 6. Standing safety rules (apply to every phase)

- No number renders without its provider and its age.
- No causal claim about price movement. Ever.
- Community content is optional, attributed, timestamped and labelled unverified.
- Banned vocabulary, enforced by a lint rule over user-facing strings: _scam score, fake coin detector, guaranteed, signal, best trade, strong buy, price target, moon, safe investment, risk-free_.
- The disclaimer "Educational information only — not financial advice" appears in Model Desk, on AI output, on the community panel, in About, and on first run.
- Nothing leaves the device without an explicit user action.
