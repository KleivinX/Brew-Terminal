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

| Asset                            | Raw      | Gzipped      |
| -------------------------------- | -------- | ------------ |
| `index.js` (initial)             | 347.1 KB | **108.5 KB** |
| `index.css` (initial)            | 20.8 KB  | **4.9 KB**   |
| **Initial payload total**        | 367.9 KB | **110.7 KB** |
| `EmptyState` (shared lazy chunk) | 13.8 KB  | 5.5 KB       |
| `SettingsRoute`                  | 11.3 KB  | 4.0 KB       |
| `ResearchRoute`                  | 3.0 KB   | 1.3 KB       |
| `ModelDeskRoute`                 | 2.2 KB   | 1.0 KB       |
| `LearnRoute`                     | 1.7 KB   | 0.8 KB       |

**97.3 KB against a 200 KB budget — 49% used.**

Phase 4 added 50 glossary entries, 17 lessons and a validation schema, and the entry chunk went
_down_ again. All of that content sits in the lazily-loaded `LearnRoute` chunk (39.6 KB
gzipped), which is fetched only when someone opens Learn.

Phase 3 added charts, notes, and three new panels, and the initial chunk still came out
_smaller_ than Phase 2's 113.5 KB. Two things account for that:

- **The chart library never enters the entry chunk.** `lightweight-charts` is 53.2 KB gzipped — half the entry chunk again — and lives in its own lazily-imported `AssetChart` chunk, fetched only when someone opens a price chart.
- **A leak was found and closed.** `src/lib/ipc.browser.ts` statically imported every development fixture, and `chart_series.json` alone is 30 KB gzipped. That put ~35 KB of fixtures in the entry chunk of the shipped desktop app — which never runs the harness at all. It had been leaking since Phase 1 and only became obvious when the chart fixture made it large. It is now a dynamic import.

The second one is worth remembering as a class of bug: a dev-only module reachable through a
static import is not dev-only in the bundle. CI fails the build if the entry chunk exceeds
204800 bytes gzipped.

The headroom matters: Phase 3 adds `lightweight-charts` (~48 KB gzipped), but it loads inside
the Research Lab chunk, not the initial one. Route-level `React.lazy` is what keeps the
dashboard from paying for features the user has not opened.

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

## 3. Runtime — partially measured

| Metric                                  | Budget   | Status                                                 |
| --------------------------------------- | -------- | ------------------------------------------------------ |
| Cold start to interactive shell         | ≤ 2.0 s  | **Not yet measured**                                   |
| Warm start                              | ≤ 1.2 s  | **Not yet measured**                                   |
| Idle RSS, Pulse open                    | ≤ 300 MB | **Not yet measured**                                   |
| Idle CPU, focused, no refresh in flight | < 1 %    | **Not yet measured**                                   |
| Route switch (cached data)              | ≤ 150 ms | Feels instant in the browser harness; not instrumented |
| Installer size                          | ≤ 15 MB  | **Not yet measured**                                   |

These are deliberately left blank rather than filled with plausible-looking numbers.

**Why not yet:** meaningful startup and memory figures need a packaged release build
(`opt-level = "s"`, LTO, `strip`, `panic = "abort"`), and a release build on this machine takes
long enough that it belongs in a dedicated measurement pass rather than mid-implementation. The
debug binary currently weighs 43.9 MB, which says nothing useful about the release artifact.

**How they will be measured**, at the start of Phase 2:

```bash
# 1. Produce the release build
npm run tauri:build

# 2. Cold start — measured five times, median reported, with the page emitting a
#    performance mark on first paint of the Pulse table.
# 3. Idle RSS — after 60s idle with Pulse open and a 25-row watchlist:
ps -o rss= -p "$(pgrep -f 'Brew Terminal')"
# Both the app process and its WebKit content process count toward the budget.
# 4. Idle CPU — sampled over 60s with the window focused and no refresh in flight.
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
