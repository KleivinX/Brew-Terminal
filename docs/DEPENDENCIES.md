# Brew Terminal — Dependency Budget

Rule: every dependency needs a reason, a licence check and a size check. Anything that can be
30 lines of our own code instead of a package, is 30 lines of our own code.

Versions below were resolved against the live registries on 2026-08-22 and are pinned in the
lockfiles. Gzipped sizes are approximate budget estimates, re-measured against the real bundle
in Phase 1 — they are not published figures.

---

## 1. Frontend runtime

| Package                                                             | Major   | ~gz     | Licence        | Why                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ------- | ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react`, `react-dom`                                                | 19.2.8  | ~45 KB  | MIT            | Required by the brief. Concurrent rendering keeps table updates from blocking input on a dual-core machine.                                                                                                                                                                                                                                 |
| `react-router-dom`                                                  | 7.18.2  | ~18 KB  | MIT            | Deep links, route-level lazy boundaries — the main bundle-splitting lever. ADR-009.                                                                                                                                                                                                                                                         |
| `@tanstack/react-query`                                             | 5.101.4 | ~13 KB  | MIT            | Dedup, stale-while-revalidate, cancellation, request-state modelling. ADR-005.                                                                                                                                                                                                                                                              |
| `@tanstack/react-virtual`                                           | 3.14.10 | ~4 KB   | MIT            | Table virtualization; headless, no styling opinions.                                                                                                                                                                                                                                                                                        |
| `zustand`                                                           | 5.0.15  | ~1 KB   | MIT            | Ephemeral UI state. ADR-011.                                                                                                                                                                                                                                                                                                                |
| `lightweight-charts`                                                | 5.2.1   | ~48 KB  | Apache-2.0     | Canvas financial charts, **lazy-loaded into the Research Lab chunk only**. ADR-006.                                                                                                                                                                                                                                                         |
| `@tauri-apps/api`                                                   | 2.11.1  | ~5 KB   | MIT/Apache-2.0 | Typed `invoke` and event bindings.                                                                                                                                                                                                                                                                                                          |
| `tauri-plugin-notification`                                         | 2.x     | 0 KB JS | MIT/Apache-2.0 | OS notifications for fired alerts. Rust-side only — the frontend never calls it. A background alert has to reach someone whose window is not in front, which is by definition something a webview cannot do; the alternative was leaving the app's one background feature invisible. Added to the capability set as `notification:default`. |
| `zod`                                                               | 4.4.3   | ~14 KB  | MIT            | Validates IPC payloads at the frontend boundary and validates local Learn content at build time.                                                                                                                                                                                                                                            |
| `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` | 5.x     | 0 KB JS | OFL-1.1        | The typefaces the design already named and never actually shipped. Only the Latin subsets are declared, by hand, in `src/styles/fonts.css` — 88 KB of woff2 total, and no JavaScript. See §5.                                                                                                                                               |

**Initial-chunk total** (React + Router + Query + Virtual + Zustand + Tauri API + Zod +
app code): projected ~120–160 KB gzipped against a 200 KB budget. `lightweight-charts` is
outside the initial chunk by construction.

### Deliberately not used

- **Tailwind / UI kits (MUI, Chakra, Mantine).** Three themes are cleaner with tokens, and component kits bring far more weight and opinion than a terminal-dense UI wants. ADR-004.
- **A date library (`date-fns`, `dayjs`, `luxon`).** `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat` and `Intl.NumberFormat` cover formatting and relative time natively, with correct localization for free.
- **A wrapper package for axe.** A local helper calling `axe-core` directly is ~20 lines and avoids depending on a 0.1.0 package.
- **A fuzzy-search package.** The command palette's registry is small; a ~40-line subsequence scorer is enough and avoids a dependency in the hot path.
- **`framer-motion`.** Reduced-motion-respecting CSS transitions only.
- **An icon package.** A dozen hand-inlined SVGs, no tree-shaking guesswork. Still true after the v0.2 visual pass: bundling typefaces was a much larger visual improvement than swapping twenty icon paths for a dependency, so the icons stayed hand-drawn.
- **A component library** (Radix, shadcn, MUI). The component set is small, already accessible, and matched to the terminal look. Adopting one would touch nearly every component and flatten the thing that makes the app look like itself.
- **An animation library** (Framer Motion, ~50 KB gzipped). The motion this app needs is a handful of transitions, which CSS does for nothing. The budget is better spent on typefaces the user actually sees.
- **A markdown renderer, for now.** Notes are stored as Markdown but rendered as plain text with minimal formatting in v0.1. Introducing a renderer means introducing an HTML-injection surface; if it lands later it will be sanitized-by-default with a dedicated ADR.

## 2. Frontend tooling

| Package                                                                                               | Major     | Why                                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `vite`                                                                                                | 8.2.2     | Required by the brief; fast dev server matters on the reference hardware.                                                       |
| `@vitejs/plugin-react`                                                                                | 6.1.0     | React fast refresh. Its `oxc`/`babel` peers are optional and unused.                                                            |
| `typescript`                                                                                          | **5.9.3** | Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Deliberately not 7.x — see ADR-014.                      |
| `vitest`                                                                                              | 4.1.11    | Test runner sharing Vite's transform pipeline — one config, one cost.                                                           |
| `@testing-library/react` 16.3.2, `@testing-library/user-event` 14.6.5, `jsdom` 30.0.1                 | —         | Component tests with real keyboard interaction.                                                                                 |
| `axe-core`                                                                                            | 4.13.0    | Accessibility assertions, driven by a ~20-line local helper rather than a wrapper package (`vitest-axe` is at 0.1.0 and stale). |
| `eslint` 9.39.5 + `typescript-eslint` 8.67.0 + `eslint-plugin-react-hooks` + `eslint-plugin-jsx-a11y` | —         | Includes the custom rules: no cross-feature imports, no `dangerouslySetInnerHTML`, banned user-facing phrases.                  |
| `prettier`                                                                                            | 3.9.6     | Formatting, checked in CI.                                                                                                      |

## 3. Rust crates

| Crate                                         | Major  | Licence        | Why                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tauri`                                       | 2.11.5 | MIT/Apache-2.0 | Desktop shell.                                                                                                                                                                                                                                                                                                     |
| `tauri-plugin-dialog`                         | 2.7.2  | MIT/Apache-2.0 | Native file picker for profile export/import — the only filesystem access path.                                                                                                                                                                                                                                    |
| `tauri-plugin-opener`                         | 2.5.4  | MIT/Apache-2.0 | Opens article links in the OS browser, https-only allowlist.                                                                                                                                                                                                                                                       |
| `serde` 1.0.229, `serde_json` 1.0.151         | —      | MIT/Apache-2.0 | Serialization across IPC and provider DTOs.                                                                                                                                                                                                                                                                        |
| `tokio`                                       | 1.53.1 | MIT            | Async runtime; already present under Tauri. Features limited to what is used.                                                                                                                                                                                                                                      |
| `reqwest` (rustls-tls, gzip)                  | 0.13.4 | MIT/Apache-2.0 | HTTP client. **rustls, not native-tls** — identical TLS behaviour on all three platforms and no OpenSSL build dependency on Linux.                                                                                                                                                                                 |
| `rusqlite` (bundled, fts5)                    | 0.40.2 | MIT            | Local database; bundled SQLite for cross-platform consistency. ADR-003.                                                                                                                                                                                                                                            |
| `r2d2` 0.8.10, `r2d2_sqlite` 0.35.0           | —      | MIT            | Small connection pool behind `spawn_blocking`.                                                                                                                                                                                                                                                                     |
| `keyring`                                     | 4.1.6  | MIT/Apache-2.0 | macOS Keychain / Windows Credential Manager / Linux Secret Service.                                                                                                                                                                                                                                                |
| `feed-rs`                                     | 2.4.0  | MIT            | RSS/Atom parsing for the news adapter. Hand-rolling a feed reader means four date formats, XML namespaces, CDATA and entities — untrusted XML is where hand-written parsers grow holes. `sanitize` is off: summaries are reduced to plain text, never rendered as HTML.                                            |
| `sha2`                                        | 0.10.9 | MIT/Apache-2.0 | Verifies every downloaded engine and model against the checksum its publisher advertises. Already in the tree via `argon2`; taken directly because this is a load-bearing use, not an incidental one.                                                                                                              |
| `flate2` 1.1, `tar` 0.4, `zip` 4              | —      | MIT/Apache-2.0 | Unpacking the inference engine: `.tar.gz` on macOS and Linux, `.zip` on Windows. Well-tested crates rather than hand-rolled parsing, because the archive is attacker-controlled data if a download is ever compromised — and `localai::archive` still does its own path-traversal check rather than trusting them. |
| `argon2`                                      | 0.5.3  | MIT/Apache-2.0 | Argon2id KDF (RustCrypto).                                                                                                                                                                                                                                                                                         |
| `chacha20poly1305`                            | 0.11.0 | MIT/Apache-2.0 | XChaCha20-Poly1305 AEAD (RustCrypto).                                                                                                                                                                                                                                                                              |
| `zeroize`                                     | 1.9.0  | MIT/Apache-2.0 | Wipes passwords and derived keys on drop.                                                                                                                                                                                                                                                                          |
| `rand`                                        | 0.10.2 | MIT/Apache-2.0 | OS CSPRNG for salts and nonces.                                                                                                                                                                                                                                                                                    |
| `zstd`                                        | 0.13.3 | BSD-3          | Compresses profile payloads before encryption.                                                                                                                                                                                                                                                                     |
| `thiserror`                                   | 2.0.20 | MIT/Apache-2.0 | The `AppError` enum.                                                                                                                                                                                                                                                                                               |
| `tracing` 0.1.44, `tracing-subscriber` 0.3.23 | —      | MIT            | Structured logs behind the redaction layer.                                                                                                                                                                                                                                                                        |
| `chrono`                                      | 0.4.45 | MIT/Apache-2.0 | Timestamp parsing/normalization at adapter boundaries.                                                                                                                                                                                                                                                             |
| `ts-rs`                                       | 12.0.1 | MIT            | Generates TypeScript types from Rust models. ADR-010.                                                                                                                                                                                                                                                              |
| `uuid` (v4)                                   | 1.24.1 | MIT/Apache-2.0 | Row ids.                                                                                                                                                                                                                                                                                                           |

