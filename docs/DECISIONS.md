# Brew Terminal — Architecture Decision Record

Format: one decision per section, with the alternatives that were actually considered and why
they lost. Status values: `accepted`, `provisional` (needs owner confirmation), `superseded`.

---

## ADR-001 — Tauri 2 over Electron

**Status:** accepted (mandated by brief, and the reasoning holds).

Tauri uses the OS webview (WKWebView / WebView2 / WebKitGTK) instead of shipping Chromium.
On the reference 2016 Intel MacBook this is the difference between a ~10 MB installer with one
extra native process and a ~150 MB installer running a full browser engine plus renderer,
GPU and utility processes. Idle memory is roughly a quarter of the Electron equivalent.

**Cost accepted:** three webview engines means three rendering targets. WebKitGTK on Linux is
the weakest — expect CSS feature gaps. Mitigation: stick to well-supported CSS (grid, flexbox,
custom properties, `color-mix` with a fallback), and test on Linux in CI.

**Alternatives:** Electron (rejected: memory and size on the reference hardware). Wails
(rejected: Go backend, and the crypto/keychain story in Rust is better served). A pure web app
(rejected: no OS keychain, no local-first file access, no offline install).

---

## ADR-002 — All network I/O in Rust; webview has no network access

**Status:** accepted.

The webview CSP sets `connect-src` to IPC only. Every outbound request originates in the Rust
process.

**Why:** API keys never cross into JavaScript, so a rendering XSS cannot exfiltrate them; CORS
is a non-issue; rate limiting, caching, dedup and cancellation live in exactly one place.

**Cost accepted:** more Rust code, and a Tauri command must exist before the frontend can reach
any new data source. That friction is a feature — it keeps the IPC surface auditable.

**Alternative:** fetch from the webview with keys passed over IPC (rejected: puts credentials in
the process most likely to render untrusted third-party strings). Tauri's HTTP plugin with a
URL allowlist (rejected: still puts the key in JS, and scopes are coarse).

---

## ADR-003 — SQLite via `rusqlite` (bundled), no SQL from the frontend

**Status:** accepted.

**Why bundled:** identical SQLite version and compile flags on all three platforms; no
dependency on whatever the host ships. Adds roughly 1 MB to the binary — well inside budget.

**Why not `tauri-plugin-sql`:** it exposes a query interface to the frontend. That means the
webview can execute arbitrary SQL, which widens the blast radius of any frontend compromise and
scatters schema knowledge across two languages. Typed commands keep the schema behind the
trust boundary.

**Alternatives:** `sqlx` (rejected: async SQLite offers little here since the workload is small
local queries, and compile-time query checking needs a live DB in CI — friction without payoff).
JSON files (rejected: no transactions, no indexes, poor concurrent-write behaviour).

---

## ADR-004 — CSS Modules + CSS custom-property tokens, not Tailwind

**Status:** accepted.

Three themes (Dark, Light, Soft) is the deciding factor. With tokens, a theme is a block of
custom-property overrides selected by `[data-theme]`; components never learn a theme exists.
The Tailwind equivalent for three themes is either `dark:`-style variants duplicated across
every component, or Tailwind configured to read CSS variables — which is this design with an
extra build step on top.

Secondary: no PostCSS/JIT watcher during development, which is noticeably lighter on a
dual-core machine; zero runtime cost; CSS output bounded by declared styles.

**Cost accepted:** more hand-written CSS, slower for contributors fluent in Tailwind. Mitigated
by a documented token set and a shared primitives layer.

**Alternatives:** Tailwind (above). CSS-in-JS — emotion/styled-components (rejected: runtime
cost per mount, and serialized styles inflate the JS bundle we are trying to keep at 200 KB).
Vanilla-extract (rejected: good model, but adds a build plugin for benefits tokens already give).

---

## ADR-005 — TanStack Query for client data state

**Status:** accepted.

Provides deduplication, stale-while-revalidate, focus-aware refetch control, cancellation and
request-state modelling — all directly required by the brief's freshness rules. Roughly 13 KB
gzipped.

Configured conservatively for the reference hardware: `refetchOnWindowFocus` off by default
(the Rust governor decides refresh), `retry: 1`, `staleTime` set per data class to match the
Rust TTLs, `structuralSharing` on to avoid needless re-renders.

**Note on layering:** TanStack Query is the _memory_ tier only. Durable caching is SQLite. The
persisted-query-client plugin is deliberately not used — two competing durable caches would be
a bug factory.

**Alternatives:** SWR (rejected: thinner cancellation and mutation story). Hand-rolled hooks
(rejected: this is exactly the wheel not worth reinventing). RTK Query (rejected: pulls in Redux
Toolkit for a surface we do not otherwise need).

