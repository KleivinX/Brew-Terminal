# Brew Terminal — Performance

Measured on the reference machine, not estimated. Where a number has not been measured yet,
this document says so rather than guessing.

**Reference hardware:** 2016 Intel MacBook — x86_64, macOS 13.7.8, Node 24.16, Rust 1.96.1.
This is the target machine from the brief, and it is also the development machine, so every
figure below comes from the hardware the budget is written for.

_Last updated: end of Phase 1 (2026-08-22)._

---

## 1. Bundle size — measured

Budget: initial chunk ≤ 200 KB gzipped, any lazy chunk ≤ 120 KB gzipped.

Measured after Phase 7, on the release build (`npm run build`):

| Asset                             | Gzipped     | Loaded when               |
| --------------------------------- | ----------- | ------------------------- |
| `index.js` (initial)              | **94.5 KB** | always                    |
| `index.css` (initial)             | **5.3 KB**  | always                    |
| **Initial payload total**         | **99.8 KB** | always                    |
| `AssetChart` + css                | 53.8 KB     | a price chart is opened   |
| `ipc.browser` (dev harness)       | 38.5 KB     | never, outside Tauri only |
| `LearnRoute` + css                | 39.7 KB     | Learn is opened           |
| `Button` (shared component chunk) | 14.3 KB     | first route that uses it  |
| `SettingsRoute` + css             | 13.6 KB     | Settings is opened        |
| `ModelDeskRoute` + css            | 8.1 KB      | Model Desk is opened      |
| `ResearchRoute` + css             | 7.0 KB      | Research Lab is opened    |

**99.8 KB against a 200 KB budget — 49% used.** CI fails the build above 204800 bytes.

Phases 5 and 6 added the Model Desk, the community panel, the encrypted profile flow and the
password meter, and the entry chunk grew by **0.4 KB**. Everything new sits in lazily-loaded
route chunks: `ModelDeskRoute` is 8.1 KB and `SettingsRoute` — which now carries the AI panel,
the profile panel and the strength meter — is 13.6 KB. Neither is fetched until the route is
opened.

Two things account for the entry chunk staying flat across four phases:

- **The chart library never enters the entry chunk.** `lightweight-charts` is 53 KB gzipped —
  more than half the entry chunk again — and lives in its own lazily-imported chunk.
- **A leak was found and closed in Phase 3.** `src/lib/ipc.browser.ts` statically imported every
  development fixture, and `chart_series.json` alone is 30 KB gzipped. That put ~35 KB of
  fixtures in the entry chunk of the shipped desktop app, which never runs the harness at all.
  It had been leaking since Phase 1. It is now a dynamic import (ADR-023).

The second is worth remembering as a class of bug: **a dev-only module reachable through a
static import is not dev-only in the bundle.** The harness chunk has since grown to 38.5 KB as
the fixtures grew, which would have been a 38.5 KB regression on every start had it not been
caught.

## 2. Build and test times — measured

| Task                                                             | Time                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| Frontend production build (warm)                                 | 2.4–3.3 s                                               |
| Frontend build (cold, first run)                                 | 0.9 s reported by Vite, ~6 s wall including startup     |
| Rust `cargo check --all-targets` (cold, full dependency tree)    | 5 m 19 s                                                |
| Rust `cargo check --all-targets` (incremental, one file touched) | 11.2 s                                                  |
| Rust test suite (96 tests)                                       | 0.41 s of test execution; 34.6 s wall including compile |
| Frontend test suite (139 tests)                                  | 33.2 s wall                                             |

The cold Rust build is the one genuinely slow step on this hardware. It is a one-time cost per
clean checkout; the incremental loop is 11 s. This is why `npm run dev` exists as a separate
path — UI iteration runs against the browser harness with no Rust rebuild at all.

## 3. Runtime — measured on the packaged release build

Measured 2026-08-25 on the reference machine (2016 dual-core Intel MacBook, macOS 13.6), against
the release bundle produced by `npm run tauri:build` — `opt-level = "s"`, LTO, `strip`,
`panic = "abort"`. That build took **17m 48s**.

