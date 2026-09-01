import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenerRoute } from '@/features/screener/ScreenerRoute';
import { __resetHarness } from '@/lib/ipc.browser';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

beforeEach(() => {
  __resetHarness();
});

async function resultsTable(): Promise<HTMLElement> {
  return waitFor(
    () => within(screen.getByRole('region', { name: /^Results/ })).getByRole('table'),
    { timeout: 4000 },
  );
}

function rowCount(table: HTMLElement): number {
  return within(table).getAllByRole('row').length - 1; // minus the header
}

describe('screener', () => {
  it('starts by showing the whole market rather than nothing', async () => {
    renderWithProviders(<ScreenerRoute />);
    expect(rowCount(await resultsTable())).toBeGreaterThan(0);
  });

  it('narrows the list when a filter is applied', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerRoute />);

    const before = rowCount(await resultsTable());
    // High enough to exclude most fixtures, low enough that something still matches — a filter
    // that empties the list renders the empty state instead of a table, which is a different
    // assertion and is covered separately below.
    await user.type(screen.getByLabelText('Min price'), '1000');

    await waitFor(async () => {
      const after = rowCount(await resultsTable());
      expect(after).toBeLessThan(before);
      expect(after).toBeGreaterThan(0);
    });
  });

  it('restricts to one asset type', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerRoute />);
    await resultsTable();

    await user.click(screen.getByRole('radio', { name: 'Crypto' }));

    // Every remaining row should be a crypto symbol from the fixtures.
    await waitFor(async () => {
      const table = await resultsTable();
      expect(within(table).queryByText('AAPL')).not.toBeInTheDocument();
    });
  });

  it('matches on name as well as symbol', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerRoute />);
    await resultsTable();

    await user.type(screen.getByLabelText('Name or symbol'), 'bitcoin');

    await waitFor(async () => {
      const table = await resultsTable();
      expect(within(table).getByText('BTC')).toBeInTheDocument();
      expect(rowCount(table)).toBeLessThan(5);
    });
  });

  it('explains an empty result instead of just showing nothing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerRoute />);
    await resultsTable();

    await user.type(screen.getByLabelText('Min price'), '99999999999');

    expect(await screen.findByText(/Nothing matches those filters/i)).toBeInTheDocument();
    expect(screen.getByText(/Every criterion has to hold at once/i)).toBeInTheDocument();
  });

  it('clears filters and brings the rows back', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ScreenerRoute />);
    const before = rowCount(await resultsTable());

    await user.type(screen.getByLabelText('Min price'), '99999999999');
    await screen.findByText(/Nothing matches those filters/i);

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    await waitFor(async () => {
      expect(rowCount(await resultsTable())).toBe(before);
    });
  });

  /** The honesty rule the model enforces, stated where the reader can see it. */
  it('says that a missing value is excluded rather than treated as zero', async () => {
    renderWithProviders(<ScreenerRoute />);
    await resultsTable();
    expect(screen.getByText(/Unknown is not zero/i)).toBeInTheDocument();
  });

  it('keeps provider attribution on the results', async () => {
    renderWithProviders(<ScreenerRoute />);
    await resultsTable();
    // A screened list is still provider data and must say where it came from.
    const results = screen.getByRole('region', { name: /^Results/ });
    expect(within(results).getByText(/updated/i)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<ScreenerRoute />);
    await resultsTable();

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