---

## ADR-006 — `lightweight-charts` for asset charts; hand-written SVG for sparklines

**Status:** accepted.

`lightweight-charts` (TradingView, Apache-2.0) is canvas-based, ~48 KB gzipped, and purpose-built
for financial time series — time axis, crosshair, and price scaling come for free. It is imported
**only** inside the lazily-loaded Research Lab chunk, so the dashboard never pays for it.

Sparklines in tables are a single hand-written `<path>` over ≤ 24 downsampled points. Twenty
visible rows means about twenty DOM nodes, which satisfies the brief's "no hundreds of SVG
elements on the dashboard" constraint without a second charting dependency.

**Accessibility cost accepted:** canvas is opaque to screen readers. Every chart ships with a
sibling `<table>` of the underlying series (visually hidden, toggleable to visible), plus a text
summary of range, high, low and change. Sparklines get `role="img"` and a descriptive label.

**Alternatives:** Recharts (rejected: SVG-per-point, ~100 KB+, poor on old hardware at high point
counts). uPlot (strong contender — smaller and faster, but the finance-specific axis/crosshair
work would be hand-built; revisit if `lightweight-charts` disappoints on the reference machine).
Chart.js (rejected: heavier, general-purpose).

---

## ADR-007 — Argon2id + XChaCha20-Poly1305 for `.brewprofile`

**Status:** provisional — parameters need a confirmation pass before Phase 6.

Composed from audited RustCrypto primitives; no custom cryptography. Argon2id is the
memory-hard KDF the brief asks for, and XChaCha20-Poly1305's 192-bit nonce makes random nonce
generation safe without a counter. Construction, parameters and open questions: `THREAT_MODEL.md` §6.

**Alternatives:** the `age` crate (genuinely good — audited format, versioned; rejected because
passphrase mode uses scrypt where Argon2id is the more current memory-hard choice, and we would
still hand-roll the metadata envelope). AES-256-GCM (rejected: 96-bit nonce demands counter
management, and constant-time performance without AES-NI is worse — relevant on 2016 hardware,
though that vintage does have AES-NI). PBKDF2 (rejected: not memory-hard).

---

## ADR-008 — Mock providers first; live integrations gated on a terms review

**Status:** accepted.

Every provider interface ships with a mock implementation backed by fixtures, able to simulate
latency, rate limits, partial failures and empty results. The full UI — including every error
state — is buildable and testable offline.

Live providers are added one at a time, and only after their terms of use are read and recorded
in `docs/PROVIDERS.md` (attribution required, rate limits, whether desktop-app use is permitted,
whether caching is allowed). No scraping, and no undocumented/unofficial endpoints, even where
they are technically reachable — that is a deliberate choice about the project's standing, not
a technical limitation.

---

## ADR-009 — React Router (hash history) with route-level code splitting

**Status:** accepted.

Hash history avoids custom-protocol path-resolution differences across the three webviews.
Routes give deep links (`#/research/crypto/bitcoin`), which the command palette, watchlist rows
and news items all navigate through. Route-level `React.lazy` boundaries are the main lever for
the 200 KB initial-bundle budget.

**Alternatives:** wouter (~2 KB, tempting; rejected: no lazy-route data APIs, and the size
difference is ~18 KB gzipped against a 200 KB budget). A hand-rolled switch on Zustand state
(rejected: loses deep links and history, which the palette depends on).

---

## ADR-010 — `ts-rs` to generate TypeScript types from Rust models

**Status:** accepted.

Rust models are the source of truth; `ts-rs` emits `.d.ts`-style declarations into
`src/types/generated/`, and CI fails if the committed output differs from a fresh run. Compile-
time only, no runtime dependency, no schema server.

**Alternatives:** hand-maintained duplicate types (rejected: guaranteed drift). `specta`/`tauri-specta`
(strong contender with typed `invoke` wrappers; revisit — `ts-rs` chosen for a smaller, more
stable surface, with a hand-written thin `ipc.ts` providing the typed call layer).

**Wired up in v0.2**, having been outstanding since Phase 0. 46 types export from
`src-tauri/src/models/` and the service-level payloads; `domain.ts` is now re-exports plus two
frontend narrowings. The derives sit behind `#[cfg_attr(test, ...)]`, so `ts-rs` is a
dev-dependency and never reaches the release binary. Export happens during `cargo test`, and CI
runs `git diff --exit-code -- src/types/generated` afterwards, so a Rust model that changes
without its TypeScript being regenerated fails the build.

