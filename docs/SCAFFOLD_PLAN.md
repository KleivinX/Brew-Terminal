# Brew Terminal — Phase 1 Scaffold File Manifest

The exact set of files created in the first scaffold step, pending owner approval. Nothing here
makes a network request; every screen runs on mock providers.

## Repository root

```
.gitignore
.editorconfig
.nvmrc
README.md                      # short at first; expanded in Phase 7
LICENSE                        # AGPL-3.0 text, pending ADR-012 confirmation
TRADEMARK.md                   # name/logo protection template
CONTRIBUTING.md                # includes the reserved CLA section
SECURITY.md                    # disclosure policy
package.json
package-lock.json
tsconfig.json
tsconfig.node.json
vite.config.ts
vitest.config.ts
vitest.setup.ts
eslint.config.js
.prettierrc
index.html
```

## Frontend — `src/`

```
src/main.tsx
src/vite-env.d.ts

src/app/App.tsx                        # shell composition
src/app/router.tsx                     # routes + lazy boundaries
src/app/providers/QueryProvider.tsx
src/app/providers/ThemeProvider.tsx
src/app/ErrorBoundary.tsx
src/app/KeyboardProvider.tsx

src/components/layout/AppShell.tsx + .module.css
src/components/layout/NavRail.tsx + .module.css
src/components/layout/WorkspaceHeader.tsx + .module.css
src/components/layout/StatusBar.tsx + .module.css
src/components/palette/CommandPalette.tsx + .module.css
src/components/palette/commandRegistry.ts
src/components/palette/fuzzy.ts
src/components/ui/Button.tsx + .module.css
src/components/ui/IconButton.tsx
src/components/ui/Input.tsx + .module.css
src/components/ui/Select.tsx
src/components/ui/Toggle.tsx
src/components/ui/Tabs.tsx + .module.css
src/components/ui/Card.tsx + .module.css
src/components/ui/Panel.tsx + .module.css
src/components/ui/Modal.tsx + .module.css
src/components/ui/Tooltip.tsx
src/components/ui/Toast.tsx
src/components/ui/ConfirmDialog.tsx
src/components/ui/MaskedSecretInput.tsx
src/components/ui/Icon.tsx              # inlined SVG set
src/components/data/DataTable.tsx + .module.css
src/components/data/Sparkline.tsx
src/components/data/ChangeValue.tsx
src/components/data/PriceValue.tsx
src/components/data/RelativeTime.tsx
src/components/status/Skeleton.tsx + .module.css
src/components/status/EmptyState.tsx
src/components/status/ErrorState.tsx
src/components/status/StaleBanner.tsx
src/components/status/StatusPill.tsx
src/components/status/ProviderBadge.tsx
src/components/status/DisclaimerNote.tsx

src/features/pulse/PulseRoute.tsx
src/features/research/ResearchRoute.tsx        # placeholder in Phase 1
src/features/learn/LearnRoute.tsx              # placeholder in Phase 1
src/features/model-desk/ModelDeskRoute.tsx     # not-configured state
src/features/settings/SettingsRoute.tsx
src/features/settings/AppearancePanel.tsx
src/features/settings/AboutPanel.tsx
src/features/dev/MockControlPanel.tsx          # dev builds only

src/lib/ipc.ts                          # typed invoke wrapper
src/lib/queryClient.ts
src/lib/format.ts                       # Intl-based number/date/relative-time
src/lib/freshness.ts                    # Envelope → panel state
src/lib/keyboard.ts
src/lib/env.ts

src/stores/uiStore.ts
src/stores/paletteStore.ts

src/styles/tokens.css                   # semantic tokens, three themes
src/styles/global.css
src/styles/reset.css

src/types/domain.ts
src/types/envelope.ts
src/types/generated/.gitkeep            # ts-rs output lands here
```

## Rust — `src-tauri/`

