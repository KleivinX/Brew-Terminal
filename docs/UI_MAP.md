# Brew Terminal — Route, Navigation and Interaction Map

---

## 1. Route table

Hash history (`#/…`), so every location is a real deep link the palette and notes can point at.

| Route                                   | Screen                                | Lazy               | Notes                                   |
| --------------------------------------- | ------------------------------------- | ------------------ | --------------------------------------- |
| `#/`                                    | → redirect to `#/pulse`               | —                  |                                         |
| `#/pulse`                               | Pulse dashboard                       | no (initial chunk) | default landing                         |
| `#/pulse?tab=crypto\|stocks\|watchlist` | Pulse tab state                       | no                 | tab is a search param so it is linkable |
| `#/research/:assetType/:assetKey`       | Research Lab                          | yes                | e.g. `#/research/crypto/cg:bitcoin`     |
| `#/learn`                               | Learn home — paths + glossary entry   | yes                |                                         |
| `#/learn/glossary`                      | Glossary index                        | yes                |                                         |
| `#/learn/glossary/:termId`              | Glossary entry                        | yes                |                                         |
| `#/learn/path/:pathId`                  | Learning path overview                | yes                |                                         |
| `#/learn/path/:pathId/:lessonId`        | Lesson                                | yes                |                                         |
| `#/desk`                                | Model Desk                            | yes                | empty/not-configured state until set up |
| `#/desk/:conversationId`                | A conversation                        | yes                |                                         |
| `#/settings`                            | Settings → Appearance                 | yes                |                                         |
| `#/settings/providers`                  | Data providers                        | yes                |                                         |
| `#/settings/ai`                         | AI providers                          | yes                |                                         |
| `#/settings/privacy`                    | Privacy, cache, outbound log          | yes                |                                         |
| `#/settings/profile`                    | Encrypted export/import               | yes                |                                         |
| `#/settings/about`                      | About, licence, attributions          | yes                |                                         |
| `*`                                     | Not-found, with a route back to Pulse | no                 |                                         |

---

## 2. Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Title bar (native)                                                      │
├────────┬─────────────────────────────────────────────────────────────────┤
│        │  Workspace header: title · context actions · ⌘K hint            │
│  Nav   ├─────────────────────────────────────────────────────────────────┤
│  rail  │                                                                 │
│        │  Content workspace                                              │
│ Pulse  │                                                                 │
│ Lab    │                                                                 │
│ Learn  │                                                                 │
│ Desk   │                                                                 │
│ Set... │                                                                 │
│        ├─────────────────────────────────────────────────────────────────┤
│        │  Status bar: provider · last updated · connection · disclaimer  │
└────────┴─────────────────────────────────────────────────────────────────┘
```

- Nav rail: 64 px icon-only by default, expands to 200 px with labels; the state persists. Labels are always present for screen readers.
- The status bar is a permanent honesty surface: active provider, last refresh, offline/online, and the standing disclaimer.
- Minimum window 1024 × 700. Below 1200 px wide, secondary panels stack under the primary column. No mobile layout — an explicit non-goal.

---

## 3. Command palette

Opens with `⌘K` / `Ctrl+K`, closes with `Esc`. Fuzzy match over a static command registry plus
live asset search results, grouped and keyboard-navigable.

| Group      | Commands (v0.1)                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| Search     | `Search assets…` — inline results; `Enter` opens Research Lab, `⌘Enter` adds to the default watchlist |
| Navigate   | Go to Pulse · Research Lab · Learn · Glossary · Model Desk · Settings                                 |
| Watchlist  | Add asset to watchlist… · Create watchlist… · Remove from watchlist…                                  |
| Appearance | Theme: Dark · Theme: Light · Theme: Soft · Toggle nav rail                                            |
| Data       | Refresh visible data · Clear cache…                                                                   |
| Learn      | Look up a term… · Explain this with my model…                                                         |
| Help       | Keyboard shortcuts · About Brew Terminal                                                              |

A command declares `id`, `title`, `group`, `keywords`, `shortcut?`, `run()` and an optional
`available()` predicate, so unconfigured features (AI, community) are hidden rather than shown
broken.

---

## 4. Keyboard map

| Keys                         | Action                                           |
| ---------------------------- | ------------------------------------------------ |
| `⌘K` / `Ctrl+K`              | Command palette                                  |
| `⌘/` / `Ctrl+/`              | Shortcut cheat sheet                             |
| `g` then `p / r / l / d / s` | Go to Pulse / Research / Learn / Desk / Settings |
| `/`                          | Focus the search field on the current screen     |
| `⌘1..5` / `Ctrl+1..5`        | Jump to nav item                                 |
| `j` / `k` or arrows          | Move table selection                             |
| `Enter`                      | Open selected row in Research Lab                |
| `w`                          | Toggle selected asset in the default watchlist   |
| `⌘R` / `Ctrl+R`              | Refresh visible data (never a full-app reload)   |
| `Esc`                        | Close overlay, clear selection                   |
| `?`                          | Shortcut cheat sheet                             |

Single-letter shortcuts are suppressed while a text input has focus. Focus is trapped in
modals and restored to the trigger on close.

---

## 5. Panel state machine

Every data panel renders exactly one of these, and the freshness envelope decides which:

```
                ┌─────────────┐
   first load → │  skeleton   │
                └──────┬──────┘
                       ▼
        ┌──────────────────────────────┐
        │ ready (live)                 │  provider · "updated 12s ago"
        └───┬───────────┬──────────┬───┘
            ▼           ▼          ▼
   ┌─────────────┐ ┌─────────┐ ┌────────────────┐
   │ ready(stale)│ │  empty  │ │ rate-limited   │
   │ old value + │ │ teaches │ │ shows cached + │
   │ age marker  │ │ next    │ │ retry time     │
   └─────────────┘ │ action  │ └────────────────┘
                   └─────────┘
            ▼                       ▼
   ┌────────────────┐    ┌────────────────────┐
   │ provider error │    │ not configured     │
   │ cached + retry │    │ links to Settings  │
   └────────────────┘    └────────────────────┘
