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
  LineSeries: 'LineSeries',
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

describe('chart overlays', () => {
  /**
   * Overlays are arithmetic over closes already on screen. Switching one on must not cause a
   * request — that is what keeps "the app makes no request you did not cause" true for a
   * control that looks like it might fetch something.
   */
  it('offers only the overlays the series is long enough for', () => {
    const short = Array.from({ length: 30 }, (_, i) => ({
      time: 1_700_000_000 + i * 86_400,
      close: 100 + i,
    }));
    renderWithProviders(<AssetChart points={short} currency="USD" label="TEST · 1 month" />);

    // 20-point windows fit in 30 points; 50 and 200 do not.
    expect(screen.getByRole('button', { name: 'EMA 20' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bollinger' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SMA 50' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SMA 200' })).not.toBeInTheDocument();
  });

  it('states the overlay value in text, because the canvas is hidden from assistive tech', async () => {
    const user = userEvent.setup();
    const points = Array.from({ length: 60 }, (_, i) => ({
      time: 1_700_000_000 + i * 86_400,
      close: 100,
    }));
    renderWithProviders(<AssetChart points={points} currency="USD" label="TEST · 3 months" />);

    const toggle = screen.getByRole('button', { name: 'SMA 50' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // A flat series at 100 has a 50-point average of exactly 100.
    expect(screen.getByText(/SMA 50:/)).toHaveTextContent('$100.00');
  });

  it('switches an overlay back off', async () => {
    const user = userEvent.setup();
    const points = Array.from({ length: 60 }, (_, i) => ({
      time: 1_700_000_000 + i * 86_400,
      close: 100 + i,
    }));
    renderWithProviders(<AssetChart points={points} currency="USD" label="TEST · 3 months" />);

    const toggle = screen.getByRole('button', { name: 'EMA 20' });
    await user.click(toggle);
    expect(screen.getByText(/EMA 20:/)).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByText(/EMA 20:/)).not.toBeInTheDocument();
  });

  it('offers no overlays at all for a series too short for any of them', () => {
    const tiny = [
      { time: 1_700_000_000, close: 10 },
      { time: 1_700_086_400, close: 11 },
    ];
    renderWithProviders(<AssetChart points={tiny} currency="USD" label="TEST · 2 days" />);
    expect(screen.queryByText('Overlays')).not.toBeInTheDocument();
  });
});