**One thing to know before touching it: `ts-rs` maps `i64` to `bigint`.** That is wrong for this
transport — `serde_json` writes an `i64` as a JSON number and Tauri hands the frontend a
`number`. Every integer field therefore carries an explicit
`#[cfg_attr(test, ts(type = "number"))]`, and `Option<i64>` needs `"number | null"` because the
override replaces the whole field type including the `Option`. Adopting the generated output
without those annotations would have produced a file that was confidently wrong — worse than
the hand-written one it replaced, which at least said it was hand-written.

Turning it on immediately caught real drift: `Preferences.theme`, `reducedMotion` and `aiMode`
were typed as narrow unions in TypeScript while Rust sent `String`. Rust does enforce the closed
set — `validate_preference` checks every write against `VALID_THEMES` and friends — so the fix
was to state that invariant at the type boundary rather than let it be lost as `string`. That
mismatch had been sitting in the codebase unnoticed, which is precisely the argument for this
ADR.

---

## ADR-011 — Zustand for ephemeral UI state

**Status:** accepted.

~1 KB, no provider tree, no boilerplate. Scope is strictly ephemeral: palette visibility, table
sort, selected filters, dev-only mock controls. Anything durable goes to SQLite; anything
provider-sourced goes to TanStack Query.

**Alternatives:** Context + `useReducer` (rejected: re-render breadth on a shell this size).
Redux Toolkit (rejected: weight and ceremony far beyond the need). Jotai (fine, but Zustand's
store model fits a small number of app-wide concerns better than many atoms).

---

## ADR-012 — AGPL-3.0 for code, with the name and logo held separately

**Status:** provisional — the brief flags a final legal review, and this project does not provide
legal advice.

AGPL-3.0 is prepared as the community code licence. Trademark and brand assets are handled by a
separate `TRADEMARK.md` stating that forks must adopt a distinct name, must not use the Brew
Terminal logo, and must not present themselves as official.

The repository is structured so a CLA and a dual-licensing arrangement can be added later
(`CONTRIBUTING.md` reserves the section, contributions are tracked with sign-off from day one).
No CLA text is invented here.

---

## ADR-013 — Finnhub as the first live stock adapter

**Status:** accepted (owner decision, 2026-08-22).

Finnhub is written first among equity providers, against a key the user supplies. It stays
disabled until a key is entered, and it is not wired live until its current terms and rate
limits are read and recorded in `docs/PROVIDERS.md` — attribution requirements, whether desktop
clients are permitted, whether caching is permitted.

**Why it won:** of the mainstream keyed free tiers, Finnhub's request budget is the one that
makes a live-refreshing watchlist plausible at all. Alpha Vantage's free daily budget is small
enough that a 25-row table refreshing on any sane interval would exhaust it, which would force
the UI into a permanent rate-limited state — a bad first impression that is a provider artifact,
not a product decision.

**Not decided here:** whether Finnhub remains the default. The adapter layer exists precisely so
this is a swap, not a rewrite. An Alpha Vantage adapter can follow behind the same trait.

---

## ADR-014 — TypeScript 5.9.3, not 7.x

**Status:** accepted.

TypeScript 7.0.2 is current, but `typescript-eslint@8.67.0` declares
`typescript: ">=4.8.4 <6.1.0"`. Adopting TS 7 today means giving up type-aware linting — which
is where the custom rules (no cross-feature imports, no `dangerouslySetInnerHTML`, banned
user-facing phrases) actually live. Those rules are load-bearing for the project's safety
guarantees, so the linter wins.

**Revisit when:** typescript-eslint ships a release whose peer range admits 7.x. The migration
is expected to be a version bump, since TS 7 targets compatibility with the 5.x language surface.

---

## ADR-015 — Vite 8 on the reference hardware

**Status:** provisional — kept only if it builds and starts fast on the real 2016 Intel machine.

Vite 8 is used at scaffold time and verified by an actual build on the reference MacBook rather
than assumed. If the rolldown-based pipeline misbehaves on darwin-x64 or regresses dev-server
startup, the fallback is Vite 7.3.6 with `@vitejs/plugin-react` 5.2.0 — a pairing that is
known-good and still within the brief. The decision is recorded as provisional so the fallback
is a documented step rather than a surprise.

---

## ADR-016 — A service layer between commands and providers

**Status:** accepted.

`#[tauri::command]` handlers are thin wrappers that unwrap `tauri::State` and delegate to a
function in `src-tauri/src/services/` taking `&AppState`.

**Why:** command bodies were only reachable from a running Tauri app, which meant the most
important behaviour in the codebase — provider → validate → cache → SQLite → envelope — had no
integration coverage. With the logic in a service function, `tests/app_flow.rs` exercises the
real path against a real database file, and "the watchlist survives a restart" becomes a test
rather than a claim.

The chain was already documented in ARCHITECTURE.md §7 as _command → service → adapter_; this
made the code match the documentation.

