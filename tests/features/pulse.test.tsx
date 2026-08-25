import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PulseRoute } from '@/features/pulse/PulseRoute';
import { MarketTable } from '@/features/pulse/MarketTable';
import { __harnessCallCount } from '@/lib/ipc.browser';
import type { Quote } from '@/types/domain';
import { renderWithProviders } from '../setup/renderWithProviders';

async function waitForTable(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole('grid', { name: /market table/ }), { timeout: 4000 });
}

/**
 * Scoped to the Markets tablist. The news filter has tabs with the same labels ("Crypto",
 * "Stocks"), so an unscoped query is genuinely ambiguous.
 */
function marketTab(name: RegExp): HTMLElement {
  return within(screen.getByRole('tablist', { name: 'Market view' })).getByRole('tab', { name });
}

describe('Pulse — market data', () => {
  it('renders the crypto table from the provider', async () => {
    renderWithProviders(<PulseRoute />);
    const table = await waitForTable();

    expect(within(table).getByText('BTC')).toBeInTheDocument();
    expect(within(table).getByText('ETH')).toBeInTheDocument();
  });

  it('shows the provider and the age of the data', async () => {
    // No number renders without its provenance.
    renderWithProviders(<PulseRoute />);
    await waitForTable();

    expect(screen.getAllByText(/Mock provider/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/updated/i).length).toBeGreaterThan(0);
  });

  it('issues one batched quotes call for the whole watchlist, not one per row', async () => {
    /*
     * The regression this guards against would be invisible on screen and would quietly
     * exhaust a provider's request budget. The IPC contract has no single-quote command, so
     * an N+1 cannot be written by accident — this asserts the property holds end to end.
     */
    const user = userEvent.setup();
    renderWithProviders(<PulseRoute />);
    await waitForTable();

    const before = __harnessCallCount('get_quotes');

    await user.click(marketTab(/Watchlist/));
    await waitFor(() => {
      expect(screen.getByRole('grid', { name: /watchlist market table/ })).toBeInTheDocument();
    });

    const table = screen.getByRole('grid', { name: /watchlist market table/ });
    const rows = within(table).getAllByRole('row').length - 1;
    expect(rows).toBeGreaterThan(1);

    const calls = __harnessCallCount('get_quotes') - before;
    expect(calls).toBeLessThanOrEqual(2);
    expect(calls).toBeLessThan(rows);
  });

  it('filters visible rows without issuing a request', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PulseRoute />);
    await waitForTable();

    const before = __harnessCallCount('get_market_list');
    await user.type(screen.getByLabelText(/filter the assets shown/i), 'sol');

    await waitFor(() => {
      const table = screen.getByRole('grid', { name: /market table/ });
      expect(within(table).getByText('SOL')).toBeInTheDocument();
      expect(within(table).queryByText('BTC')).not.toBeInTheDocument();
    });

    expect(__harnessCallCount('get_market_list')).toBe(before);
  });

  it('explains an empty filter result rather than showing a blank table', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PulseRoute />);
    await waitForTable();

    await user.type(screen.getByLabelText(/filter the assets shown/i), 'zzzzqqq');

    await waitFor(() => {
      expect(screen.getByText(/Nothing matches that filter/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /clear filter/i })).toBeInTheDocument();
  });

  it('switches between crypto and stocks', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PulseRoute />);
    await waitForTable();

    await user.click(marketTab(/Stocks/));

    await waitFor(() => {
      const table = screen.getByRole('grid', { name: /stocks market table/ });
      expect(within(table).getByText('AAPL')).toBeInTheDocument();
    });
  });
});

