Local-first market research and learning terminal for crypto and stocks.

**A research tool, not an adviser. Your decisions, and their consequences, are your own.**

## What is new since v0.1.0

- **Real news.** RSS/Atom feeds you configure, seeded with four public ones. v0.1.0 shipped fixture headlines presented as live data — that is fixed, and the fixture provider is deleted rather than disabled.
- **Portfolio.** Holdings, cost basis (FIFO or average — your choice, because the right answer depends where you file), realised and unrealised gain, allocation.
- **Screener.** Filter the market on your own criteria. No presets, no scores.
- **Indicators.** SMA, EMA, RSI, MACD and Bollinger bands, computed locally — switching one on makes no request.
- **Stock charts.** Equities finally have history, via Alpha Vantage.
- **Compare.** Several assets indexed to one axis, a correlation matrix over daily returns, and a macro backdrop from FRED that needs no API key at all.
- **Price alerts.** Off by default — see below.
- **Backtest.** What a regular contribution would have done, over history that already happened.
- **Run a model locally.** The app can fetch an inference engine and open-weight model and run it on `127.0.0.1`, verified against published checksums.

## Downloads

| Platform | File |
| -------- | ---- |
| macOS (Intel and Apple Silicon) | `.dmg` |
| Windows | `.msi` or `-setup.exe` |
| Linux | `.AppImage`, `.deb` or `.rpm` |

## Opening it the first time

The app is **not code-signed**, so both macOS and Windows will warn you.

- **macOS** — right-click the app and choose **Open**, then **Open** again. Double-clicking will not offer the option.
- **Windows** — SmartScreen shows "Windows protected your PC". Click **More info** → **Run anyway**.
- **Linux** — `chmod +x` the AppImage before running it.

Signing needs a paid Apple Developer ID and a Windows code-signing certificate. Until those exist the warnings are expected and are not a sign anything is wrong.

## One promise that now has an exception

Everywhere else the app makes no request you did not cause. **Price alerts poll in the background**, because an alert that only fires while you are looking at the screen is not an alert. It is off by default, makes no request at all until you both switch it on and arm an alert, and fetches only the assets those alerts name.

## Known limits

- **No live community provider.** The pipeline is complete and opt-in; only a fixture adapter ships, because no discussion platform's terms have been read.
- **Alpha Vantage's free tier is 25 requests a day.** That is why it is used for charts only, never quotes. Cached history makes it go further than it sounds.
- **No hosted AI request has been made with a real key.** A local model has been run end to end and answered; the cloud adapter shares most of that path but has never made a live call.
- **The portfolio has not been reconciled against a broker statement.** The arithmetic is tested, including eight-decimal crypto quantities; agreeing with your exchange's own figures is a different claim and is not made.
- **Guardrails reduce advice-shaped output; they do not eliminate it.** You choose the model, and your model may ignore its instructions.

Full detail: [`docs/PRODUCT_SCOPE_V0_1.md`](docs/PRODUCT_SCOPE_V0_1.md), [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) and [`docs/PROVIDERS.md`](docs/PROVIDERS.md).