```

Rules: skeletons occupy the final layout so nothing jumps. Stale never means blank — the last
good value stays visible with its age. Errors always offer the next action (retry, open
Settings, view cached). Empty states teach: "Add your first asset to start a watchlist."

---

## 6. Colour and theme tokens

Semantic tokens only; components never reference a raw hex value.

```
--bg-app, --bg-surface, --bg-elevated, --bg-inset
--border-subtle, --border-strong, --border-focus
--text-primary, --text-secondary, --text-muted, --text-inverse
--accent, --accent-hover, --accent-muted, --accent-contrast-text
--positive, --positive-muted, --negative, --negative-muted, --neutral
--status-live, --status-stale, --status-error, --status-offline
--radius-sm/md/lg, --space-1..8, --font-ui, --font-mono, --shadow-1/2
```

| Token            | Dark (default) | Light     | Soft      |
| ---------------- | -------------- | --------- | --------- |
| `--bg-app`       | `#0B0D10`      | `#F8F6F1` | `#1A1D21` |
| `--bg-surface`   | `#15191F`      | `#FFFFFF` | `#22262B` |
| `--text-primary` | `#F7F7F2`      | `#0B0D10` | `#E6E3DC` |
| `--accent`       | `#F97316`      | `#C2410C` | `#E8A24A` |
| `--positive`     | `#3FB950`      | `#1A7F37` | `#7FB07F` |
| `--negative`     | `#F85149`      | `#B91C1C` | `#D08C86` |

Values are a starting point; each pairing is verified at ≥ 4.5:1 for body text and ≥ 3:1 for
large text and UI boundaries before Phase 1 closes. Light mode darkens the orange because
`#F97316` on white fails contrast for text; Soft mutes both the accent and the direction
colours to lower stimulation while staying above threshold.

**Direction is never colour alone.** Every change value carries a sign, an arrow glyph and an
accessible label: `▲ +2.41%` / `▼ −1.08%`, with `aria-label="up 2.41 percent"`. This holds in
tables, sparklines (dashed stroke for negative) and the asset header.

---

## 7. Component inventory for Phase 1

`components/`: AppShell, NavRail, WorkspaceHeader, StatusBar, CommandPalette, Button, IconButton,
Input, Select, Toggle, Tabs, Card, Panel, DataTable (sortable + virtualized), Sparkline,
ChangeValue, PriceValue, StatusPill, ProviderBadge, RelativeTime, Skeleton, EmptyState,
ErrorState, StaleBanner, Modal, Drawer, Tooltip, Toast, DisclaimerNote, KeyboardHint,
SearchField, ConfirmDialog, MaskedSecretInput.

Each ships with a Vitest component test covering render, keyboard interaction and axe checks.

---

## 8. Copy rules

Voice: clear, calm, modern, never hype. "Market pulse", "Research Lab", "Community temperature",
"Explain this".

- Never assert causality: "Published around this move", not "Why BTC dropped".
- Never assert legitimacy: "Unverified community discussion", not "Trending / verified / hot".
- Never advise: "Things people look at", not "What you should do".
- Numbers always carry provider and age.
- Banned strings are enforced by a lint rule over user-facing copy — list in `PRODUCT_SCOPE_V0_1.md` §6.

## Added in Phases 5 and 6

**Model Desk** (`#/desk`) has three states, and the difference between the last two matters
because the fix differs: no endpoint configured, an endpoint configured with the desk switched
off, and ready. The status pill carries the reach label rendered by Rust — the UI never decides
for itself whether an endpoint is "offline".

The desk owns its viewport: the transcript scrolls while the composer stays put. A page that
scrolled as a whole would push the input off screen exactly when it is being used.

**Settings → AI providers** (`#/settings/ai`) offers local and hosted as a radio choice, keeps
both configurations, and separates saving an endpoint from switching the desk on.

**Settings → Backup and transfer** (`#/settings/profile`) is export and import. The import flow
is deliberately three steps — pick a file, open it, then choose merge or replace — so the choice
is made while looking at real counts from the real file.

**Research Lab** gains **Community temperature**, off by default with the opt-in inline in the
panel. Every post carries an "Unverified" chip, its source, its timestamp and the platform's own
engagement numbers labelled "as reported". Ordering is newest-first, never by engagement.

Two copy rules were applied throughout: status is never colour alone (the password meter always
states its level in words beside the bars; the unverified chip is a word, not a hue), and no
surface characterises the mood of a discussion or the quality of a model's answer beyond quoting
what triggered a caution.
