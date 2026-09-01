import { describe, expect, it } from 'vitest';
import { backtestContributions } from '@/features/research/backtest';
import type { ChartPoint } from '@/types/domain';

const DAY = 86_400;

function series(closes: number[]): ChartPoint[] {
  return closes.map((close, i) => ({ time: 1_700_000_000 + i * DAY, close }));
}

describe('contribution backtest', () => {
  it('buys on every point at a daily cadence', () => {
    const result = backtestContributions(series([10, 10, 10]), 100, 'daily');
    expect(result).not.toBeNull();
    expect(result?.contributions).toHaveLength(3);
    expect(result?.invested).toBe(300);
    // 100 at 10 each time is 10 units a go.
    expect(result?.units).toBeCloseTo(30, 10);
  });

  it('buys every seventh point at a weekly cadence', () => {
    const result = backtestContributions(series(new Array(21).fill(10)), 70, 'weekly');
    expect(result?.contributions).toHaveLength(3);
    expect(result?.invested).toBe(210);
  });

  /**
   * The whole point of averaging: a fixed sum buys more units when the price is low, so the
   * average paid comes in below the arithmetic mean of the prices.
   */
  it('pays less than the average price because a fixed sum buys more when it is cheap', () => {
    // Prices 10 and 20. Mean price is 15; £100 at each buys 10 + 5 = 15 units for £200,
    // an average of 13.33.
    const result = backtestContributions(series([10, 20]), 100, 'daily');
    expect(result?.averagePrice).toBeCloseTo(200 / 15, 6);
    expect(result?.averagePrice as number).toBeLessThan(15);
  });

  it('reports a loss as a loss', () => {
    const result = backtestContributions(series([100, 50]), 100, 'daily');
    // 1 unit then 2 units = 3 units, worth 150 at the end, against 200 invested.
    expect(result?.finalValue).toBeCloseTo(150, 6);
    expect(result?.profit).toBeCloseTo(-50, 6);
    expect(result?.profitPct).toBeCloseTo(-25, 6);
  });

  it('compares against putting the same money in at the start', () => {
    // Rising series: a lump sum on day one beats averaging in.
    const result = backtestContributions(series([10, 20, 30]), 30, 'daily');
    expect(result?.lumpSumValue as number).toBeGreaterThan(result?.finalValue as number);

    // Falling series: averaging in wins.
    const falling = backtestContributions(series([30, 20, 10]), 30, 'daily');
    expect(falling?.lumpSumValue as number).toBeLessThan(falling?.finalValue as number);
  });

  it('sorts an out-of-order series before running', () => {
    const shuffled = [
      { time: 1_700_000_000 + 2 * DAY, close: 30 },
      { time: 1_700_000_000, close: 10 },
      { time: 1_700_000_000 + DAY, close: 20 },
    ];
    const result = backtestContributions(shuffled, 60, 'daily');
    expect(result?.firstTime).toBe(1_700_000_000);
    expect(result?.finalPrice).toBe(30);
  });

  it('skips points with no usable price rather than dividing by zero', () => {
    const result = backtestContributions(
      [
        { time: 1, close: 10 },
        { time: 2, close: 0 },
        { time: 3, close: Number.NaN },
        { time: 4, close: 10 },
      ],
      100,
      'daily',
    );
    expect(result?.contributions).toHaveLength(2);
    expect(result?.invested).toBe(200);
    expect(Number.isFinite(result?.units as number)).toBe(true);
  });

  it('returns nothing for inputs that cannot produce a result', () => {
    expect(backtestContributions([], 100, 'daily')).toBeNull();
    expect(backtestContributions(series([10]), 0, 'daily')).toBeNull();
    expect(backtestContributions(series([10]), -50, 'daily')).toBeNull();
    expect(backtestContributions(series([10]), Number.NaN, 'daily')).toBeNull();
    // Every price unusable means nothing was ever bought.
    expect(backtestContributions([{ time: 1, close: 0 }], 100, 'daily')).toBeNull();
  });

  it('keeps a flat series exactly break-even', () => {
    const result = backtestContributions(series(new Array(10).fill(50)), 100, 'daily');
    expect(result?.profit).toBeCloseTo(0, 8);
    expect(result?.profitPct).toBeCloseTo(0, 8);
    expect(result?.averagePrice).toBeCloseTo(50, 8);
  });
});
