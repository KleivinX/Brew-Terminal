<div align="center">

# Brew Terminal

**Markets, minus the gatekeeping.**

A local-first, open-source market research and learning terminal for crypto and stocks.

_Educational information only — not financial advice._

</div>

---

## What this is

Brew Terminal is a research and literacy tool that happens to look like a terminal. It makes
market data easier to read and financial language easier to learn, without pretending to be a
trading platform.

- **Local-first and account-free.** No sign-up, no server, no cloud sync. Your watchlists, notes and preferences live in a SQLite file on your computer.
- **No telemetry.** The app makes no request you did not cause.
- **Honest about its data.** Every number shows which provider it came from and how old it is.
- **Optional AI, off by default.** Bring a local model or your own API key, or use none at all.
- **Cross-platform.** macOS, Windows and Linux, built to stay responsive on a 2016 Intel MacBook.
- **Learn works offline.** A 50-term glossary and five learning paths ship with the app; no request is made to read any of it.

## What this is not

Not a broker. Not a portfolio tracker. Not a financial adviser. It will not tell you what to
buy, when to sell, where a price is going, or whether something is a good investment. Those are
not missing features — they are deliberate exclusions, documented in
[`docs/PRODUCT_SCOPE_V0_1.md`](docs/PRODUCT_SCOPE_V0_1.md).

## Status: Phase 4 of 7

The shell, watchlists, live crypto data and the Research Lab are working. Crypto prices and
price history come from **CoinGecko** and are real. Equities need a free **Finnhub** key, which you add in
Settings → Data providers; until then the Stocks tab says so rather than showing anything.

Development builds also enable a fixture provider so the UI can be worked on offline; anything
it serves is labelled "Mock data" in the panel and in the status bar. See
[`content/fixtures/README.md`](content/fixtures/README.md).

| Phase | Scope                                                            | State    |
| ----- | ---------------------------------------------------------------- | -------- |
| 0     | Architecture, scope, threat model, data model                    | Done     |
| 1     | App shell, three themes, command palette, SQLite, mock providers | **Done** |
| 2     | Pulse dashboards, watchlists, first live providers               | Next     |
| 3     | Research Lab, charts, news, notes                                | Planned  |
| 4     | Learn — glossary and learning paths                              | Planned  |
| 5     | Model Desk — local and cloud AI                                  | Planned  |
| 6     | Community temperature, encrypted profile export                  | Planned  |
| 7     | Release readiness                                                | Planned  |

## Getting started

Requires [Node.js](https://nodejs.org) 20.19+ and a [Rust toolchain](https://rustup.rs). Tauri
also needs platform build tools — see the
[Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
```

Run the desktop app:

```bash
npm run tauri:dev
```

Or run the UI in a plain browser against the same fixtures — much faster to iterate on, and it
does not need a Rust rebuild:

```bash
npm run dev
```

### Checks

```bash
npm run check
```

That runs formatting, linting, TypeScript and the frontend tests. For the Rust side:

```bash
cd src-tauri && cargo test
```

## Keyboard

| Keys                         | Action                                       |
| ---------------------------- | -------------------------------------------- |
| `⌘K` / `Ctrl+K`              | Command palette                              |
| `g` then `p` `r` `l` `d` `s` | Go to Pulse, Research, Learn, Desk, Settings |
| `⌘R` / `Ctrl+R`              | Refresh visible data                         |
| `j` / `k` or arrows          | Move table selection                         |
| `Enter`                      | Open the selected asset                      |
| `Esc`                        | Close an overlay                             |

## How your data is handled

- **Watchlists, notes, preferences, learning progress** — a SQLite file in your OS application data directory. Not encrypted; see [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) §5 for why that is a deliberate, stated choice rather than an oversight.
- **API keys** — your operating system's credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service). Never in the database, never in logs, never in exports.
- **Cloud AI** — disabled until you configure it. Nothing is ever sent without a direct action from you, and the app keeps a local log of what left the device.

## Documentation

| Document                                            | What it covers                                         |
| --------------------------------------------------- | ------------------------------------------------------ |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)             | Process model, IPC, caching, performance budget        |
| [PRODUCT_SCOPE_V0_1.md](docs/PRODUCT_SCOPE_V0_1.md) | Features, non-goals, acceptance criteria               |
| [DECISIONS.md](docs/DECISIONS.md)                   | Architecture decisions and the alternatives rejected   |
| [DATA_MODEL.md](docs/DATA_MODEL.md)                 | SQLite schema and migration strategy                   |
| [THREAT_MODEL.md](docs/THREAT_MODEL.md)             | Keys, local data, exports, cloud AI, untrusted content |
| [AI_POLICY.md](docs/AI_POLICY.md)                   | Guardrails and the system prompt                       |
| [UI_MAP.md](docs/UI_MAP.md)                         | Routes, keyboard map, panel states, design tokens      |
| [DEPENDENCIES.md](docs/DEPENDENCIES.md)             | Every dependency, with a reason                        |
| [PERFORMANCE.md](docs/PERFORMANCE.md)               | Measured startup, bundle and memory figures            |

## Licence and name

The code is licensed under **AGPL-3.0-or-later** — see [LICENSE](LICENSE).

The **Brew Terminal name, logo and artwork are not covered by that licence**. You may fork the
code, but a fork must use a different name and must not present itself as official. See
[TRADEMARK.md](TRADEMARK.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

---

**Disclaimer.** Brew Terminal provides educational and research information only. It is not
financial, investment, legal or tax advice. Market data comes from third-party providers and
may be delayed, incomplete or wrong. Verify anything that matters against a primary source, and
consider talking to a licensed professional before making financial decisions.