```
src-tauri/Cargo.toml
src-tauri/build.rs
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json
src-tauri/icons/.gitkeep                # placeholder until the logo PNG arrives

src-tauri/src/main.rs
src-tauri/src/lib.rs
src-tauri/src/state.rs                  # AppState: pool, providers, governor
src-tauri/src/error.rs                  # AppError + IPC serialization

src-tauri/src/commands/mod.rs
src-tauri/src/commands/market.rs
src-tauri/src/commands/watchlist.rs
src-tauri/src/commands/settings.rs
src-tauri/src/commands/cache.rs

src-tauri/src/db/mod.rs
src-tauri/src/db/pool.rs
src-tauri/src/db/migrations.rs
src-tauri/src/db/repo_assets.rs
src-tauri/src/db/repo_watchlists.rs
src-tauri/src/db/repo_preferences.rs
src-tauri/src/db/repo_cache.rs

src-tauri/src/models/mod.rs
src-tauri/src/models/asset.rs           # ts-rs derives
src-tauri/src/models/quote.rs
src-tauri/src/models/chart.rs
src-tauri/src/models/news.rs
src-tauri/src/models/envelope.rs
src-tauri/src/models/preferences.rs

src-tauri/src/providers/mod.rs          # traits + capabilities
src-tauri/src/providers/registry.rs
src-tauri/src/providers/governor.rs     # rate limit, dedup, backoff
src-tauri/src/providers/cache.rs        # TTL / stale-while-revalidate
src-tauri/src/providers/normalize.rs
src-tauri/src/providers/mock/mod.rs
src-tauri/src/providers/mock/market.rs
src-tauri/src/providers/mock/news.rs

src-tauri/src/security/mod.rs
src-tauri/src/security/secrets.rs       # keyring wrapper, masking
src-tauri/src/security/redact.rs        # log redaction layer

src-tauri/migrations/0001_init.sql

src-tauri/tests/migrations.rs
src-tauri/tests/watchlist_repo.rs
src-tauri/tests/normalize.rs
src-tauri/tests/governor.rs
```

## Content and fixtures

```
content/fixtures/crypto_quotes.json
content/fixtures/stock_quotes.json
content/fixtures/chart_series.json
content/fixtures/news.json
content/fixtures/search_index.json
content/ai/system-prompt.md
content/learn/.gitkeep                  # populated in Phase 4
```

## Tests and CI

```
tests/setup/renderWithProviders.tsx
tests/components/NavRail.test.tsx
tests/components/CommandPalette.test.tsx
tests/components/DataTable.test.tsx
tests/components/themes.test.tsx
tests/lib/format.test.ts
tests/lib/freshness.test.ts
tests/a11y/routes.a11y.test.tsx

.github/workflows/ci.yml
.github/ISSUE_TEMPLATE/bug_report.md
.github/ISSUE_TEMPLATE/feature_request.md
.github/pull_request_template.md
```

**Roughly 150 files.** Deliberately absent from step one: chart library integration, live
provider adapters, crypto/profile code, AI adapters, community adapters, and the Learn content
bundle — each arrives with its own phase.

---

## Where the built scaffold differs from this plan

Recorded after the fact. Three changes, each with a reason:

1. **`src/components/palette/fuzzy.ts` → `src/lib/fuzzy.ts`.** The browser harness needs the same
   matcher for asset search, and `lib/` is the shared home.

2. **`src/features/pulse/queries.ts` → `src/lib/market.ts`, and `src/features/dev/` →
   `src/components/dev/`.** Research Lab needs the market queries and Pulse hosts the dev panel,
   both of which would have been cross-feature imports. The `local/no-cross-feature-import` rule
   caught both on the first lint run, which is exactly what it is for.

3. **`src-tauri/src/security/secrets.rs` deferred to Phase 2.** It wraps the `keyring` crate, and
   Phase 1 has no credential to store. `security/redact.rs` ships now regardless — retrofitting
   log redaction after a key has already been logged is too late.

Added beyond the plan: `docs/PERFORMANCE.md`, `content/fixtures/README.md`,
`src-tauri/icons/README.md`, `eslint-rules/local.js`, `tests/a11y/contrast.test.ts`,
`tests/safety/copy.test.ts`, `tests/lib/fuzzy.test.ts`, `tests/setup/axe.ts`,
`.github/ISSUE_TEMPLATE/config.yml`, `.claude/launch.json`.