**Cost accepted:** one extra indirection per command, and two files to touch when adding one.

---

## ADR-017 — Providers are routed by asset type, and results are merged

**Status:** accepted.

No single provider covers both crypto and equities, so the registry resolves a provider _per
asset type_, and the canonical id (`crypto:cg:…`, `stock:us:…`) is what routes a request. A
watchlist mixing both is split by owner, fetched per provider, and merged.

**Consequences worth stating:**

- **Attribution has to survive the merge.** The merged envelope lists every contributor — "CoinGecko · Finnhub" — because both providers are owed credit and the app's own rule is that no number renders without its provider.
- **Freshness is the stalest contributor.** A panel is only as current as its oldest part; claiming otherwise would overstate the data.
- **One mock contributor marks the whole panel as mock.** Otherwise half-fixture data could present itself as live.
- **An asset with no configured provider is reported, not silently dropped.** A row vanishing with no explanation is the failure mode this avoids.

**Alternative:** a single "best" provider per request with fallback (rejected: it hides which
provider actually answered, and the attribution obligation makes that unacceptable).

---

## ADR-018 — Fixtures are never the default in a release build

**Status:** accepted.

The mock provider is seeded enabled only under `cfg!(debug_assertions)`. In a release build,
an unconfigured app shows "no provider set up yet" with a route into Settings — it does not
fall back to fixtures.

**Why:** a fallback to plausible-looking fake prices is the single most dishonest thing this
app could do. The freshness envelope would still mark it `source: mock`, but relying on a badge
to undo a wrong default is the wrong way round.

---

## ADR-019 — Finnhub credentials travel in a header, not the query string

**Status:** accepted.

Finnhub accepts its key either as a `token` query parameter or an `X-Finnhub-Token` header.
The adapter uses the header.

**Why:** a key in a query string ends up in request logs, proxy logs, browser histories and any
error string that echoes a URL. The header keeps it out of all of them. The log redaction layer
still strips `token=` as a second line of defence, but defence in depth is not a reason to pick
the weaker option first.

---

## ADR-020 — Network tests exist, and are ignored by default

**Status:** accepted.

`src-tauri/tests/live_network.rs` makes real calls to CoinGecko and is marked `#[ignore]`.

**Why both halves matter:** adapters written against a guessed response shape are the classic
source of "works in tests, fails in production", so a real call has to be part of the workflow —
run with `cargo test --test live_network -- --ignored`. But a provider outage is not a reason
for CI to go red, and a test suite should not spend a user's rate-limit budget on every push.
Unit tests run against responses recorded from those same live calls.

---

## ADR-021 — The "What moved this?" panel does not answer that question

**Status:** accepted. This is a deliberate deviation from the brief's wording.

The brief asks for a _"What moved this?"_ section presenting time-adjacent news as context.
The section exists, in that position, and the panel is titled **"Published around this time"**.

**Why the rename:** the question as posed presupposes an answer the app cannot have. Putting
headlines under a heading that asks what moved a price implies the headlines are the answer —
which is the causal claim the whole design is built to avoid, restated as a title. The project's
own copy rule already forbids exactly this construction: _"Published around this move", not
"Why BTC dropped"_ (UI_MAP.md §8).

So the panel keeps the brief's intent — surfacing time-adjacent context — and states plainly in
its body that these stories are _not_ an explanation, that the app has no way to establish one,
and that two things happening near each other in time is not one causing the other. A test
asserts that copy is present, and another asserts no heading uses causal phrasing.

**Alternative considered:** keep the brief's title and rely on a disclaimer underneath
(rejected: a heading is read first and remembered longest, and a disclaimer that contradicts
the heading above it is the weakest possible placement).

---

## ADR-022 — The risk checklist has no checkboxes and no score

**Status:** accepted.

The crypto risk checklist renders as prompts with explanations. There is no checkbox, no tally,
and no conclusion.

**Why:** anything that adds up is a verdict. A count of ticks is a legitimacy score wearing
different clothes, and "6 of 7 checks passed" is precisely the judgement PRODUCT_SCOPE_V0_1.md
§3 rules out. The content closes by saying there is no score because there is nothing honest to
score.

The content lives in `content/learn/risk-checklist.json` rather than in the component, so it
can be reviewed as prose by someone who does not read TSX.

---

## ADR-023 — The browser harness is a dynamic import

**Status:** accepted.

`src/lib/ipc.browser.ts` is imported with `await import()` rather than statically.

**Why:** it statically imports every development fixture, and `chart_series.json` alone is
30 KB gzipped. A static import put ~35 KB of fixtures into the entry chunk of the shipped
desktop app, which never runs the harness at all. It had been leaking since Phase 1 and only
became noticeable when the chart fixture made it big.

