import type { ChartPoint } from '@/types/domain';

/**
 * Indicators, computed locally over a price series.
 *
 * These are arithmetic, not opinions. A moving average is the mean of the last n closes; RSI is
 * a ratio of average gains to average losses. Neither says what to do, and nothing here emits a
 * "signal", a crossover alert or a suggested action — the line is drawn and the reader draws
 * their own conclusions. That is the same line the rest of the app holds: show the working, let
 * the person decide.
 *
 * Everything runs on the series already in memory, so no request is made to add an indicator.
 */

/** A value aligned to the input series. `null` where there is not yet enough history. */
export type IndicatorSeries = (number | null)[];

/**
 * Simple moving average: the unweighted mean of the last `period` closes.
 *
 * Computed with a running sum rather than re-summing a window each step — over a 1000-point
 * series with a 200-period window that is 1000 additions instead of 200,000.
 */
export function sma(values: number[], period: number): IndicatorSeries {
  if (period <= 0) return values.map(() => null);

  const out: IndicatorSeries = new Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i += 1) {
    sum += values[i] as number;
    if (i >= period) sum -= values[i - period] as number;
    if (i >= period - 1) out[i] = sum / period;
  }

  return out;
}

/**
 * Exponential moving average, weighting recent closes more heavily.
 *
 * Seeded with the simple average of the first `period` values, which is the conventional choice:
 * seeding with the first close alone lets one arbitrary data point bias a long window for a long
 * time.
 */
export function ema(values: number[], period: number): IndicatorSeries {
  if (period <= 0 || values.length < period) return values.map(() => null);

  const out: IndicatorSeries = new Array(values.length).fill(null);
  const k = 2 / (period + 1);

  let seed = 0;
  for (let i = 0; i < period; i += 1) seed += values[i] as number;
  let previous = seed / period;
  out[period - 1] = previous;

  for (let i = period; i < values.length; i += 1) {
    previous = (values[i] as number) * k + previous * (1 - k);
    out[i] = previous;
  }

  return out;
}

/**
 * Relative strength index, using Wilder's smoothing.
 *
 * Wilder's original method, not a simple average of gains — the two give visibly different
 * numbers and every chart package worth comparing against uses Wilder's. A period with no losses
 * at all yields 100 by definition rather than a division by zero.
 */
export function rsi(values: number[], period = 14): IndicatorSeries {
  const out: IndicatorSeries = new Array(values.length).fill(null);
  if (values.length <= period || period <= 0) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = (values[i] as number) - (values[i - 1] as number);
    if (change >= 0) gains += change;
    else losses -= change;
  }

  let averageGain = gains / period;
  let averageLoss = losses / period;
  out[period] = toRsi(averageGain, averageLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = (values[i] as number) - (values[i - 1] as number);
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    averageGain = (averageGain * (period - 1) + gain) / period;
    averageLoss = (averageLoss * (period - 1) + loss) / period;
    out[i] = toRsi(averageGain, averageLoss);
  }

  return out;
}

function toRsi(averageGain: number, averageLoss: number): number {
  // No losses in the window means no downside to weigh the upside against.
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const rs = averageGain / averageLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: IndicatorSeries;
  signal: IndicatorSeries;
  histogram: IndicatorSeries;
}

/**
 * MACD: the gap between a fast and a slow EMA, and a smoothed version of that gap.
 *
 * The signal line is an EMA of the MACD line, which only exists once the slow EMA does — so it
 * is computed over the defined portion and then realigned, rather than over a series padded with
 * nulls that would drag the average toward zero.
 */
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);

  const macdLine: IndicatorSeries = values.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f === null || f === undefined || s === null || s === undefined ? null : f - s;
  });

  const firstDefined = macdLine.findIndex((v) => v !== null);
  const signal: IndicatorSeries = new Array(values.length).fill(null);
  const histogram: IndicatorSeries = new Array(values.length).fill(null);

  if (firstDefined !== -1) {
    const defined = macdLine.slice(firstDefined) as number[];
    const signalDefined = ema(defined, signalPeriod);

    for (let i = 0; i < signalDefined.length; i += 1) {
      const value = signalDefined[i];
      if (value === null || value === undefined) continue;
      const at = firstDefined + i;
      signal[at] = value;
      const line = macdLine[at];
      if (line !== null && line !== undefined) histogram[at] = line - value;
    }
  }

  return { macd: macdLine, signal, histogram };
}

export interface BollingerBands {
  upper: IndicatorSeries;
  middle: IndicatorSeries;
  lower: IndicatorSeries;
}

/**
 * Bollinger bands: a moving average with a standard-deviation envelope.
 *
 * The population standard deviation over the window, which is what Bollinger specified and what
 * charting packages use — the sample form (n−1) gives slightly wider bands and would not match
 * anything the reader compares against.
 */
export function bollinger(values: number[], period = 20, deviations = 2): BollingerBands {
  const middle = sma(values, period);
  const upper: IndicatorSeries = new Array(values.length).fill(null);
  const lower: IndicatorSeries = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i += 1) {
    const mean = middle[i];
    if (mean === null || mean === undefined) continue;

    let sumSquares = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      const diff = (values[j] as number) - mean;
      sumSquares += diff * diff;
    }
    const sd = Math.sqrt(sumSquares / period);

    upper[i] = mean + sd * deviations;
    lower[i] = mean - sd * deviations;
  }

  return { upper, middle, lower };
}

/** The closes of a chart series, in order. */
export function closes(points: ChartPoint[]): number[] {
  return points.map((p) => p.close);
}
