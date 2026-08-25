import { describe, expect, it } from 'vitest';
import { summarizeChart, tableRows } from '@/features/research/chartSummary';
import type { ChartPoint } from '@/types/domain';

const series: ChartPoint[] = [
  { time: 1000, close: 100 },
  { time: 2000, close: 120 },
  { time: 3000, close: 90 },
  { time: 4000, close: 110 },
];

describe('summarizeChart', () => {
  it('reports the endpoints and extremes', () => {
    const summary = summarizeChart(series);
    expect(summary?.first.close).toBe(100);
    expect(summary?.last.close).toBe(110);
    expect(summary?.high.close).toBe(120);
    expect(summary?.low.close).toBe(90);
    expect(summary?.pointCount).toBe(4);
  });

  it('computes change across the visible range', () => {
    expect(summarizeChart(series)?.changePct).toBeCloseTo(10, 5);
  });

  it('returns null for an empty series rather than throwing', () => {
    expect(summarizeChart([])).toBeNull();
  });

  it('handles a single point', () => {
    const summary = summarizeChart([{ time: 1000, close: 50 }]);
    expect(summary?.first).toEqual(summary?.last);
    expect(summary?.changePct).toBe(0);
  });

  it('declines to compute a percentage from a zero opening price', () => {
    // "+Infinity%" is worse than showing nothing.
    const summary = summarizeChart([
      { time: 1000, close: 0 },
      { time: 2000, close: 10 },
    ]);
    expect(summary?.changePct).toBeNull();
  });
});

describe('tableRows', () => {
  it('returns everything when the series is already short', () => {
    expect(tableRows(series, 12)).toHaveLength(4);
  });

  it('thins a long series to the requested size', () => {
    const long: ChartPoint[] = Array.from({ length: 500 }, (_, i) => ({
      time: 1000 + i,
      close: 100 + (i % 37),
    }));

    const rows = tableRows(long, 12);
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows.length).toBeGreaterThan(4);
  });

  it('always keeps the endpoints and the extremes', () => {
    // These are the points a reader of the table actually needs.
    const long: ChartPoint[] = Array.from({ length: 500 }, (_, i) => ({
      time: 1000 + i,
      close: 100 + i,
    }));
    long[250] = { time: 1250, close: 9999 };
    long[400] = { time: 1400, close: -50 };

    const rows = tableRows(long, 12);
    const closes = rows.map((r) => r.close);

    expect(closes).toContain(long[0]?.close);
    expect(closes).toContain(long[long.length - 1]?.close);
    expect(closes).toContain(9999);
    expect(closes).toContain(-50);
  });

  it('returns rows in ascending time order', () => {
    const long: ChartPoint[] = Array.from({ length: 200 }, (_, i) => ({
      time: 1000 + i,
      close: 100 + Math.sin(i),
    }));

    const rows = tableRows(long, 10);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.time).toBeGreaterThan(rows[i - 1]!.time);
    }
  });

  it('handles an empty series', () => {
    expect(tableRows([], 12)).toEqual([]);
  });
});