The general lesson, worth applying elsewhere: **a dev-only module reachable through a static
import is not dev-only in the bundle.**

---

## ADR-024 — `Panel` fills its parent only when asked

**Status:** accepted.

`Panel` takes a `fill` prop. Without it the body sizes to its content.

**Why:** Phase 1 gave the body `flex: 1` so the Pulse market table would fill its viewport.
That is right for a panel that owns the screen and wrong for every panel in a scrolling column —
in Research Lab it squashed all five panels to nothing. Making it opt-in fixes the second case
without regressing the first.

---

## ADR-025 — Charts rebuild on a theme change

**Status:** accepted.

`AssetChart` depends on the active theme, so switching themes tears the chart down and rebuilds
it.

**Why:** `lightweight-charts` paints axis labels and grid lines into a canvas using colours read
at creation time. Without the dependency, switching to Light left dark-theme charcoal grid lines
on a white background — verified in the browser before the fix.

**Cost accepted:** a rebuild rather than an `applyOptions` diff. Theme switching is rare, and
mirroring every colour through `applyOptions` would be a second copy of the styling to keep in
step with the token layer.

---

## ADR-026 — Learn content is JSON validated by a schema, not TSX

**Status:** accepted.

Glossary entries and lessons live in `content/learn/*.json` and are validated by a Zod schema in
`src/features/learn/contentSchema.ts`. Everything is plain text — no HTML, no Markdown.

**Why JSON rather than components:** the content is the product here, and it should be
reviewable by someone who does not read TSX. Prose embedded in components also invites markup,
and markup in educational copy is an injection surface for no benefit.

**Why validated three times** — in CI, in the test suite, and again at module load:

- A cross-reference to a glossary term that does not exist is invisible until someone clicks it. Validation catches it at authoring time.
- `npm run build` runs the content test first, so malformed content fails the build, which is the Phase 4 acceptance criterion.
- The load-time check means a bundle that somehow got past both fails loudly rather than rendering blank pages.

The validator returns every problem rather than throwing on the first, so an author fixing
content sees the whole list in one pass.

**What it checks beyond shape:** unique ids, that every `seeAlso` and `keyTerms` reference
resolves, that no entry is a dead end with no onward links, and that no string in the bundle
contains advice-shaped language. That last one matters most: educational copy is exactly where
explaining slides into recommending.

---

## ADR-027 — Glossary search runs in memory, with no index

**Status:** accepted.

`searchGlossary` is a linear pass over ~50 entries per keystroke, matching term, aliases and
the one-line definition through the same fuzzy matcher the command palette uses.

**Why no index:** fifty entries is nothing. An index would be machinery whose maintenance cost
exceeds the work it saves, and it would need invalidating whenever content changed. Notes use
SQLite FTS5 because notes are user-generated and unbounded; the glossary is neither.

**Consequence worth naming:** because the content is a module import rather than a fetch,
Learn works with the network switched off — including search. A test asserts `fetch` is never
called while loading the bundle.

---

## ADR-028 — "Explain this" is a consent dialog, not a button

**Status:** accepted.

The glossary's "Explain this" control opens a dialog showing the exact text that would be sent
to a model, with a character count, and a Cancel. It does not send anything.

**Why:** AI_POLICY.md §2 requires that nothing leaves the device without a direct action and
that what would be transmitted is shown first — itemised, not summarised. A button that fires a
request the moment it is pressed satisfies neither.

With no model configured the dialog says so plainly and offers to set one up, rather than being
disabled or silently doing nothing. It also states the difference that actually matters: a
cloud provider receives the text under their terms; a model on loopback sends nothing at all.

## ADR-029 — The AI adapter has its own HTTP client, and plain HTTP is confined to loopback

**Status:** accepted.

`providers::http` builds a client with `https_only(true)`, and every market request goes through
it. The Model Desk does not: `providers::ai` builds its own client and permits plain HTTP **only
when the endpoint's host resolves to a loopback address**. Anything that leaves the machine —
local-but-networked, or cloud — must still be HTTPS, and a cloud endpoint gets no loopback
exemption at all (`check_cloud_scheme`).

**Why:** every local model server people actually run — Ollama, llama.cpp's server, LM Studio —
serves plain HTTP on `127.0.0.1` and none of them ship a certificate. Keeping `https_only` on
would have meant the local-first path, which is the one that sends nothing anywhere, was the
only one that did not work.

**Rejected:** relaxing `https_only` on the shared client. That would have quietly weakened every
market request to buy one feature. **Also rejected:** allowing plaintext to a LAN address. A
prompt crossing a network in the clear is the thing THREAT_MODEL.md §3 exists to prevent, and
someone running a model on another machine can put TLS in front of it.

