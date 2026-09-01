import { describe, expect, it } from 'vitest';
import { sma, ema, rsi, macd, bollinger, closes } from '@/features/research/indicators';

/**
 * Indicator maths is the kind of code that is easy to write plausibly and hard to write
 * correctly, so these check against values computed outside this codebase wherever possible
 * rather than against the implementation's own output.
 */

describe('simple moving average', () => {
  it('is the mean of the trailing window', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('produces nothing until the window is full', () => {
    expect(sma([10, 20], 5)).toEqual([null, null]);
  });

  it('running-sum accumulation does not drift over a long series', () => {
    // A thousand points of a constant value must still average to that value at the end.
    const flat = new Array(1000).fill(7);
    const out = sma(flat, 50);
    expect(out[999]).toBeCloseTo(7, 10);
  });
});

describe('exponential moving average', () => {
  it('seeds with the simple average of the first window', () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    // The first defined value is the SMA of 1,2,3.
    expect(out[2]).toBeCloseTo(2, 10);
    // Then k = 2/(3+1) = 0.5, so the next is 4*0.5 + 2*0.5 = 3.
    expect(out[3]).toBeCloseTo(3, 10);
    // And 5*0.5 + 3*0.5 = 4.
    expect(out[4]).toBeCloseTo(4, 10);
  });

  it('tracks a constant series exactly', () => {
    const out = ema(new Array(50).fill(12), 10);
    expect(out[49]).toBeCloseTo(12, 10);
  });

  it('returns nothing when there is less history than the period', () => {
    expect(ema([1, 2], 5).every((v) => v === null)).toBe(true);
  });
});

describe('relative strength index', () => {
  /**
   * Wilder's worked example from "New Concepts in Technical Trading Systems" — the series every
   * charting package validates RSI against.
   *
   * The expected value is derived here rather than copied, because the figure most often quoted
   * for this series online is 70.53, and that is a *later* point after smoothing has been
   * applied. The first RSI, from the initial 14 changes, works out as:
   *
   *   gains   0.06 + 0.72 + 0.50 + 0.27 + 0.32 + 0.42 + 0.24 + 0.14 + 0.67 = 3.34
   *   losses  0.25 + 0.54 + 0.19 + 0.42                                    = 1.40
   *   RS      (3.34 / 14) / (1.40 / 14) = 2.385714…
   *   RSI     100 − 100 / (1 + 2.385714…) = 70.4641…
   */
  it("matches Wilder's worked example on the first computable value", () => {
    const wilder = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28,
    ];
    const out = rsi(wilder, 14);
    expect(out[14]).toBeCloseTo(70.4641, 3);
  });

  it("continues to track Wilder's series once smoothing kicks in", () => {
    // Adding the next two closes from the same example. Wilder's smoothing means each new value
    // depends on the whole history, so this catches a regression in the recurrence that the
    // first value alone would not.
    const wilder = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61,
      46.28, 46.28, 46.0, 46.03,
    ];
    const out = rsi(wilder, 14);

    // Still in the same region, and every value stays inside the definition's bounds.
    for (const value of out.slice(14)) {
      expect(value).not.toBeNull();
      expect(value as number).toBeGreaterThanOrEqual(0);
      expect(value as number).toBeLessThanOrEqual(100);
    }
    // A down close must pull the index down.
    expect(out[15] as number).toBeLessThan(out[14] as number);
  });

  it('is 100 when a series only rises', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(rising, 14)[29]).toBeCloseTo(100, 6);
  });

  it('is 0 when a series only falls', () => {
    const falling = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi(falling, 14)[29]).toBeCloseTo(0, 6);
  });

  it('sits at the midpoint for a flat series rather than dividing by zero', () => {
    const flat = new Array(30).fill(50);
    const out = rsi(flat, 14);
    expect(out[29]).toBe(50);
    expect(Number.isFinite(out[29] as number)).toBe(true);
  });

  it('produces nothing before there is a full period of changes', () => {
    const out = rsi([1, 2, 3], 14);
    expect(out.every((v) => v === null)).toBe(true);
  });
});

describe('MACD', () => {
  it('is the gap between the fast and slow averages', () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const { macd: line, signal, histogram } = macd(values);

    const fast = ema(values, 12);
    const slow = ema(values, 26);
    expect(line[59]).toBeCloseTo((fast[59] as number) - (slow[59] as number), 10);

    // The histogram is the line minus its signal, by definition.
    expect(histogram[59]).toBeCloseTo((line[59] as number) - (signal[59] as number), 10);
  });

  it('has no signal line before the slow average exists', () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + i);
    const { macd: line, signal } = macd(values);

    // The slow EMA needs 26 points, so nothing before index 25 can have a MACD value.
    expect(line[24]).toBeNull();
    expect(signal[24]).toBeNull();
    // And the signal is an average of the MACD line, so it lags further still.
    expect(signal[25]).toBeNull();
  });

  it('is flat at zero for a flat series', () => {
    const { macd: line, histogram } = macd(new Array(80).fill(42));
    expect(line[79]).toBeCloseTo(0, 8);
    expect(histogram[79]).toBeCloseTo(0, 8);
  });
});

describe('Bollinger bands', () => {
  it('collapses onto the average when the series does not move', () => {
    const { upper, middle, lower } = bollinger(new Array(40).fill(25), 20, 2);
    expect(middle[39]).toBeCloseTo(25, 10);
    expect(upper[39]).toBeCloseTo(25, 10);
    expect(lower[39]).toBeCloseTo(25, 10);
  });

  it('uses the population standard deviation, as Bollinger specified', () => {
    // Five values, period 5: mean 3, population sd = sqrt(2) ≈ 1.414214.
    const { upper, middle, lower } = bollinger([1, 2, 3, 4, 5], 5, 2);
    expect(middle[4]).toBeCloseTo(3, 10);
    expect(upper[4]).toBeCloseTo(3 + 2 * Math.SQRT2, 6);
    expect(lower[4]).toBeCloseTo(3 - 2 * Math.SQRT2, 6);
  });

  it('brackets the average symmetrically', () => {
    const values = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i) * 5);
    const { upper, middle, lower } = bollinger(values, 20, 2);
    const gapAbove = (upper[49] as number) - (middle[49] as number);
    const gapBelow = (middle[49] as number) - (lower[49] as number);
    expect(gapAbove).toBeCloseTo(gapBelow, 10);
  });
});

describe('closes', () => {
  it('takes the close of each point in order', () => {
    expect(
      closes([
        { time: 1, close: 10 },
        { time: 2, close: 20 },
      ]),
    ).toEqual([10, 20]);
  });
});
