# Brew Terminal, explained properly

A plain-language tour of what this thing is, what every part of it does, and a few of the
stranger problems that came up building it. No prior finance or programming knowledge assumed.

---

## The short version

**Brew Terminal is a free, open-source desktop app for researching crypto and stocks.**

It looks like a professional trading terminal. It is not one — it never places a trade, never
connects to a broker, and never tells you what to buy. It is for the part that comes _before_
any of that: reading the market, understanding the words, and keeping your own notes.

It runs entirely on your computer. No account. No sign-up. No server that belongs to us. Close
the app and nothing of yours is anywhere else.

## The one idea everything else hangs off

Open almost any finance app and you see a number. Bitcoin: $67,412.

Where did that come from? Which exchange? Was it a minute ago or an hour? Is it an average of
several sources, and if so, which ones, weighted how?

You cannot tell. And that turns out to matter, because the number is doing a lot of work in your
head and you have no way to check it.

**Brew Terminal never shows a number without saying who produced it and how long ago.** Not in a
settings page, not in a tooltip — right there, next to it, every time.

That is not a feature bolted on. It is enforced by how the app is built: data physically cannot
reach the screen without its source and timestamp attached. A developer who wanted to hide that
would have to go out of their way.

Everything below is downstream of that one decision.

---

## What is in it, screen by screen

### Pulse — the front page

What moved today, what you follow, what is worth reading.

The nicest bit is the digest: **"since you last looked."** Instead of dropping you into a wall of
numbers, it tells you what actually changed since your last visit — the big movers, whether the
market mood shifted, how many headlines you have not read.

### Atlas — a live ticker

Prices refreshing every 90 seconds for everything on your watchlist.

Here is an honest thing the app does that most do not. **Real-time market data is expensive and
licensed.** No free data source will let you stream prices continuously. So rather than pretend,
Atlas says "at most 90 seconds old" on screen, and shows which free source is currently answering
and how much of its daily allowance is left.

Behind that is a small piece of machinery that rotates between providers, counts every request,
and backs off politely when one says "enough." When a source is spent it steps aside and says so
instead of quietly showing you stale numbers.

### Sentry — the world map

This is the one that surprises people.

A dark world map with the things that physically move global trade: the **straits, canals and
ports** most goods pass through — Hormuz, Malacca, Suez, Panama, Rotterdam, Shanghai — plus live
earthquakes, live severe weather warnings, and each major economy's inflation, growth, debt and
unemployment.

It tells you when a hazard is near a chokepoint: _"magnitude 6.1, 140 km from the Port of
Kaohsiung."_

And then it stops. It does not tell you shipping will be delayed, or what that means for prices,
because it genuinely does not know. It gives you a fact and a distance, both checkable, and
leaves the thinking to you. That restraint took more work than the feature did.

### Connectors — the honest catalogue

A list of roughly a hundred places the app could get data from.

Eleven of them are actually wired up, and each one has a full record: rate limits, licence, what
attribution is required, what the terms permit.

About ninety are listed with **a name, a category, and nothing else** — no rate limit, no risk
rating, no licence — because nobody has read those providers' terms yet, and putting a
plausible-looking number next to a name would be inventing knowledge.

There is a test that fails the build if one of those unreviewed entries ever acquires a rate
limit. The honesty is enforced, not merely intended.

### Research Lab — one asset, in depth

Chart, key figures, news, and your own notes about it, side by side.

There is a risk checklist — but with no checkboxes and no score. Ticking boxes produces a number,
a number feels like a verdict, and a verdict is exactly what this app has no business giving. The
questions are there to make you think, not to be answered by software.

### Screener — filter the market

Filter by price, change, market cap, volume. Facts only.

No "top opportunities," no rankings, no proprietary scores. Those are opinions dressed as
arithmetic.

### Compare — several things at once

Up to six assets or economic series on one chart, plus a correlation grid.

The grid comes with a plain warning about what correlation is not, because "these two moved
together" is the single easiest statistic in finance to misread.

### Portfolio — what you hold

You type in what you bought and when. It works out cost basis, realised gains, and how each
position has actually done.

A small design decision with a big payoff: positions are never stored. They are recalculated from
your transactions every time. That means your holdings and your transaction history **cannot
disagree with each other** — the usual source of "why does this number look wrong?"

No broker connection. No account access. It sees nothing you have not typed.

### Notes — your research journal

Write down what you thought and why. Full-text search. Pin a note to a date and it appears on the
chart at that point, so "what was I thinking in March" has an answer.

Notes never leave your machine on their own.

### Learn — the glossary and the paths

