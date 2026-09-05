import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtlasRoute } from '@/features/atlas/AtlasRoute';
import { AtlasStatusLine } from '@/features/atlas/AtlasStatusLine';
import { __resetHarness } from '@/lib/ipc.browser';
import type { AtlasRoute as Route } from '@/types/domain';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

const SETTLE = { timeout: 4000 } as const;

beforeEach(() => {
  __resetHarness();
});

function route(overrides: Partial<Route> = {}): Route {
  return {
    market: 'stock',
    providerId: 'finnhub',
    providerName: 'Finnhub',
    fallbackName: null,
    windowRemaining: 14,
    dayRemaining: null,
    blocked: [],
    ...overrides,
  };
}

describe('the ticker', () => {
  it('lists the watchlist with prices and direction', async () => {
    renderWithProviders(<AtlasRoute />);
    const panel = await waitFor(() => screen.getByRole('region', { name: 'Ticker' }), SETTLE);

    await waitFor(() => expect(within(panel).getByText('BTC')).toBeInTheDocument(), SETTLE);
    // Direction is never colour alone — ChangeValue carries an accessible label too.
    expect(within(panel).getAllByText(/24 hour change/i).length).toBeGreaterThan(0);
  });

  it('says how old the figures are rather than implying a stream', async () => {
    renderWithProviders(<AtlasRoute />);
    await waitFor(() => screen.getByRole('region', { name: 'Ticker' }), SETTLE);

    expect(await screen.findByText(/every 90s/, undefined, SETTLE)).toBeInTheDocument();
  });

  it('can be paused, because a ticker nobody is watching is a request nobody asked for', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AtlasRoute />);
    await waitFor(() => screen.getByRole('region', { name: 'Ticker' }), SETTLE);

    await user.click(screen.getByRole('button', { name: 'Pause' }));

    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/paused/)).toBeInTheDocument(), SETTLE);
  });
});

describe('the status line', () => {
  it('names the provider actually serving the request', () => {
    renderWithProviders(<AtlasStatusLine routes={[route()]} fetching={false} />);
    expect(screen.getByText('Finnhub')).toBeInTheDocument();
    expect(screen.getByText(/connected via/)).toBeInTheDocument();
  });

  /**
   * "Fallback ready" is a claim. It is only made where the rotation manager confirmed a second
   * provider could take the next request, and said plainly otherwise — a silent status line
   * would let the reader assume a safety net that does not exist.
   */
  it('says when there is no second source rather than staying quiet', () => {
    renderWithProviders(<AtlasStatusLine routes={[route()]} fetching={false} />);
    expect(screen.getByText(/no second source reviewed/)).toBeInTheDocument();
  });

  it('names the fallback when there really is one', () => {
    renderWithProviders(
      <AtlasStatusLine routes={[route({ fallbackName: 'Second Source' })]} fetching={false} />,
    );
    expect(screen.getByText(/Second Source ready/)).toBeInTheDocument();
  });

  it('shows what is left of the allowance', () => {
    renderWithProviders(
      <AtlasStatusLine
        routes={[route({ windowRemaining: 3, dayRemaining: 40 })]}
        fetching={false}
      />,
    );
    expect(screen.getByText(/3 calls left this minute/)).toBeInTheDocument();
    expect(screen.getByText(/40 today/)).toBeInTheDocument();
  });

  it('leaves out a daily figure for a provider that has no daily cap', () => {
    renderWithProviders(
      <AtlasStatusLine routes={[route({ dayRemaining: null })]} fetching={false} />,
    );
    expect(screen.queryByText(/today/)).not.toBeInTheDocument();
  });

  /** A blocked route has to say which tiers are out and when they return. */
  it('explains why nothing is answering', () => {
    renderWithProviders(
      <AtlasStatusLine
        routes={[
          route({
            providerId: '',
            providerName: 'none available',
            blocked: [
              { providerName: 'Finnhub', reason: 'rate limited', until: 1_800_000_000 },
              { providerName: 'Alpha Vantage', reason: 'needs a key', until: null },
            ],
          }),
        ]}
        fetching={false}
      />,
    );

    expect(screen.getByText(/no provider available/)).toBeInTheDocument();
    expect(screen.getByText(/Finnhub: rate limited/)).toBeInTheDocument();
    expect(screen.getByText(/Alpha Vantage: needs a key/)).toBeInTheDocument();
  });

  it('says it is waiting when there is no watchlist yet', () => {
    renderWithProviders(<AtlasStatusLine routes={[]} fetching={false} />);
    expect(screen.getByText(/waiting for a watchlist/)).toBeInTheDocument();
  });

  it('is announced, so a route change is not a silent visual event', () => {
    renderWithProviders(<AtlasStatusLine routes={[route()]} fetching={false} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(
      <AtlasStatusLine
        routes={[route(), route({ market: 'crypto', providerName: 'CoinGecko' })]}
        fetching
      />,
    );

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