### Dev-only Rust

`tempfile` 3.27.0 (isolated test databases), `mockito` or `wiremock` (adapter HTTP tests without a
network), `criterion` (only if a hot path needs measuring — not by default).

### Not yet added, by phase

These are committed to in the architecture but deliberately absent from the Phase 1 scaffold —
each arrives with the phase that first needs it, so the cold build stays as short as possible
on the reference hardware:

| Crate                                                   | Arrives in | For                                                        |
| ------------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| `reqwest` (rustls-tls)                                  | Phase 2    | The first live provider adapter                            |
| `keyring`                                               | Phase 2    | The first provider requiring a credential                  |
| `argon2`, `chacha20poly1305`, `zeroize`, `zstd`, `rand` | Phase 6    | `.brewprofile` encryption                                  |
| `ts-rs`                                                 | Phase 2    | Generating TypeScript types from the Rust models (ADR-010) |
| `lightweight-charts` (npm)                              | Phase 3    | Research Lab charts (ADR-006)                              |

Until then `src/types/domain.ts` is a hand-written contract, and the note at the top of that
file says so.

### Deliberately not used

- **`sqlx`** — async SQLite buys little for small local queries and adds CI friction. ADR-003.
- **`tauri-plugin-sql`** — exposes SQL to the webview. ADR-003.
- **`openssl`/`native-tls`** — rustls avoids a platform build dependency and three TLS behaviours.
- **`tauri-plugin-fs`** — dialog-scoped paths only; no general filesystem capability for the frontend.
- **`tauri-plugin-http`** — all HTTP is in Rust by design. ADR-002.
- **Any local inference crate / bundled weights** — out of v0.1 scope; local AI is an HTTP endpoint the user runs.