**Stated limit:** the host is resolved once to classify it and again by the HTTP client when the
request goes out. A resolver that answers differently between the two would defeat the check.
This is not defended against, and the module doc says so rather than implying a guarantee.

## ADR-030 — The pre-send count is computed in Rust, by the same code that sends

**Status:** accepted.

`preview_ai_send` returns the character counts the consent panel displays. It calls
`assemble_messages` — the same function `send_ai_message` calls — rather than the frontend
counting what it thinks will be sent.

**Why:** AI_POLICY.md §2.2 promises the user sees what will be transmitted. A frontend estimate
is a second implementation of the assembly rules, and the moment either side changes — a history
cap, a context truncation, a delimiter — the number shown stops describing the bytes that leave.
A promise that decays silently is worse than no promise.

**Consequence:** truncation of oversized context happens inside `assemble_messages`, so the
panel shows the truncated count rather than the original. The two cannot disagree.

## ADR-031 — The outbound log records attempts, not deliveries

**Status:** accepted.

`ai_outbound_log` is written **before** the HTTP request is issued, after every check that could
refuse the send. A request that never connects still leaves a row.

**Why:** the log's job is to answer "what left this computer". Writing it after a successful
response would omit exactly the case that matters most — a request that went out and whose
response was lost — while writing it before only over-reports a connection that failed. For a
transparency record, over-reporting is the safe direction, and the Privacy page says which one
it is rather than implying every row is a delivery.

The log is also deliberately not deleted when a conversation is. Tidying a transcript and
erasing the record that data left are different acts, and the Privacy page clears the log
separately.

## ADR-032 — Both AI providers are stored; a preference selects which is active

**Status:** accepted.

`provider_config` holds two rows — `local-openai` and `cloud-openai` — and the `aiMode`
preference decides which one the desk uses. Switching modes does not discard the other's
endpoint or model.

**Why:** the alternative, one row with a mode field, made switching destructive: try the hosted
model once and the local endpoint you had configured is gone. Two rows cost one preference key.

The cloud provider is deliberately **generic** — a user-supplied OpenAI-compatible base URL —
rather than a named vendor. `PROVIDERS.md` only records terms that were actually read, and the
app has no way to verify how any hosted provider handles a prompt. Putting a vendor's name on
the settings page would imply a claim the project cannot support.

## ADR-033 — The `.brewprofile` is written and read in Rust, never in the webview

**Status:** accepted.

`export_profile` takes a path and a password and writes the file itself. `import_profile` reads
it. The frontend never receives the payload, the plaintext or the file bytes — only a summary of
counts, and a result.

**Why:** the decrypted payload is the user's entire profile — every note, every list, every
setting. Handing that to the webview would put it in the same process that renders untrusted
provider strings and model output, which is precisely what ADR-002 keeps API keys out of. The
password gets the same treatment: it crosses IPC once, inward, and is held in a `Zeroizing`
buffer that is wiped on drop.

**Stated limit:** the buffer Tauri deserialised the IPC argument into is outside this app's
control and is not zeroized. What can be wiped, is; the doc comment says so rather than implying
the password is scrubbed everywhere.

## ADR-034 — Authenticate, validate, back up, then write — in that order

**Status:** accepted.

Import runs: read and authenticate → parse and validate → back up the database → apply in one
transaction. Authentication and validation both precede the backup.

**Why:** ordering it this way means a wrong password or a corrupt file costs the user nothing at
all — not even a stray backup file. It also means a crafted payload cannot reach the parser
before the AEAD tag has proved the file came from someone with the password, and cannot reach
the database before its contents have been checked against the same rules a live write obeys.

A valid tag proves provenance, not sanity, so `repo_profile::validate` re-checks asset types,
progress states, bookmark kinds, provider kinds and base URLs, and preference writes go through
`validate_preference` — a profile is not a way around the rules that apply in the app.

**Consequence:** the WAL is checkpointed before the backup copy. Without that, the copy can be
missing everything written since the last checkpoint, which would make the backup useless at
exactly the moment it is needed.

## ADR-035 — Community shows what is being discussed, never what the discussion concludes

**Status:** accepted.

`CommunityPost` carries the platform's own title, author, community, score, comment count and
timestamp. It carries no sentiment, no rank, no trend and no derived score of any kind, and the
adapter orders by recency rather than by engagement. A test asserts the model has no such field
and that the rendered panel never uses the vocabulary.

**Why:** aggregating opinion into a number is a verdict, and the app has no basis for one — the
same reason the crypto risk checklist has no score (ADR-022). Ordering by engagement would be a
quieter version of the same thing: the app deciding which opinions matter.

Engagement numbers are still shown, because they are facts the platform reports and hiding them
loses real information. They are labelled "as reported" so it is clear whose number it is.