describe('Pulse — watchlist', () => {
  it('adds and removes an asset through the star control', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PulseRoute />);
    await waitForTable();

    const add = await screen.findByRole('button', { name: /Add SOL to watchlist/ });
    await user.click(add);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Remove SOL from watchlist/ })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Remove SOL from watchlist/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add SOL to watchlist/ })).toBeInTheDocument();
    });
  });

  it('offers watchlist management only on the watchlist tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PulseRoute />);
    await waitForTable();

    expect(screen.queryByLabelText(/active watchlist/i)).not.toBeInTheDocument();

    await user.click(marketTab(/Watchlist/));
    await waitFor(() => {
      expect(screen.getByLabelText(/active watchlist/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /new watchlist/i })).toBeInTheDocument();
  });

  it('refuses to delete the default watchlist', async () => {
    // "Add to watchlist" must always have somewhere to go.
    const user = userEvent.setup();
    renderWithProviders(<PulseRoute />);
    await waitForTable();

    await user.click(marketTab(/Watchlist/));
    const del = await screen.findByRole('button', { name: /delete watchlist/i });
    expect(del).toBeDisabled();
  });

  it('creates a new watchlist and switches to it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PulseRoute />);
    await waitForTable();

    await user.click(marketTab(/Watchlist/));
    await user.click(await screen.findByRole('button', { name: /new watchlist/i }));

    const input = await screen.findByLabelText('Name');
    await user.type(input, 'Crypto majors');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      const select = screen.getByLabelText(/active watchlist/i) as HTMLSelectElement;
      expect([...select.options].some((o) => o.text === 'Crypto majors')).toBe(true);
    });
  });

  it('shows the watchlist in the order the user set, not provider order', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PulseRoute />);
    await waitForTable();

    await user.click(marketTab(/Watchlist/));
    const table = await waitFor(() => screen.getByRole('grid', { name: /watchlist market table/ }));

    const before = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent ?? '');
    expect(before[0]).toContain('BTC');

    await user.click(screen.getByRole('button', { name: /Move BTC down/ }));

    await waitFor(() => {
      const rows = within(screen.getByRole('grid', { name: /watchlist market table/ }))
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.textContent ?? '');
      expect(rows[0]).not.toContain('BTC');
    });
  });

  it('teaches the next action when the watchlist is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PulseRoute />);
    await waitForTable();

    await user.click(marketTab(/Watchlist/));
    await waitFor(() => screen.getByRole('grid', { name: /watchlist market table/ }));

    for (const symbol of ['BTC', 'ETH', 'AAPL']) {
      const button = await screen.findByRole('button', {
        name: new RegExp(`Remove ${symbol} from watchlist`),
      });
      await user.click(button);
    }

    await waitFor(() => {
      expect(screen.getByText(/Your watchlist is empty/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Add your first asset/i)).toBeInTheDocument();
  });
});

describe('MarketTable virtualization', () => {
  function makeQuotes(count: number): Quote[] {
    return Array.from({ length: count }, (_, i) => ({
      assetId: `crypto:cg:coin${i}`,
      symbol: `C${i}`,
      name: `Coin ${i}`,
      assetType: 'crypto' as const,
      price: 100 + i,
      currency: 'USD',
      changePct24h: i % 2 === 0 ? 1.5 : -1.5,
      changePct7d: 2.5,
      marketCap: 1_000_000 + i,
      volume24h: 500_000 + i,
      sparkline: [1, 2, 3, 4, 5],
    }));
  }

  it('keeps the DOM bounded for a 500-row table', () => {
    /*
     * This is the mechanism behind the scroll-performance budget: only the visible window
     * exists in the DOM. Frame rate cannot be measured meaningfully in jsdom, but the node
     * count that determines it can — and dropping virtualization is exactly what would tank
     * scrolling on the reference machine.
     */
    renderWithProviders(
      <MarketTable
        quotes={makeQuotes(500)}
        label="large market table"
        watchedAssetIds={new Set()}
        onToggleWatch={() => {}}
      />,
    );

    const table = screen.getByRole('grid', { name: 'large market table' });
    const rendered = within(table).getAllByRole('row').length - 1;

    expect(rendered).toBeLessThan(60);
    expect(rendered).toBeGreaterThan(0);
  });

  it('reports the full row count to assistive tech even though rows are windowed', () => {
    renderWithProviders(
      <MarketTable
        quotes={makeQuotes(500)}
        label="large market table"
        watchedAssetIds={new Set()}
        onToggleWatch={() => {}}
      />,
    );

    expect(screen.getByRole('grid', { name: 'large market table' })).toHaveAttribute(
      'aria-rowcount',
      '500',
    );
  });
});
