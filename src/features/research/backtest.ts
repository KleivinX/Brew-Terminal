import type { ChartPoint } from '@/types/domain';

/**
 * What a regular contribution would have done, over history that already happened.
 *
 * This is arithmetic on the past, not a projection. It answers "if I had put £100 in every week
 * since this date, what would I be holding" — a question with one correct answer — and never
 * "what will happen if I start now", which has none. Nothing here extrapolates, annualises
 * forward, or produces an expected return.
 *
 * The distinction matters because the shape of the output is the shape of a forecast, and it
 * would be easy to present it as one. The UI states the period covered and that past behaviour
 * is not a prediction, and this module returns nothing that implies otherwise.
 */

export type Cadence = 'daily' | 'weekly' | 'monthly';

export interface Contribution {
  time: number;
  /** Money put in on this date. */
  amount: number;
  price: number;
  /** Units bought with it. */
  units: number;
}

export interface BacktestResult {
  contributions: Contribution[];
  /** Total money put in. */
  invested: number;
  /** Units accumulated. */
  units: number;
  /** What those units are worth at the final price in the series. */
  finalValue: number;
  /** `finalValue - invested`. */
  profit: number;
  /** Profit as a percentage of what was invested. */
  profitPct: number | null;
  /** Average price paid per unit, which is the number the strategy is actually about. */
  averagePrice: number | null;
  /** The final price in the series, for comparison against the average paid. */
  finalPrice: number;
  /** What the same money would have bought in one purchase at the start. */
  lumpSumValue: number;
  firstTime: number;
  lastTime: number;
}

const SPACING: Record<Cadence, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

/**
 * Runs a contribution schedule over a price series.
 *
 * Contributions land on the points the series actually has. A weekly schedule over daily closes
 * buys every seventh point rather than every seventh calendar day — for a series with gaps
 * (weekends, holidays) those differ, and buying on a day the market was shut would need a price
 * that does not exist.
 */
export function backtestContributions(
  points: ChartPoint[],
  amount: number,
  cadence: Cadence,
): BacktestResult | null {
  if (points.length === 0 || !Number.isFinite(amount) || amount <= 0) return null;

  const ordered = [...points].sort((a, b) => a.time - b.time);
  const step = SPACING[cadence];

  const contributions: Contribution[] = [];
  let invested = 0;
  let units = 0;

  for (let i = 0; i < ordered.length; i += step) {
    const point = ordered[i];
    if (!point || !Number.isFinite(point.close) || point.close <= 0) continue;

    const bought = amount / point.close;
    invested += amount;
    units += bought;
    contributions.push({ time: point.time, amount, price: point.close, units: bought });
  }

  if (contributions.length === 0) return null;

  const first = ordered[0] as ChartPoint;
  const last = ordered[ordered.length - 1] as ChartPoint;
  const finalPrice = last.close;
  const finalValue = units * finalPrice;
  const profit = finalValue - invested;

  return {
    contributions,
    invested,
    units,
    finalValue,
    profit,
    profitPct: invested > 0 ? (profit / invested) * 100 : null,
    averagePrice: units > 0 ? invested / units : null,
    finalPrice,
    // The comparison that makes averaging legible: the same total, spent all at once on day one.
    lumpSumValue: first.close > 0 ? (invested / first.close) * finalPrice : 0,
    firstTime: first.time,
    lastTime: last.time,
  };
}
