import type { ChartPoint } from '@/types/domain';

/**
 * How closely two assets have moved together.
 *
 * Lives in `lib/` rather than beside the Compare feature: ARCHITECTURE.md §3.1 forbids one
 * feature slice importing another, and shared code moves down instead.
 *
 * Pearson correlation over **returns**, not prices. Correlating raw prices is the classic
 * mistake: two assets that both merely drift upward correlate near 1.0 whatever their
 * day-to-day behaviour, because the shared trend dominates. Returns strip the trend and leave
 * the question actually worth asking — when one moves, does the other?
 *
 * Nothing here says what a number means. 0.9 between two holdings is a fact about the past; the
 * app does not call it "overexposed" or suggest a rebalance. Seeing it is the point.
 */

/** A correlation between two assets, in [-1, 1]. */
export interface Correlation {
  a: string;
  b: string;
  value: number;
  /** Overlapping observations the figure is based on. */
  samples: number;
}

export interface CorrelationMatrix {
  symbols: string[];
  /** Row-major, `symbols.length` square. `null` where there was too little overlap. */
  cells: (number | null)[][];
  /** The smallest overlap behind any cell, so the UI can say how thin the thinnest figure is. */
  minSamples: number;
  /** Assets dropped for having too little history to correlate at all. */
  excluded: string[];
}

/**
 * The fewest overlapping returns worth reporting.
 *
 * Below this, correlation is dominated by noise — two assets with four shared observations can
 * show 0.95 by coincidence. Refusing to draw the cell is more honest than drawing a confident
 * one.
 */
export const MIN_SAMPLES = 20;

/** Period-over-period returns. One shorter than the input. */
export function returns(points: ChartPoint[]): { time: number; value: number }[] {
  const ordered = [...points].sort((a, b) => a.time - b.time);
  const out: { time: number; value: number }[] = [];

  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1] as ChartPoint;
    const current = ordered[i] as ChartPoint;
    if (!Number.isFinite(previous.close) || previous.close <= 0) continue;
    if (!Number.isFinite(current.close)) continue;
    out.push({ time: current.time, value: (current.close - previous.close) / previous.close });
  }

  return out;
}

/**
 * Pearson correlation of two aligned series.
 *
 * Returns `null` rather than a number when either series does not vary — a flat series has zero
 * standard deviation, and the coefficient is undefined, not zero. Reporting 0 would read as
 * "unrelated" when the truth is "unanswerable".
 */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i] as number;
    sumY += ys[i] as number;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let covariance = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] as number) - meanX;
    const dy = (ys[i] as number) - meanY;
    covariance += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  if (varX === 0 || varY === 0) return null;

  const r = covariance / Math.sqrt(varX * varY);
  // Floating point can nudge a perfect correlation just outside the range.
  return Math.max(-1, Math.min(1, r));
}

/**
 * Correlates every pair, aligning each on the timestamps both actually have.
 *
 * Alignment is by timestamp rather than by index because two assets rarely share a calendar:
 * equities have no weekend bars and crypto does. Lining up index 40 against index 40 would
 * silently compare a Tuesday with a Saturday.
 */
export function correlationMatrix(
  series: { symbol: string; points: ChartPoint[] }[],
): CorrelationMatrix {
  const prepared = series.map((entry) => {
    const byTime = new Map<number, number>();
    for (const r of returns(entry.points)) byTime.set(r.time, r.value);
    return { symbol: entry.symbol, byTime };
  });

  const usable = prepared.filter((entry) => entry.byTime.size >= MIN_SAMPLES);
  const excluded = prepared
    .filter((entry) => entry.byTime.size < MIN_SAMPLES)
    .map((entry) => entry.symbol);

  const symbols = usable.map((entry) => entry.symbol);
  const cells: (number | null)[][] = symbols.map(() => symbols.map(() => null));
  let minSamples = Number.POSITIVE_INFINITY;

  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i; j < usable.length; j += 1) {
      if (i === j) {
        cells[i]![j] = 1;
        continue;
      }

      const left = usable[i]!;
      const right = usable[j]!;
      const xs: number[] = [];
      const ys: number[] = [];

      for (const [time, value] of left.byTime) {
        const other = right.byTime.get(time);
        if (other !== undefined) {
          xs.push(value);
          ys.push(other);
        }
      }

      const value = xs.length >= MIN_SAMPLES ? pearson(xs, ys) : null;
      cells[i]![j] = value;
      cells[j]![i] = value;
      if (value !== null) minSamples = Math.min(minSamples, xs.length);
    }
  }

  return {
    symbols,
    cells,
    minSamples: Number.isFinite(minSamples) ? minSamples : 0,
    excluded,
  };
}

/**
 * Normalises a series to 100 at its first point, so assets of wildly different prices can share
 * one axis.
 *
 * This is why the comparison chart does not need two y-scales — and a dual-axis chart is the
 * single most misleading thing a price comparison can do, because the crossover point is then
 * an artefact of where the author put the axes.
 */
export function indexToBase(points: ChartPoint[], base = 100): ChartPoint[] {
  const ordered = [...points].sort((a, b) => a.time - b.time);
  const first = ordered.find((p) => Number.isFinite(p.close) && p.close > 0);
  if (!first) return [];

  return ordered
    .filter((p) => Number.isFinite(p.close))
    .map((p) => ({ time: p.time, close: (p.close / first.close) * base }));
}
