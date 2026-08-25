import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssetChart } from '@/features/research/AssetChart';
import { AppearancePanel } from '@/features/settings/AppearancePanel';
import { renderWithProviders } from '../setup/renderWithProviders';
import type { ChartPoint } from '@/types/domain';

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
}));

const points: ChartPoint[] = Array.from({ length: 40 }, (_, i) => ({
  time: 1_755_820_800 + i * 86_400,
  close: 100 + Math.sin(i) * 10,
}));

beforeEach(() => {
  createChart.mockClear();
  document.documentElement.removeAttribute('data-theme');
  localStorage.clear();
});

describe('AssetChart', () => {
  it('renders a summary that conveys everything the canvas shows', () => {
    renderWithProviders(<AssetChart points={points} currency="USD" label="BTC over 1 month" />);

    // The canvas is aria-hidden, so this text is the accessible content.
    expect(screen.getByText(/40 points from/i)).toBeInTheDocument();
    expect(screen.getByText(/Opened/)).toBeInTheDocument();
    expect(screen.getByText(/High/)).toBeInTheDocument();
  });

  it('hides the canvas from assistive technology', () => {
    const { container } = renderWithProviders(
      <AssetChart points={points} currency="USD" label="BTC" />,
    );

    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden).toBeInTheDocument();
  });

  it('says so plainly when there is no history rather than drawing an empty axis', () => {
    renderWithProviders(<AssetChart points={[]} currency="USD" label="BTC" />);
    expect(screen.getByText(/No price history is available/i)).toBeInTheDocument();
    expect(createChart).not.toHaveBeenCalled();
  });

  it('rebuilds when the theme changes', async () => {
    /*
     * Regression: the chart paints axis labels and grid lines into a canvas using token
     * values read once at creation. Without this dependency it kept dark-theme charcoal grid
     * lines on a white background after switching to Light.
     */
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <AppearancePanel />
        <AssetChart points={points} currency="USD" label="BTC" />
      </>,
    );

    await waitFor(() => expect(createChart).toHaveBeenCalled());
    const initialCalls = createChart.mock.calls.length;

    await user.click(await screen.findByRole('radio', { name: /Light/ }));

    await waitFor(() => {
      expect(createChart.mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it('keeps the data table collapsed until asked for', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetChart points={points} currency="USD" label="BTC" />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show the underlying numbers/i }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('thins a long series in the table and says that it did', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssetChart points={points} currency="USD" label="BTC over 1 month" />);

    await user.click(screen.getByRole('button', { name: /show the underlying numbers/i }));

    const table = screen.getByRole('table');
    const rows = table.querySelectorAll('tbody tr').length;
    expect(rows).toBeLessThan(points.length);
    expect(screen.getByText(/including the high and the low/i)).toBeInTheDocument();
  });
});
