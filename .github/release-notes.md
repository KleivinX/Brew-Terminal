Local-first market research and learning terminal for crypto and stocks.

**A research tool, not an adviser. Your decisions, and their consequences, are your own.**

## What is new since v0.2.0

A patch release. No new features — this fixes rendering faults that shipped in v0.2.0.

Five CSS custom properties were read by the stylesheets but defined nowhere. CSS discards such
a declaration rather than reporting it, so the styles were simply absent and the result looked
like a deliberately flat design rather than a bug.

- **The screener's column headers are opaque again.** Its sticky header had no background, so
  result rows scrolled straight through the column labels. This was the only one of the five
  that broke behaviour rather than appearance.
- **Raised surfaces are raised.** Thirteen places across the portfolio, screener, compare,
  backtest and settings panels rendered transparent instead of on their own background: the
  portfolio totals and allocation bars, the correlation matrix, the compare chips, the dropdown
  controls, and the inline notices throughout settings.
- **Badge weights.** Four badges inherited their container's medium weight instead of resetting
  to regular.

Checked in all three themes. Two further undefined properties carried fallbacks, so they
rendered correctly while naming nothing any theme could override; they now use real tokens.

A test parses the stylesheets and fails the build on any `var()` naming a property nothing
defines, and on any token present in one theme but missing from another. Both faults are
invisible at runtime by construction, which is how they reached a release.

## Downloads

| Platform                        | File                          |
| ------------------------------- | ----------------------------- |
| macOS (Intel and Apple Silicon) | `.dmg`                        |
| Windows                         | `.msi` or `-setup.exe`        |
| Linux                           | `.AppImage`, `.deb` or `.rpm` |

## Opening it the first time

The app is **not code-signed**, so both macOS and Windows will warn you.

- **macOS** — right-click the app and choose **Open**, then **Open** again. Double-clicking will not offer the option.
- **Windows** — SmartScreen shows "Windows protected your PC". Click **More info** → **Run anyway**.
- **Linux** — `chmod +x` the AppImage before running it.

Signing needs a paid Apple Developer ID and a Windows code-signing certificate. Until those exist the warnings are expected and are not a sign anything is wrong.

## One promise that has an exception

Everywhere else the app makes no request you did not cause. **Price alerts poll in the background**, because an alert that only fires while you are looking at the screen is not an alert. It is off by default, makes no request at all until you both switch it on and arm an alert, and fetches only the assets those alerts name.

## Known limits

- **No live community provider.** The pipeline is complete and opt-in; only a fixture adapter ships, because no discussion platform's terms have been read.
- **Alpha Vantage's free tier is 25 requests a day.** That is why it is used for charts only, never quotes. Cached history makes it go further than it sounds.
- **No hosted AI request has been made with a real key.** A local model has been run end to end and answered; the cloud adapter shares most of that path but has never made a live call.
- **The portfolio has not been reconciled against a broker statement.** The arithmetic is tested, including eight-decimal crypto quantities; agreeing with your exchange's own figures is a different claim and is not made.
- **Guardrails reduce advice-shaped output; they do not eliminate it.** You choose the model, and your model may ignore its instructions.

New to Brew Terminal? The [v0.2.0 notes](https://github.com/KleivinX/Brew-Terminal/releases/tag/v0.2.0) list what the app actually does.

Full detail: [`docs/PRODUCT_SCOPE_V0_1.md`](docs/PRODUCT_SCOPE_V0_1.md), [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) and [`docs/PROVIDERS.md`](docs/PROVIDERS.md).