**What actually ships:** the full pipeline — opt-in gate in Rust, provider trait, validation,
caching, labelled UI — backed by a **fixture provider only**. No live discussion platform is
wired in, because `PROVIDERS.md` records only terms that were actually read and none have been.
The panel says this in the UI rather than showing an empty list. See PROVIDERS.md.

## ADR-036 — The cloud AI provider is generic, not a named vendor

**Status:** accepted. (Recorded with Phase 5; repeated here because Phase 6 review raised it.)

See ADR-032. The same reasoning applies to the community provider: the app does not put a
third party's name on a settings page while being unable to describe how that party handles the
data it receives.

---

## ADR-037 — A market sentiment index is allowed; a verdict about an asset is still not

**Status:** accepted.

Brew Terminal ships two Fear & Greed indices: the published crypto one from Alternative.me, and
an equity one computed here from Federal Reserve series.

This needs recording because it sits against three earlier statements. ADR-022 says "anything
that adds up is a verdict". ADR-035 says "aggregating opinion into a number is a verdict, and
the app has no basis for one". `PRODUCT_SCOPE_V0_1.md` §3 lists "sentiment classification"
among the explicit non-goals. A reader who meets those first and then finds a 0–100 gauge is
entitled to ask what happened.

**Where the line actually falls.** Those three are about the app passing judgement on _a thing
the user might buy_, or on _what a group of people believe_:

- A risk checklist that tallies ticks scores **an asset's legitimacy**.
- Ranking community posts scores **whose opinion matters**.
- A "scam score" is both at once.

A market sentiment index does neither. It describes **conditions across a whole market** from
published measurements — where the S&P 500 sits against its own average, where the VIX sits
against its own, what lenders charge the riskiest borrowers. It attaches to no asset, so it
cannot function as a legitimacy score for one. It aggregates measurements, not opinions. And it
recommends nothing: a reading of 68 is not a reason to buy or sell anything, and the app says so.

**What keeps it on the right side.** Three properties, all enforced in code rather than
promised in prose:

1. **Every component is shown** — its input series, its raw reading, the arithmetic, and whether
   it was inverted. The number can be recomputed by hand from public data. The rule this feature
   actually follows is not "no scores" but "no score whose inputs are hidden".
2. **The basis is declared in the payload.** `SentimentBasis` distinguishes a figure reported
   from a publisher from one computed here, and the UI cannot render one without saying which.
3. **The computed index says nobody publishes it.** Its own methodology text states that it is
   this app's arithmetic.

**What this does not license.** No per-asset sentiment score, no ranking of assets by any
composite, no "signal" derived from the index, and no sentiment on community content — ADR-035
stands unchanged. The distinction is the asset-level verdict, not the arithmetic.

**Alternatives:** report the well-known equity index instead of computing one (rejected: it has
no documented API, only an endpoint its own site calls, which ADR-008 rules out). Ship the
crypto index alone (rejected: it would leave the equities half of the app with no equivalent,
and the components are the teaching content). Hide the components behind a disclosure (rejected:
the components are the point; the composite alone is the thing these ADRs are wary of).

---

## ADR-038 — Reading a site's own feed declaration is not scraping

**Status:** accepted.

Adding a news feed used to require already knowing its URL. Feed discovery takes a site address,
fetches the page, and reads the `<link rel="alternate" type="application/rss+xml">` elements out
of its `<head>`.

This needs recording because ADR-008 says "no scraping, and no undocumented/unofficial
endpoints", and fetching someone's HTML and reading tags out of it is at least adjacent to the
thing that rules out.

**Why it falls on the allowed side.** Autodiscovery is a published convention, and the tag is the
site's own machine-readable statement of where its feed is. Reading it is following a signpost
the publisher put up for exactly this purpose — the same category as reading a documented JSON
API, not the same category as parsing article text out of a page that never offered it. The two
things ADR-008 is actually protecting against are both absent: there is no endpoint here that the
publisher did not intend for programmatic use, and there is no extraction of content the site did
not offer in a machine-readable form.

**What keeps it there**, enforced in code:

1. **Only `<link>` elements, only in the `<head>`.** The scan stops at `</head>`. No article
   text, no body markup, no attempt to read content out of the page.
2. **No path guessing.** A site that declares nothing returns an empty list. The app does not
   probe `/feed`, `/rss`, `/index.xml` hoping something answers — that would be exactly the
   "reachable but not offered" behaviour ADR-008 rules out.
3. **No third-party search service.** There are feed-search APIs that would do this; using one
   would mean sending the user's browsing interest to a company they did not choose. The site
   itself is the only party in the request.