Fifty terms and five guided paths, written for someone who has never read a balance sheet. Ships
inside the app — reading it makes no network request at all.

### Model Desk — optional AI, off by default

You can connect an AI model. You do not have to, and it is off until you turn it on.

If you do: you can run a model entirely on your own computer, in which case nothing leaves it. Or
use your own API key with a hosted one. Either way, **before anything is sent you get an itemised
list of exactly what would go** — this note, that price, this article — and every send is written
to a local log you can read and delete.

The AI also cannot fetch data itself. It has to ask the app, which fetches through the normal
path, so anything it shows you still arrives with its source and age attached.

### Settings — providers, keys, privacy

Every data source, every API key, every privacy control in one place. API keys go into your
operating system's own password store, never into the app's database or any export file.

---

## The promises, in one place

- **Local-first.** One file on your computer holds everything. No account, no cloud.
- **No telemetry.** The app makes no request you did not cause. One exception, stated plainly: price alerts poll in the background, and they are off until you switch them on.
- **No hidden sources.** Only documented public APIs whose terms have been read. No scraping. No reverse-engineered endpoints — including ones that would work.
- **No verdicts.** No buy/sell/hold, no scam scores, no "trending." Where the app computes something itself, it shows the inputs and the arithmetic.
- **Portable.** Export everything to an encrypted file and move it to another machine. The file contains no API keys.
- **Free and open.** AGPL-3.0. Read every line.

---

## Three problems that were more interesting than expected

A few things from the build that say something about how this kind of software actually goes.

### The 1990 German debt figure

The World Bank has a wonderfully convenient API setting: _give me the most recent value you have._

The map used it for national debt. It looked perfect.

Then a test compared Germany's number against reality. The app was showing **20.9% of GDP** — the
most recent figure the World Bank held for Germany. From **1990**. The real number today is
roughly three times that.

The setting does exactly what it says: most recent _available_. It just does not mention that for
some countries "most recent" means thirty-six years ago. Displayed in a tidy row next to 2025
inflation, it was a completely convincing lie.

The fix: every figure now carries its own year, on screen, and anything over five years old is
dropped entirely. The scorecard shows one fewer row rather than one wrong one.

The lesson is the uncomfortable one — that was not a bug in anyone's code. Everything worked as
documented. It was a bug in what the number _appeared to mean_.

### The triptych that was secretly the hero

While making the graphics for this project's front page, the script produced two images: a big
header, and a three-panel feature strip.

The header was right. The feature strip was... a second copy of the header. Correct size, correct
file name, and every "is this finished loading?" check passing.

Chrome blocks pages from navigating to a certain kind of inline address for security reasons. The
first image slipped through on a technicality. The second was silently refused — no error, no
warning — so the browser simply kept showing the previous page and dutifully photographed it.

Every check the script ran was asking about the _old_ page, and the old page was perfectly fine.

The fix was to stop asking the browser to navigate and start handing it the content directly. But
the real fix was the realisation that "all my checks passed" and "the thing is correct" are
different statements, and only one of them was ever verified.

### The accessibility bug the test suite could not see

There is an automated test that checks colour contrast — whether text is readable against its
background — using the app's own colour definitions. It passed.

Then the same check was run in a real browser, on the real screen, and found **eight failures**.

The test was checking the colours against the _app's_ background. Several parts of the new screens
sit on a slightly lighter panel, and against that one grey text colour dropped below the readable
threshold. The test had no idea those combinations existed, because nobody had told it to look.

Both were fixed — the colours, and the test, which now knows about the lighter surfaces too. And
the trap itself is recorded as a test: if that grey ever becomes safe on those panels, a test
fails and tells you the note about it can come down.

---

## The bit that will not be automated away

None of this is technically exotic. The map is drawn without a mapping library. The data sources
are public and free. Any competent developer could build the features.

The part that took the work was deciding, over and over, **what not to show**.

Not to compute a risk score. Not to say a chokepoint is "at risk." Not to fill a hundred table
rows with plausible-looking rate limits. Not to let a thirty-six-year-old number sit in a row that
implies it is current.

Every one of those would have made the app look more capable. Every one would have been a small
lie, of the kind that is very hard to catch and very easy to believe.

The whole thing is really one idea, applied stubbornly: **show the number, show where it came
from, and do not pretend to know more than you do.**

---

**Brew Terminal** · AGPL-3.0 · macOS, Windows, Linux
[github.com/KleivinX/Brew-Terminal](https://github.com/KleivinX/Brew-Terminal)

_A research tool, not an adviser. Not financial advice. Your decisions, and their consequences,
are your own._
