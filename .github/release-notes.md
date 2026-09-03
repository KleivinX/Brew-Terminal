Local-first market research and learning terminal for crypto and stocks.

**A research tool, not an adviser. Your decisions, and their consequences, are your own.**

## What is new since v0.2.1

Two new screens, one new way to use the optional model, and a provider that turned out to have
been broken since v0.2.0.

### Market mood — two Fear & Greed indices

The crypto one is a **published figure**, fetched from Alternative.me and reported as it stands.
It describes Bitcoin, which the rest of the market usually but does not always follow, and the
card says so.

The equity one is **computed here**, from five public Federal Reserve series, because no free and
documented equity index exists to report. Four components — market momentum, market volatility,
safe-haven demand and junk bond demand — each scored by where today's reading falls among the
last 252 sessions, combined as an equal-weighted mean.

Every component is shown with its raw reading, the arithmetic that produced it, the source series
and whether it was inverted. The composite can be recomputed by hand from the same public data.
The rule this follows is not "no scores" but **no score whose inputs are hidden** — the reasoning
is recorded in ADR-037.

### Notes — a workspace for what you wrote down

Notes existed before, but only attached to an asset, which meant a note about nothing in
particular was unreachable the moment it was written. There is now a route for all of them: a
list to scan, an editor to type in, full-text search across titles and bodies, and the open note
in the URL so it survives a reload and can be linked to.

Notes stay on this computer. Attaching one to a model prompt remains a separate, explicit action.

### Ask a model about what you are looking at

The Model Desk could previously only be handed a glossary term. The Research Lab and the market
mood panel can now hand it what is on screen — an asset snapshot, or a sentiment reading with all
four of its components.

The consent flow is unchanged: one dialog showing the exact text before it moves, the desk's own
pre-send panel itemising it again, and a local log of what was sent. Two rules the attachments
follow, both enforced by tests — **no figure travels without its provider and its age**, and no
price history goes with it.

Off by default, like the rest of the desk.

### Fixes

- **FRED was unreachable, and had been since v0.2.0.** It sits behind a filter that drops the
  connection for a bare `Name/Version` user agent — no status code, no error, just a hang until
  the timeout. Every macro series and every input to the equity sentiment index was failing this
  way. The app now identifies itself with a contact URL, which is the convention such filters
  ask for.
- **Positions no longer show floating-point noise.** Buying 0.25 of something and then 0.1 more
  left `0.35000000000000003` in the quantity column. A realised gain of nothing rendered as
  `$0.00000000`.
- **The real logo** replaces the placeholder letter in the sidebar.
- **Navigation matches the sidebar again.** `Cmd/Ctrl+1`–`9` had drifted to the five routes that
  existed when the shortcut map was written, and Portfolio, Screener and Compare were reachable
  only by mouse — no shortcut and no command palette entry.
- **Compare stopped clipping its panels.** Its layout let them shrink below their own content
  instead of scrolling, silently cutting off the bottom of each one.

### Under the hood

- Screenshots in the README.
- One command (`npm run check`) that runs what CI runs, plus a pre-commit hook that catches
  formatting before the build does.