4. **The same HTTPS rule as everywhere else.** A feed declared over plain `http` is not offered,
   because the app would not fetch it.
5. **Bounded.** At most 512KB of the page is read and at most six candidates are verified, so
   this cannot become the most expensive request the app makes or a burst against one host.

**Alternatives:** a third-party feed-search API such as feedsearch.dev (rejected: it puts a
company between the user and the site they asked about, adds a dependency whose terms would need
the ADR-008 review, and answers a question the site already answers itself). Ship a curated
directory only (rejected: it goes stale, and it cannot answer "does _this_ site have a feed",
which is the actual question). Probe conventional paths when autodiscovery finds nothing
(rejected: see 2 — that is guessing at endpoints, which is the line).

---

## ADR-039 — Atlas rotates free tiers; it does not pretend they add up to a real-time feed

**Status:** accepted.

Atlas is a live ticker over the free provider tiers this project has reviewed. It refreshes on a
fixed 90-second cadence, tracks each provider's allowance, and steps aside from any provider that
returns 429 or fails repeatedly.

This needs recording because "real-time market data, free" is a thing that does not exist, and
the interesting decisions here are all about not implying it does.

**What Atlas actually is.** A ticker whose figures are at most ninety seconds old, over providers
whose free tiers are samples rather than supplies. Real-time market data is licensed; the reason
no free API offers it continuously is commercial, not technical, and no amount of rotation
changes that. Atlas says "at most 90 seconds old" on screen rather than "live", and the status
line names the provider and its remaining allowance so a reader can see what is behind the
number.

**Why rotation and not just one provider.** A per-minute allowance shared with the rest of the
app is easy to exhaust, and the failure is invisible: the panel silently shows older data with no
account of why. The manager makes that explicit — it knows what each tier permits, spends
deliberately below it, and reports what is left.

**The design decisions that matter:**

1. **The policy is pure and the clock is a parameter.** Every failure mode worth catching is
   about time — a window that never rolls, a backoff that never expires, a daily cap that resets
   in the wrong timezone — and none is reproducible against a real clock and a real API. Twenty-
   eight tests exist because `now` is an argument.
2. **Calls are counted, not ticks.** Finnhub's `/quote` takes one symbol per call, so a
   twelve-symbol watchlist is twelve calls; CoinGecko's `/coins/markets` returns the lot for one.
   A manager counting ticks would be wrong by the length of the watchlist on the equities side.
3. **A call is booked when it is made, not when it succeeds.** The provider counted it either
   way, and booking on success lets a run of failures walk straight through a daily cap.
4. **Every ceiling is below what the provider publishes.** A client running at exactly the
   documented limit is one clock skew from a 429, and the margin costs nothing at this cadence.
   Atlas also takes only a slice of each allowance, because the rest of the app draws on the same
   account.
5. **A partial tick beats an empty one.** Where the budget covers part of the list, that part is
   refreshed and the rest keeps its cached value with its real age. Degrading to older data is
   honest; degrading to an error or to a number with no provenance is not.
6. **"Fallback ready" is checked, not assumed.** The status line only claims a fallback when the
   manager has confirmed a second provider could take the next request, and says "no second
   source reviewed" otherwise rather than leaving the reader to infer a safety net.

**Alpha Vantage is not in the rotation**, despite being the obvious second equity source. The
arithmetic rules it out, not the terms: `GLOBAL_QUOTE` takes one symbol per call against a free
tier of **25 requests a day**, so a twelve-symbol watchlist would spend half the daily budget on
one tick. It is a chart-only provider in this codebase for that reason — its `quotes()` returns
nothing deliberately — and listing it would produce a fallback that rotates to a provider which
answers with an empty list. A fallback that silently returns no data is worse than none, because
the status line would claim a working route. ADR-013 reached the same conclusion for the
watchlist; nothing about a rotation manager changes the request cost.

**Binance is not in the rotation either.** Its public market-data endpoints are documented and
keyless and would be a genuine second crypto source. They have not been through the ADR-008 terms
review, and they are geo-restricted in the US with Binance.US a separate API under separate
terms. Adding a provider to `catalogue.rs` is one entry; adding one without reading its terms is
the thing ADR-008 forbids. The table is the extension point, and it is deliberately empty until
that review happens.

**Alternatives:** stream over WebSocket (rejected for now: Finnhub's free tier supports it for up
to 50 symbols and it would genuinely reduce request cost, but it needs a WebSocket dependency, a
reconnection policy and a second data path for one screen — worth doing, and worth doing on its
own rather than folded into this). Refresh faster than 90s (rejected: the allowances are
per-minute, so a five-second cadence spends a tier's minute in one tick and returns rate limits).
Make the cadence a preference (rejected for the same reason — it is part of what makes the
feature work, not a taste).
