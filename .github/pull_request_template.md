## What this changes

<!-- One or two sentences. What is different after this lands? -->

## Why

<!-- The problem, or a link to the issue. -->

## How it was verified

<!-- What you actually ran or clicked. "Tests pass" alone is not enough. -->

- [ ] `npm run check` passes
- [ ] `cargo test` passes
- [ ] `cargo clippy --all-targets -- -D warnings` is clean

## Scope check

- [ ] This does not add trade execution, recommendations, price targets, or portfolio accounting
- [ ] This does not add telemetry, accounts, or cloud sync
- [ ] Nothing new leaves the device without an explicit user action
- [ ] Any new user-facing copy avoids advice-shaped and hype language
- [ ] Any new data display shows its provider and its age

## If this touches the UI

- [ ] Keyboard reachable, focus visible
- [ ] Checked in Dark, Light and Soft
- [ ] Direction/state is not signalled by colour alone
- [ ] Loading, empty, stale and error states all handled

<!-- Screenshots in all three themes, if user-facing. -->

## If this adds a dependency

- [ ] Added to `docs/DEPENDENCIES.md` with a reason and licence
- [ ] Explained here what it replaces, or why hand-rolling is worse
