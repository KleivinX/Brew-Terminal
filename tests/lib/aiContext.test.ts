import { describe, expect, it } from 'vitest';
import { describeQuote, describeSentiment } from '@/lib/aiContext';
import type { Quote, SentimentIndex } from '@/types/domain';
import type { EnvelopeMeta } from '@/types/envelope';

const meta = (overrides: Partial<EnvelopeMeta> = {}): EnvelopeMeta => ({
  providerId: 'coingecko',
  providerName: 'CoinGecko',
  fetchedAt: '2026-09-02T18:11:00Z',
  source: 'live',
  stale: false,
  degraded: null,
  ...overrides,
});

const quote: Quote = {
  assetId: 'crypto:cg:bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  assetType: 'crypto',
  price: 77431,
  currency: 'USD',
  changePct24h: 0.48,
  changePct7d: -0.8,
  marketCap: 1_550_000_000_000,
  volume24h: 29_280_000_000,
  sparkline: [],
};

const sentiment: SentimentIndex = {
  market: 'stocks',
  basis: 'computed',
  value: 68,
  band: 'greed',
  asOf: 1_788_177_600,
  publisherLabel: null,
  components: [
    {
      id: 'volatility',
      name: 'Market volatility',
      description: 'How much movement the options market expects.',
      score: 68,
      band: 'greed',
      rawValue: -9.293,
      rawUnit: '%',
      reading: 'The VIX is 9.3% below its 50-session average.',
      sourceSeries: ['VIXCLS'],
      method: 'VIX divided by its 50-session average, then inverted.',
      inverted: true,
    },
  ],
  history: [],
  providerHistorySince: null,
  methodology: 'Computed here from public Federal Reserve series.',
};

describe('describeQuote', () => {
  it('carries the figures the page is showing', () => {
    const text = describeQuote(quote, meta());
    expect(text).toContain('BTC (Bitcoin)');
    expect(text).toContain('77431 USD');
    expect(text).toContain('+0.48%');
    expect(text).toContain('-0.80%');
  });

  /**
   * The rule the whole app is built on. A price with no provider and no timestamp invites a
   * model to treat it as current and authoritative — exactly the failure this avoids.
   */
  it('never describes a number without its provider and its age', () => {
    const text = describeQuote(quote, meta());
    expect(text).toContain('CoinGecko');
    expect(text).toContain('2026-09-02T18:11:00Z');
  });

  it('says so when the reading is stale or degraded', () => {
    const text = describeQuote(
      quote,
      meta({ stale: true, degraded: { reason: 'network', retryAfter: null, message: 'x' } }),
    );
    expect(text).toContain('stale');
    expect(text).toContain('network');
  });

  it('omits a figure the provider did not give rather than inventing a zero', () => {
    const partial: Quote = { ...quote, marketCap: null, volume24h: null, changePct7d: null };
    const text = describeQuote(partial, meta());
    expect(text).not.toContain('Market cap');
    expect(text).not.toContain('7d change');
    expect(text).toContain('24h change');
  });

  /**
   * A model handed 750 price points will describe a shape and call it a trend. The attachment
   * is the figures already on screen, nothing more.
   */
  it('does not attach the price history', () => {
    const withSpark: Quote = { ...quote, sparkline: [1, 2, 3, 4, 5] };
    const text = describeQuote(withSpark, meta());
    expect(text).not.toContain('1,2,3');
    expect(text.split('\n').length).toBeLessThan(12);
  });
});

describe('describeSentiment', () => {
  it('leads with the reading and its band', () => {
    const text = describeSentiment(sentiment, meta({ providerName: 'Computed by Brew Terminal' }));
    expect(text).toContain('Stocks Fear & Greed: 68/100 (greed)');
  });

  /**
   * The distinction the sentiment feature turns on: a reported figure and one this app computed
   * carry different warranties, and a model should not have to guess which it was handed.
   */
  it('says whether the number was computed here or published elsewhere', () => {
    expect(describeSentiment(sentiment, meta())).toContain('computed by Brew Terminal');

    const published: SentimentIndex = {
      ...sentiment,
      basis: 'published',
      market: 'crypto',
      components: [],
      publisherLabel: 'Greed',
    };
    const text = describeSentiment(published, meta({ providerName: 'Alternative.me' }));
    expect(text).toContain('published by the provider');
    expect(text).toContain('The publisher labels this "Greed"');
  });

  it('attaches every component with its reading, method and source series', () => {
    const text = describeSentiment(sentiment, meta());
    expect(text).toContain('Market volatility: 68/100');
    expect(text).toContain('The VIX is 9.3% below its 50-session average.');
    expect(text).toContain('VIXCLS');
    expect(text).toContain('Method:');
  });

  /**
   * Without this a model reading "VIX above average" next to a score of 68 has no way to
   * reconcile them, and will confidently explain the contradiction it thinks it sees.
   */
  it('flags an inverted component', () => {
    expect(describeSentiment(sentiment, meta())).toContain('a higher reading means more fear');
  });

  it('carries provenance like every other attachment', () => {
    const text = describeSentiment(sentiment, meta({ providerName: 'Computed by Brew Terminal' }));
    expect(text).toContain('Computed by Brew Terminal');
    expect(text).toContain('2026-09-02T18:11:00Z');
  });
});