## 4. Licence posture

Every dependency listed is MIT, Apache-2.0, or BSD-3 — all compatible with distributing the
project under AGPL-3.0. CI runs `cargo deny check licenses` with an explicit allowlist, and a
frontend licence check does the same for npm. A new dependency under a copyleft or
source-available licence requires an explicit decision, not a merge.

Attribution for runtime data providers is separate from software licensing and is rendered in
Settings → About and in each panel's provider badge.

## 5. Budget enforcement

- CI fails if the initial gzipped chunk exceeds 200 KB or any lazy chunk exceeds 120 KB.
- `npm ci` / `cargo build --locked`; lockfiles committed.
- `cargo audit`, `cargo deny`, `npm audit` in CI; high-severity advisories block merge.
- Adding a runtime dependency requires a line in this file and a note in the PR describing what it replaces or why hand-rolling is worse.

## Added in Phase 5

| Crate | Version | Why                                                                                                                                                                                                                                                           | Licence        |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `url` | 2       | Already compiled as part of `reqwest`; taken as a direct dependency because the "Local · offline" label turns on correctly extracting a host from a user-typed address, and URL parsing is not something to hand-roll when a security property depends on it. | MIT/Apache-2.0 |

No new frontend dependencies. The Model Desk is built from the existing component set.

## Added in Phase 6

| Package                     | Version | Why                                                                                                                                                                                                               | Licence        |
| --------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `argon2`                    | 0.5     | The KDF THREAT_MODEL.md §6.1 specifies, in its RustCrypto implementation. Memory-hard, so a user-chosen password resists GPU brute force.                                                                         | MIT/Apache-2.0 |
| `chacha20poly1305`          | 0.10    | XChaCha20-Poly1305, also from §6.1. The 24-byte nonce is large enough to generate randomly without birthday-bound worry, and the AEAD binds the file header so a downgraded format version fails to authenticate. | Apache-2.0/MIT |
| `zeroize`                   | 1       | Wipes passwords and derived keys on drop rather than leaving them in freed memory.                                                                                                                                | Apache-2.0/MIT |
| `zstd`                      | 0.13    | Compresses the payload before encryption. Builds on the same C toolchain `rusqlite`'s `bundled` feature already requires, so it adds no new build prerequisite.                                                   | MIT            |
| `@tauri-apps/plugin-dialog` | 2.7.2   | The native save/open dialog for profile export and import. The Rust side and the capability entry were already present from Phase 0; this is the matching JS binding.                                             | Apache-2.0/MIT |

No cryptography is implemented in this project. These are the primitives, used as their
implementations intend, with the construction documented in THREAT_MODEL.md §6.1.
