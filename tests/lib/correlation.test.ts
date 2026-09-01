import { describe, expect, it } from 'vitest';
import { pearson, returns, correlationMatrix, indexToBase, MIN_SAMPLES } from '@/lib/correlation';
import type { ChartPoint } from '@/types/domain';

const DAY = 86_400;
const START = 1_700_000_000;

function series(closes: number[], offset = 0): ChartPoint[] {
  return closes.map((close, i) => ({ time: START + (i + offset) * DAY, close }));
}

/** A series long enough to clear MIN_SAMPLES, following a supplied step function. */
function long(step: (i: number) => number): ChartPoint[] {
  return series(Array.from({ length: MIN_SAMPLES + 5 }, (_, i) => step(i)));
}

describe('pearson', () => {
  it('is 1 for a perfectly linear relationship', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
  });

  it('is -1 when one rises as the other falls', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
  });

  it('is near zero for unrelated movement', () => {
    const r = pearson([1, -1, 1, -1, 1, -1], [1, 1, -1, -1, 1, 1]);
    expect(Math.abs(r as number)).toBeLessThan(0.5);
  });

  /** Undefined is not zero: a flat series cannot be correlated at all. */
  it('returns null when a series does not vary', () => {
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
    expect(pearson([1, 2, 3, 4], [5, 5, 5, 5])).toBeNull();
  });

  it('returns null when there is nothing to correlate', () => {
    expect(pearson([], [])).toBeNull();
    expect(pearson([1], [2])).toBeNull();
  });

  it('never escapes the range, even with floating point drift', () => {
    const xs = Array.from({ length: 200 }, (_, i) => i * 0.1);
    const r = pearson(xs, xs) as number;
    expect(r).toBeLessThanOrEqual(1);
    expect(r).toBeGreaterThanOrEqual(-1);
  });
});

describe('returns', () => {
  it('is one shorter than the input and expresses proportional change', () => {
    const r = returns(series([100, 110, 99]));
    expect(r).toHaveLength(2);
    expect(r[0]?.value).toBeCloseTo(0.1, 10);
    expect(r[1]?.value).toBeCloseTo(-0.1, 10);
  });

  it('skips a period it cannot divide by rather than producing infinity', () => {
    const r = returns([
      { time: 1, close: 0 },
      { time: 2, close: 50 },
      { time: 3, close: 100 },
    ]);
    expect(r).toHaveLength(1);
    expect(Number.isFinite(r[0]?.value as number)).toBe(true);
  });
});

describe('correlation matrix', () => {
  /**
   * The mistake this whole module exists to avoid. Two assets that merely both drift upward
   * correlate near 1.0 on raw prices whatever their daily behaviour; on returns they do not.
   */
  it('correlates returns, not prices, so a shared trend does not fake agreement', () => {
    // Both rise overall, but their day-to-day moves alternate against each other.
    const a = long((i) => 100 + i + (i % 2 === 0 ? 6 : 0));
    const b = long((i) => 100 + i + (i % 2 === 0 ? 0 : 6));

    const matrix = correlationMatrix([
      { symbol: 'A', points: a },
      { symbol: 'B', points: b },
    ]);

    const value = matrix.cells[0]?.[1] as number;
    expect(value).toBeLessThan(0.5);
  });

  it('puts 1 down the diagonal and is symmetric', () => {
    const matrix = correlationMatrix([
      { symbol: 'A', points: long((i) => 100 + i * 1.7) },
      { symbol: 'B', points: long((i) => 100 + Math.sin(i) * 5 + i) },
    ]);

    expect(matrix.cells[0]?.[0]).toBe(1);
    expect(matrix.cells[1]?.[1]).toBe(1);
    expect(matrix.cells[0]?.[1]).toBeCloseTo(matrix.cells[1]?.[0] as number, 12);
  });

  it('finds a strong negative correlation when one mirrors the other', () => {
    const up = long((i) => 100 + (i % 2 === 0 ? 5 : -5));
    const down = long((i) => 100 + (i % 2 === 0 ? -5 : 5));

    const matrix = correlationMatrix([
      { symbol: 'UP', points: up },
      { symbol: 'DOWN', points: down },
    ]);
    expect(matrix.cells[0]?.[1]).toBeCloseTo(-1, 6);
  });

  /** Two assets rarely share a calendar; index alignment would compare a Tuesday to a Saturday. */
  it('aligns on timestamps rather than position', () => {
    const a = long((i) => 100 + Math.sin(i) * 10);
    // Same shape, but the series starts 50 days later — no overlap at all.
    const b = series(
      Array.from({ length: MIN_SAMPLES + 5 }, (_, i) => 100 + Math.sin(i) * 10),
      500,
    );

    const matrix = correlationMatrix([
      { symbol: 'A', points: a },
      { symbol: 'B', points: b },
    ]);
    expect(matrix.cells[0]?.[1]).toBeNull();
  });

  it('excludes an asset with too little history to correlate at all', () => {
    const matrix = correlationMatrix([
      { symbol: 'LONG', points: long((i) => 100 + i) },
      { symbol: 'SHORT', points: series([100, 101, 102]) },
    ]);

    expect(matrix.symbols).toEqual(['LONG']);
    expect(matrix.excluded).toEqual(['SHORT']);
  });

  it('reports the thinnest overlap behind any figure', () => {
    const matrix = correlationMatrix([
      { symbol: 'A', points: long((i) => 100 + Math.sin(i) * 4) },
      { symbol: 'B', points: long((i) => 100 + Math.cos(i) * 4) },
    ]);
    expect(matrix.minSamples).toBeGreaterThanOrEqual(MIN_SAMPLES);
  });

  it('handles an empty input without throwing', () => {
    const matrix = correlationMatrix([]);
    expect(matrix.symbols).toEqual([]);
    expect(matrix.cells).toEqual([]);
    expect(matrix.minSamples).toBe(0);
  });
});

describe('indexToBase', () => {
  it('starts every series at the same base so one axis serves them all', () => {
    const indexed = indexToBase(series([50, 75, 100]));
    expect(indexed[0]?.close).toBe(100);
    expect(indexed[1]?.close).toBeCloseTo(150, 10);
    expect(indexed[2]?.close).toBeCloseTo(200, 10);
  });

  it('preserves relative shape regardless of absolute price', () => {
    const cheap = indexToBase(series([1, 2, 4]));
    const dear = indexToBase(series([10_000, 20_000, 40_000]));
    expect(cheap.map((p) => p.close)).toEqual(dear.map((p) => p.close));
  });

  it('returns nothing when there is no usable first price', () => {
    expect(indexToBase([])).toEqual([]);
    expect(indexToBase([{ time: 1, close: 0 }])).toEqual([]);
  });
});
