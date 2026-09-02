import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SentimentPanel, valueDaysAgo } from '@/features/compare/SentimentPanel';
import { __resetHarness } from '@/lib/ipc.browser';
import { ipc } from '@/lib/ipc';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';
import type { SentimentIndex } from '@/types/domain';

beforeEach(() => {
  __resetHarness();
});

/**
 * Waits for both cards, not for the panel.
 *
 * The panel renders immediately with a skeleton inside it, so waiting on the region resolves
 * while the readings are still in flight and every assertion afterwards races the query.
 */
async function panel(): Promise<HTMLElement> {
  await waitFor(() => screen.getByRole('article', { name: 'Stocks fear and greed' }), {
    timeout: 4000,
  });
  return screen.getByRole('region', { name: 'Market mood' });
}

function card(name: 'Crypto' | 'Stocks'): HTMLElement {
  return screen.getByRole('article', { name: `${name} fear and greed` });
}

describe('fear and greed', () => {
  it('shows a reading for each market', async () => {
    renderWithProviders(<SentimentPanel />);
    await panel();

    /*
     * Asserted through the gauge's accessible name rather than by searching for the digits.
     * "68" appears twice in the stocks card — it is the composite *and* the volatility
     * component's score — so a bare text query is ambiguous in exactly the way a reader is
     * not: the gauge is labelled with the value and its band together.
     */
    expect(
      within(card('Crypto')).getByRole('meter', { name: 'Crypto: 69 out of 100, Greed' }),
    ).toBeInTheDocument();
    expect(
      within(card('Stocks')).getByRole('meter', { name: 'Stocks: 68 out of 100, Greed' }),
    ).toBeInTheDocument();
  });

  /**
   * The distinction the whole feature turns on. One number is reported from a publisher and one
   * is this app's own arithmetic; a reader who cannot tell them apart is being asked to trust
   * the wrong thing.
   */
  it('says which number was published and which was computed here', async () => {
    renderWithProviders(<SentimentPanel />);
    await panel();

    expect(within(card('Crypto')).getByText('Published figure')).toBeInTheDocument();
    expect(within(card('Stocks')).getByText('Computed here')).toBeInTheDocument();
  });

  it('never shows a bare number without its band in words', async () => {
    renderWithProviders(<SentimentPanel />);
    await panel();

    // Colour alone must never carry the reading — the band is text in both cards.
    expect(within(card('Crypto')).getByText('Greed')).toBeInTheDocument();
    expect(within(card('Stocks')).getByText('Greed')).toBeInTheDocument();
  });

  it('breaks the computed index into components a reader can check', async () => {
    renderWithProviders(<SentimentPanel />);
    await panel();
    // Scoped to the components list: the method disclosure repeats every name.
    const components = within(card('Stocks')).getByRole('list', { name: 'What goes into it' });

    for (const name of [
      'Market momentum',
      'Market volatility',
      'Safe-haven demand',
      'Junk bond demand',
    ]) {
      expect(within(components).getByText(name)).toBeInTheDocument();
    }
    expect(within(components).getAllByRole('listitem')).toHaveLength(4);
  });

  it('states each component as a sentence, not just a score', async () => {
    renderWithProviders(<SentimentPanel />);
    await panel();
    const stocks = card('Stocks');

    expect(within(stocks).getByText(/The S&P 500 is 5.6% above its 125-session average/)).toBeInTheDocument();
    expect(within(stocks).getByText(/The VIX is 9.3% below its 50-session average/)).toBeInTheDocument();
  });

  /**
   * A component that measures fear but scores as greed is not a bug, it is an inversion. The
   * card has to say so, or a VIX above its average sitting next to a score of 68 is unreadable.
   */
  it('flags the components whose direction is flipped', async () => {
    renderWithProviders(<SentimentPanel />);
    await panel();

    const flags = within(card('Stocks')).getAllByText(/higher reading here means more fear/);
    expect(flags).toHaveLength(2);
    expect(within(card('Crypto')).queryByText(/means more fear/)).not.toBeInTheDocument();
  });

  it('names the source series behind every computed component', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SentimentPanel />);
    await panel();
    const stocks = card('Stocks');

    await user.click(within(stocks).getByText('How this number is made'));

    // The FRED series ids, so the reader can go and look at the same data. SP500 feeds two
    // components, so it legitimately appears more than once.
    expect(within(stocks).getAllByText(/SP500/).length).toBeGreaterThan(0);
    expect(within(stocks).getAllByText(/VIXCLS/).length).toBeGreaterThan(0);
    expect(within(stocks).getAllByText(/BAMLH0A0HYM2/).length).toBeGreaterThan(0);
    expect(within(stocks).getAllByText(/BAMLCC0A0CMTRIV/).length).toBeGreaterThan(0);
  });

  it('admits that nobody publishes the computed number', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SentimentPanel />);
    await panel();
    const stocks = card('Stocks');

    await user.click(within(stocks).getByText('How this number is made'));
    expect(within(stocks).getByText(/Nobody publishes this number/)).toBeInTheDocument();
  });

  it('says the crypto index describes Bitcoin rather than all of crypto', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SentimentPanel />);
    await panel();
    const crypto = card('Crypto');

    await user.click(within(crypto).getByText('How this number is made'));
    expect(within(crypto).getByText(/It describes Bitcoin/)).toBeInTheDocument();
  });

  it('carries attribution next to the data, as the provider requires', async () => {
    renderWithProviders(<SentimentPanel />);
    await panel();

    // Alternative.me's own rule is that attribution sits next to the display of the data.
    expect(within(card('Crypto')).getByText(/Mock provider/)).toBeInTheDocument();
    expect(within(card('Stocks')).getByText(/Mock provider/)).toBeInTheDocument();
  });

  it('exposes each score as a meter, not only as a coloured bar', async () => {
    renderWithProviders(<SentimentPanel />);
    await panel();

    // One gauge plus four component meters.
    const meters = within(card('Stocks')).getAllByRole('meter');
    expect(meters).toHaveLength(5);
    expect(meters[0]).toHaveAttribute('aria-valuenow', '68');
    expect(meters[0]).toHaveAttribute('aria-valuemin', '0');
    expect(meters[0]).toHaveAttribute('aria-valuemax', '100');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<SentimentPanel />);
    await panel();

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});