| Metric                                  | Budget   | Measured                               | Verdict   |
| --------------------------------------- | -------- | -------------------------------------- | --------- |
| Installer size (`.dmg`)                 | ≤ 15 MB  | **5.0 MB**                             | ✅        |
| Application bundle (`.app`)             | —        | 9.6 MB                                 | —         |
| Stripped binary                         | —        | 9.2 MB (debug build: 67.6 MB)          | —         |
| Idle RSS, Pulse open, 60 s after launch | ≤ 300 MB | **115.5 MB** across 3 processes        | ✅        |
| Idle CPU, focused, no refresh in flight | < 1 %    | **0.0 %** on all 3 processes           | ✅        |
| Launch → process alive, cold            | —        | 0.62 s                                 | —         |
| Launch → process alive, warm            | —        | 0.28 s (median of 3)                   | —         |
| Launch → CPU settled, cold              | —        | 5.59 s                                 | see below |
| Launch → CPU settled, warm              | —        | 2.66 s (median of 3: 2.68, 2.64, 2.66) | see below |
| Cold start to **interactive shell**     | ≤ 2.0 s  | **still not measured**                 | —         |
| Warm start to **interactive shell**     | ≤ 1.2 s  | **still not measured**                 | —         |
| Route switch (cached data)              | ≤ 150 ms | Feels instant; not instrumented        | —         |

### The two numbers that are still blank, and why

"Launch → CPU settled" is **not** the same thing as "start to interactive shell", and reporting
it as though it were would be exactly the kind of plausible-looking number this document exists
to avoid. It is measured from `open` until total process CPU drops below 8 % twice in a row —
which happens _after_ the first CoinGecko request completes, because a release build has the
mock provider disabled and Pulse fetches real crypto data on open. The shell is interactive well
before that, with skeleton rows on screen, but "well before" is not a measurement.

Getting the real number needs a `performance.mark` on the first paint of the Pulse table,
reported back through IPC so it lands in the Rust log where it can be read from a packaged
build. That instrumentation does not exist, so the two cells stay blank.

What the settled numbers _do_ establish: nothing pathological happens at startup, the figure is
stable across runs to within 40 ms, and warm start is less than half of cold.

### Memory, in detail

macOS splits a Tauri app across three processes, and all three count:

| Process                     | RSS          |
| --------------------------- | ------------ |
| `brew-terminal` (Rust core) | 45.3 MB      |
| `WebKit.WebContent`         | 62.6 MB      |
| `WebKit.Networking`         | 7.7 MB       |
| **Total**                   | **115.5 MB** |

Note that the WebKit XPC services are reparented to `launchd`, so they cannot be found by walking
the process tree from the app — they were identified by start time instead. A naive
`pgrep -f "Brew Terminal"` finds only the Rust process and would under-report memory by 61 %.

### How to reproduce

```bash
npm run tauri:build
open -a "src-tauri/target/release/bundle/macos/Brew Terminal.app"
# 60s later, summing the Rust process and both WebKit XPC services:
ps -eo pid,rss,%cpu,comm | grep -E "brew-terminal|WebKit"
```

## 4. Design decisions that carry the budget

Each of these is doing measurable work, not theoretical work:

- **OS webview instead of Chromium.** The single largest factor. See ADR-001.
- **Route-level code splitting.** Four of five routes are lazy; the initial chunk is 110.7 KB rather than the ~135 KB it would be with everything eagerly loaded.
- **No manual vendor chunking.** Tested and removed — in a desktop app there is no CDN cache to benefit from a separate vendor file, and it only fragmented the entry.
- **CSS Modules with a token layer.** 4.9 KB gzipped for the entire global stylesheet including all three themes.
- **Sparklines as one `<path>` each.** A 20-row viewport renders ~20 path nodes, not hundreds of SVG elements.
- **Virtualized tables.** Only the visible window exists in the DOM; `aria-rowcount` reports the true total to assistive tech.
- **Batched quotes.** `get_quotes` takes a vector and there is no single-quote command, so an N+1 fetch cannot be written by accident.
- **No always-on timers.** One coalesced, cancellable, focus-aware refresh scheduler.

## 5. Known costs accepted

- **`opt-level = "s"` over `"3"`.** Smaller binary and less to page in at launch, at some throughput cost. The workload is I/O and SQLite, not computation, so throughput is not the constraint.
- **LTO + `codegen-units = 1`.** Materially slower release builds in exchange for a smaller binary. Debug builds are unaffected, so the development loop does not pay it.
- **Bundled SQLite.** ~1 MB of binary for identical behaviour on all three platforms. Worth it.
