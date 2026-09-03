import type { Quote, SentimentIndex } from '@/types/domain';
import type { EnvelopeMeta } from '@/types/envelope';

/**
 * The text the app hands to the Model Desk when you ask about something on screen.
 *
 * Pure functions, kept out of the components, for two reasons. They are the exact bytes that
 * may leave the device, so they belong somewhere they can be read and tested directly rather
 * than assembled inline in JSX. And every one of them carries the provenance of what it
 * describes: a price with no provider and no timestamp invites a model to reason about a number
 * as though it were current and authoritative, which is the failure mode this whole app is
 * built to avoid.
 *
 * Nothing here reaches for data the caller did not already have on screen. The rule in
 * AI_POLICY.md §2 is that the user sees what leaves; a summariser that quietly pulled in the
 * watchlist or the note history would break that regardless of what the dialog then displayed.
 */

/** Reads as "as reported by CoinGecko, retrieved 2026-09-02T18:11:00Z". */
function provenance(meta: EnvelopeMeta): string {
  const parts = [`as reported by ${meta.providerName}`, `retrieved ${meta.fetchedAt}`];
  if (meta.stale) parts.push('this reading is stale');
  if (meta.degraded) parts.push(`degraded: ${meta.degraded.reason}`);
  return parts.join(', ');
}

function signed(value: number, digits = 2): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

/**
 * A single asset, as the Research Lab is showing it.
 *
 * Deliberately not the chart series. A model given 750 price points will happily describe a
 * shape and call it a trend, and the point of this app is not to manufacture that. The figures
 * here are the ones already rendered on the page.
 */
export function describeQuote(quote: Quote, meta: EnvelopeMeta): string {
  const lines = [
    `${quote.symbol} (${quote.name}) — ${quote.assetType}`,
    `Price: ${quote.price} ${quote.currency}`,
  ];

  if (quote.changePct24h !== null) lines.push(`24h change: ${signed(quote.changePct24h)}%`);
  if (quote.changePct7d !== null) lines.push(`7d change: ${signed(quote.changePct7d)}%`);
  if (quote.marketCap !== null) lines.push(`Market cap: ${quote.marketCap} ${quote.currency}`);
  if (quote.volume24h !== null) lines.push(`24h volume: ${quote.volume24h} ${quote.currency}`);

  lines.push(`Source: ${provenance(meta)}.`);
  return lines.join('\n');
}

/**
 * A Fear & Greed reading, with its components where it has them.
 *
 * The components are the reason this is worth attaching at all. A model handed "sentiment is
 * 68" can only paraphrase it; handed the four inputs, the raw readings and which were inverted,
 * it has something to actually explain. It is also the honest shape of the number — the app's
 * own position is that a composite whose inputs are hidden is not worth showing, and that
 * applies to what it hands a model as much as to what it puts on screen.
 */
export function describeSentiment(index: SentimentIndex, meta: EnvelopeMeta): string {
  const market = index.market === 'crypto' ? 'Crypto' : 'Stocks';
  const basis =
    index.basis === 'computed'
      ? 'computed by Brew Terminal from public source series, not published by anyone'
      : 'a figure published by the provider and reported as-is';

  const lines = [
    `${market} Fear & Greed: ${index.value}/100 (${index.band.replace('-', ' ')})`,
    `Basis: ${basis}.`,
  ];

  if (index.publisherLabel) lines.push(`The publisher labels this "${index.publisherLabel}".`);

  if (index.components.length > 0) {
    lines.push('', 'Components:');
    for (const c of index.components) {
      const inverted = c.inverted ? ' [inverted: a higher reading means more fear]' : '';
      lines.push(
        `- ${c.name}: ${c.score}/100${inverted}`,
        `  ${c.reading}`,
        `  Method: ${c.method}`,
        `  Source series: ${c.sourceSeries.join(', ')}`,
      );
    }
  }

  lines.push('', `Methodology: ${index.methodology}`, `Source: ${provenance(meta)}.`);
  return lines.join('\n');
}