describe('fear and greed when a reading is missing', () => {
  /**
   * Zero is a real value on this scale — maximum fear. An unreachable provider must not be
   * able to render as one, which is why the payload is nullable rather than defaulted.
   */
  it('states the reason instead of drawing a zero', async () => {
    const real = ipc;
    vi.spyOn(await import('@/lib/ipc'), 'ipc').mockImplementation((async (
      command: string,
      args?: unknown,
    ) => {
      if (command === 'get_stock_sentiment') {
        return {
          data: null,
          meta: {
            providerId: 'brew-stock-sentiment',
            providerName: 'Computed by Brew Terminal from FRED',
            fetchedAt: new Date().toISOString(),
            source: 'cache',
            stale: true,
            degraded: {
              reason: 'network',
              retryAfter: null,
              message: 'Could not reach the provider.',
            },
          },
        };
      }
      return (real as (c: string, a?: unknown) => Promise<unknown>)(command, args);
    }) as typeof ipc);

    renderWithProviders(<SentimentPanel />);
    await panel();

    const stocks = card('Stocks');
    expect(within(stocks).getByText(/Could not reach the provider/)).toBeInTheDocument();
    expect(within(stocks).queryByText('0')).not.toBeInTheDocument();
    expect(within(stocks).queryAllByRole('meter')).toHaveLength(0);
    expect(within(stocks).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('valueDaysAgo', () => {
  const day = 86_400;

  function index(history: { time: number; value: number }[], asOf: number): SentimentIndex {
    return {
      market: 'crypto',
      basis: 'published',
      value: 50,
      band: 'neutral',
      asOf,
      publisherLabel: null,
      components: [],
      history,
      methodology: '',
    };
  }

  it('finds the reading at the requested offset', () => {
    const history = Array.from({ length: 31 }, (_, i) => ({ time: i * day, value: i }));
    expect(valueDaysAgo(index(history, 30 * day), 7)).toBe(23);
    expect(valueDaysAgo(index(history, 30 * day), 30)).toBe(0);
  });

  /**
   * Weekends and holidays are gaps in every daily series. Asking for a Sunday must give
   * Friday's reading — a value from the future would be worse than none.
   */
  it('resolves a gap backwards, never forwards', () => {
    const history = [
      { time: 0, value: 10 },
      { time: 5 * day, value: 90 },
    ];
    expect(valueDaysAgo(index(history, 5 * day), 3)).toBe(10);
  });

  it('refuses a comparison the history cannot support', () => {
    const history = [{ time: 10 * day, value: 42 }];
    expect(valueDaysAgo(index(history, 10 * day), 365)).toBeNull();
    expect(valueDaysAgo(index([], 0), 30)).toBeNull();
  });
});
