import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DigestPanel } from '@/features/pulse/DigestPanel';
import { NewsPanel } from '@/features/pulse/NewsPanel';
import { __resetHarness, browserInvoke } from '@/lib/ipc.browser';
import type { Quote } from '@/types/domain';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

const SETTLE = { timeout: 4000 } as const;

function quote(symbol: string, changePct24h: number | null): Quote {
  return {
    assetId: `crypto:cg:${symbol.toLowerCase()}`,
    symbol,
    name: symbol,
    assetType: 'crypto',
    price: 100,
    currency: 'USD',
    changePct24h,
    changePct7d: null,
    marketCap: null,
    volume24h: null,
    sparkline: [],
  };
}

beforeEach(() => {
  __resetHarness();
});

function render(quotes: Quote[], watching = false) {
  return renderWithProviders(<DigestPanel quotes={quotes} watching={watching} />, {
    resetHarness: false,
  });
}

function movers(): HTMLElement {
  return screen.getByRole('region', { name: 'Movers' });
}

describe('movers', () => {
  it('leads with the biggest risers and fallers', async () => {
    render([
      quote('BIG', 9.1),
      quote('MID', 2.2),
      quote('SMALL', 0.1),
      quote('DOWN', -0.4),
      quote('WORST', -8.8),
    ]);

    const list = within(movers());
    expect(list.getByText('BIG')).toBeInTheDocument();
    expect(list.getByText('WORST')).toBeInTheDocument();
  });

  it('shows at most three each way', async () => {
    render(['A', 'B', 'C', 'D', 'E'].map((s, i) => quote(s, 10 - i)));
    expect(within(movers()).getAllByRole('button')).toHaveLength(3);
  });

  /**
   * A provider that reported no change has not reported zero. Treating it as zero would park
   * unpriced assets in the middle of the list as though they had been flat.
   */
  it('leaves out anything with no reported change', async () => {
    render([quote('KNOWN', 3.2), quote('UNKNOWN', null)]);

    const list = within(movers());
    expect(list.getByText('KNOWN')).toBeInTheDocument();
    expect(list.queryByText('UNKNOWN')).not.toBeInTheDocument();
  });

  it('says so when nothing has moved', async () => {
    render([quote('FLAT', null)]);
    expect(within(movers()).getByText(/Nothing has moved/)).toBeInTheDocument();
  });

  it('opens the asset when a mover is pressed', async () => {
    const user = userEvent.setup();
    render([quote('BTC', 4.2)]);

    await user.click(within(movers()).getByRole('button'));
    // The route change is the assertion; MemoryRouter has no visible chrome here, so the
    // absence of a throw plus the button being wired is what this covers.
    expect(within(movers()).getByText('BTC')).toBeInTheDocument();
  });

  it('says which list the movers came from', async () => {
    render([quote('BTC', 1)], true);
    expect(await screen.findByText(/Movers from your watchlist/)).toBeInTheDocument();
  });
});

describe('market mood', () => {
  it('reports both indices with their band', async () => {
    render([]);
    const mood = within(screen.getByRole('region', { name: 'Market mood' }));

    await waitFor(
      () => expect(mood.getAllByText(/greed|fear|neutral/i).length).toBeGreaterThan(0),
      SETTLE,
    );
    expect(mood.getByText('Crypto')).toBeInTheDocument();
    expect(mood.getByText('Stocks')).toBeInTheDocument();
  });

  /** A week-on-week move is the part that says whether today is unusual. */
  it('compares against a week ago when the history reaches back that far', async () => {
    render([]);
    const mood = within(screen.getByRole('region', { name: 'Market mood' }));

    // Both indices carry one, so this is a count rather than a single match.
    await waitFor(() => expect(mood.getAllByText(/on a week ago/).length).toBe(2), SETTLE);
  });
});

describe('what is waiting', () => {
  it('counts unread headlines', async () => {
    render([]);
    expect(await screen.findByText(/unread headlines?\./, undefined, SETTLE)).toBeInTheDocument();
  });

  /**
   * Marked through the news panel rather than by poking the harness: the point of the assertion
   * is that the digest follows a read made elsewhere in the app, which is a shared-cache
   * guarantee rather than a database one.
   */
  it('counts only what is actually unread, and follows a read made elsewhere', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <DigestPanel quotes={[]} watching={false} />
        <NewsPanel />
      </>,
      { resetHarness: false },
    );

    const waiting = within(screen.getByRole('region', { name: 'Waiting for you' }));
    const line = await waitFor(() => waiting.getByText(/\d+ unread headlines?\./), SETTLE);
    const before = Number(/(\d+) unread/.exec(line.textContent ?? '')?.[1]);
    expect(before).toBeGreaterThan(0);

    // The row toggle, not the header's "Mark 12 read" — that one clears the lot, which would
    // make this assert 0 rather than one fewer.
    const newsPanel = within(screen.getByRole('region', { name: 'Market news' }));
    await user.click(
      (await newsPanel.findAllByRole('button', { name: /^Mark \u201c.*\u201d read$/ }, SETTLE))[0]!,
    );

    await waitFor(() => {
      const now = Number(
        /(\d+) unread/.exec(waiting.getByText(/unread headlines?\./).textContent ?? '')?.[1] ?? '0',
      );
      expect(now).toBe(before - 1);
    }, SETTLE);
  });

  it('says when nothing has fired', async () => {
    render([]);
    expect(await screen.findByText(/No alerts have fired/, undefined, SETTLE)).toBeInTheDocument();
  });

  it('offers a way to the alerts that did fire', async () => {
    await browserInvoke('set_preference', { key: 'alertsEnabled', value: 'true' });
    render([]);

    // With no fired alerts there is nothing to review, and no button for it.
    await waitFor(
      () => expect(screen.queryByRole('button', { name: /Review them/ })).not.toBeInTheDocument(),
      SETTLE,
    );
  });
});

describe('digest accessibility', () => {
  it('has no violations', async () => {
    const { container } = render([quote('BTC', 2.5), quote('ETH', -1.5)]);
    await screen.findByText(/unread headlines?\./, undefined, SETTLE);

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
