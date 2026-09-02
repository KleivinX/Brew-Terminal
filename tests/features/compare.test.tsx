import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompareRoute } from '@/features/compare/CompareRoute';
import { __resetHarness } from '@/lib/ipc.browser';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

const createChart = vi.fn(() => ({
  addSeries: vi.fn(() => ({ setData: vi.fn() })),
  timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
  applyOptions: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('lightweight-charts', () => ({
  get createChart() {
    return createChart;
  },
  AreaSeries: 'AreaSeries',
  LineSeries: 'LineSeries',
}));

beforeEach(() => {
  __resetHarness();
  createChart.mockClear();
});

/**
 * Headroom for the Compare route's panels.
 *
 * `waitFor` defaults to one second, which was comfortable when this route mounted a chart and
 * a correlation table. It now also mounts the market-mood panel, and on a loaded machine that
 * extra work is enough to push a bare one-second wait over — intermittently, and only in a
 * full parallel run, which is the worst way for a test to fail.
 */
const PANEL_TIMEOUT = { timeout: 4000 } as const;

async function correlation(): Promise<HTMLElement> {
  return waitFor(
    () => within(screen.getByRole('region', { name: 'Correlation' })).getByRole('table'),
    { timeout: 4000 },
  );
}

describe('compare', () => {
  it('starts with two assets on one axis', async () => {
    renderWithProviders(<CompareRoute />);
    const chart = await waitFor(() => screen.getByRole('region', { name: /Indexed to 100/ }), PANEL_TIMEOUT);
    expect(within(chart).getByText('BITCOIN')).toBeInTheDocument();
    expect(within(chart).getByText('ETHEREUM')).toBeInTheDocument();
  });

  /**
   * The reason indexing exists. A dual-axis comparison makes the crossover point an artefact of
   * where the axes were placed, so the panel says what the single axis means instead.
   */
  it('explains that every line starts from its own base', async () => {
    renderWithProviders(<CompareRoute />);
    const chart = await waitFor(() => screen.getByRole('region', { name: /Indexed to 100/ }), PANEL_TIMEOUT);
    expect(within(chart).getByText(/Each line starts at 100/)).toBeInTheDocument();
    expect(within(chart).getByText(/not against each other in currency/)).toBeInTheDocument();
  });

  it('gives every series a legend entry, so identity is never colour alone', async () => {
    renderWithProviders(<CompareRoute />);
    const chart = await waitFor(() => screen.getByRole('region', { name: /Indexed to 100/ }), PANEL_TIMEOUT);
    const legend = within(chart).getAllByRole('list')[0] as HTMLElement;
    expect(within(legend).getAllByRole('listitem')).toHaveLength(2);
  });

  it('offers the numbers behind the chart', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompareRoute />);
    const chart = await waitFor(() => screen.getByRole('region', { name: /Indexed to 100/ }), PANEL_TIMEOUT);

    await user.click(within(chart).getByRole('button', { name: /show the numbers/i }));
    expect(within(chart).getByRole('table')).toBeInTheDocument();
  });

  it('shows a correlation cell for every pair, with the number in the cell', async () => {
    const table = await (async () => {
      renderWithProviders(<CompareRoute />);
      return correlation();
    })();

    // 2 assets: a 2x2 matrix plus a header row.
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    // The diagonal is 1.00 and is written, not just coloured.
    expect(within(table).getAllByText('1.00').length).toBeGreaterThanOrEqual(2);
  });

  it('says it correlates returns rather than prices', async () => {
    renderWithProviders(<CompareRoute />);
    await correlation();
    const panel = screen.getByRole('region', { name: 'Correlation' });
    expect(within(panel).getByText(/Daily returns, not prices/i)).toBeInTheDocument();
  });

  it('adds and removes an asset', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompareRoute />);
    await waitFor(() => screen.getByRole('region', { name: /Indexed to 100/ }), PANEL_TIMEOUT);

    await user.type(screen.getByLabelText('Asset id to add'), 'crypto:cg:solana');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Remove crypto:cg:solana/ })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole('button', { name: /Remove crypto:cg:solana/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /Remove crypto:cg:solana/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it('names an asset it could not fetch rather than dropping it silently', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompareRoute />);
    await waitFor(() => screen.getByRole('region', { name: /Indexed to 100/ }), PANEL_TIMEOUT);

    await user.type(screen.getByLabelText('Asset id to add'), 'crypto:cg:not-real-at-all');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/No history available for/)).toBeInTheDocument();
  });

  it('shows macro context without needing a key', async () => {
    renderWithProviders(<CompareRoute />);
    const macro = await waitFor(() => screen.getByRole('region', { name: /Macro backdrop/ }), PANEL_TIMEOUT);
    expect(within(macro).getByText(/No key needed/i)).toBeInTheDocument();
    expect(within(macro).getByLabelText('Series')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<CompareRoute />);
    await correlation();

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
