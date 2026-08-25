# Contributing to Brew Terminal

Thanks for considering it. This document covers what the project expects, and — just as
importantly — what it will not accept, so nobody wastes an afternoon on a PR that cannot land.

## Before you start

For anything beyond a small fix, open an issue first. Brew Terminal has a deliberately narrow
scope, and the fastest way to have work rejected is to build something the project has already
decided not to do. [`docs/PRODUCT_SCOPE_V0_1.md`](docs/PRODUCT_SCOPE_V0_1.md) lists the
non-goals explicitly.

## What will not be merged, regardless of quality

These are product decisions, not gaps:

- Trade execution, brokerage connections, or anything that moves money
- Buy/sell/hold recommendations, price targets, allocation advice, or entry/exit timing
- Portfolio accounting, holdings tracking, or P&L
- Telemetry, analytics, crash reporting, or any phone-home that is on by default
- User accounts or cloud sync
- "Scam scores", legitimacy verdicts, or sentiment classification presented as fact
- Anything that sends user data anywhere without an explicit, per-action user decision
- Language implying certainty about future prices

If you think one of these should change, open an issue and argue the case. Do not open a PR.

## Setup

```bash
npm install
npm run tauri:dev
```

`npm run dev` runs the UI in a browser against fixtures — a much faster loop, and it does not
need a Rust rebuild.

## Before you push

```bash
npm run check                  # format, lint, typecheck, frontend tests
cd src-tauri && cargo test     # Rust tests
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo fmt --check
```

CI runs all of this on macOS, Windows and Linux.

## Standards

**TypeScript.** Strict mode, no avoidable `any`. Every `any` and every `eslint-disable` needs a
comment explaining why it is unavoidable.

**Rust.** `cargo fmt`, clippy clean. Provider responses are untrusted input — validate before
normalizing.

**Feature slices do not import each other.** `src/features/a` may not import from
`src/features/b`; shared code moves down into `lib/` or `components/`. The
`local/no-cross-feature-import` rule enforces this.

**Copy.** Clear, calm, never hype. The `local/no-banned-copy` rule blocks advice-shaped and
hype language. Data always shows its provider and its age.

**Accessibility is not optional.** Keyboard reachable, focus visible, contrast verified
(`tests/a11y/contrast.test.ts` checks the token values numerically). Direction is never
signalled by colour alone.

**Tests.** New provider normalization, database operations, freshness logic and safety filtering
need tests. UI changes need at least a render-and-interact test.

**Dependencies.** Adding one needs a line in [`docs/DEPENDENCIES.md`](docs/DEPENDENCIES.md) and
a note in the PR saying what it replaces or why hand-rolling is worse.

## Commits and PRs

Present-tense, imperative subjects: "Add stale banner to news panel". Keep PRs focused — one
concern each. In the description, say what changed, why, and how you verified it. If you
changed something user-facing, include a screenshot in each of the three themes.

Contributions are made under the project's AGPL-3.0-or-later licence.

## Contributor licence agreement

The project may adopt a CLA later, which would be required for future dual licensing. There is
no CLA today, and nothing here should be read as one. If one is introduced, it will be
announced before it applies, and it will not be applied retroactively to contributions already
merged. Commits are tracked with sign-off from the start so that the provenance of every
contribution is clear if that day comes.

## Adding a data provider

1. Read the provider's terms first. Record attribution requirements, rate limits, whether desktop-client use is permitted, and whether caching is permitted, in `docs/PROVIDERS.md`.
2. No scraping, and no undocumented endpoints, even where they work. That is a decision about the project's standing, not a technical limit.
3. Implement the trait in `src-tauri/src/providers/`, declare accurate `ProviderCapabilities`, and validate every field before normalizing.
4. Add tests using recorded fixtures, not live calls.
5. Never commit a key. Credentials belong in the OS keychain.

## Two areas that need extra care

**The Model Desk.** `docs/AI_POLICY.md` is the specification, and §7 maps every requirement to
the test that enforces it. Three things in particular are load-bearing:

- The system prompt in `content/ai/system-prompt.md` is compiled in with `include_str!` and a
  test asserts it matches AI_POLICY.md §4 byte for byte. `content/ai/` is prettier-ignored
  because reformatting it changes what is transmitted.
- `assemble_messages` is the only thing that decides what a request contains. The pre-send
  preview and the send both call it, which is what makes the character count shown to the user
  true. Do not add a second path.
- Plain HTTP is permitted only for a host that resolves to loopback (ADR-029). If you find
  yourself relaxing that, stop and open an issue.

**The `.brewprofile` envelope.** `src-tauri/src/security/profile.rs` implements the construction
in THREAT_MODEL.md §6.1. No cryptography is written by hand here and none should be — these are
RustCrypto primitives used as intended. Changes that affect the file format need a `format_ver`
bump and a test that an old file still opens. Changes that affect the _order_ of operations in
`services/profile.rs` need care too: authenticate, validate, back up, write, in that order, so a
bad file costs the user nothing.

## Reporting bugs

Include your OS and version, the app version, what you expected, what happened, and steps to
reproduce. **Never paste an API key** — redact it.

Security issues go to [SECURITY.md](SECURITY.md), not the public tracker.
