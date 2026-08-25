import type { ChartPoint } from '@/types/domain';

/**
 * The numbers behind a chart.
 *
 * A canvas is opaque to a screen reader, so every chart ships with this summary and a data
 * table beside it — see ADR-006. Computing it here rather than inside the chart component
 * keeps it testable and keeps the two presentations from drifting apart.
 */
export interface ChartSummary {
  first: ChartPoint;
  last: ChartPoint;
  high: ChartPoint;
  low: ChartPoint;
  /** Percent change across the visible range, or null when it cannot be computed. */
  changePct: number | null;
  pointCount: number;
}

export function summarizeChart(points: ChartPoint[]): ChartSummary | null {
  if (points.length === 0) return null;

  const first = points[0] as ChartPoint;
  const last = points[points.length - 1] as ChartPoint;

  let high = first;
  let low = first;
  for (const point of points) {
    if (point.close > high.close) high = point;
    if (point.close < low.close) low = point;
  }

  // Guard against a zero opening price: the percentage would be infinite, and showing
  // "+Infinity%" is worse than showing nothing.
  const changePct = first.close > 0 ? ((last.close - first.close) / first.close) * 100 : null;

  return { first, last, high, low, changePct, pointCount: points.length };
}

/**
 * Thins a series for the text alternative.
 *
 * The table exists to be read, and a 750-row table is not readable. This keeps the endpoints
 * and the extremes — the points a reader actually needs — and samples evenly between them.
 */
export function tableRows(points: ChartPoint[], maxRows = 12): ChartPoint[] {
  if (points.length <= maxRows) return points;

  const summary = summarizeChart(points);
  const keep = new Map<number, ChartPoint>();

  if (summary) {
    for (const point of [summary.first, summary.last, summary.high, summary.low]) {
      keep.set(point.time, point);
    }
  }

  const remaining = Math.max(0, maxRows - keep.size);
  const last = points.length - 1;
  for (let i = 0; i < remaining; i += 1) {
    const point = points[Math.round((i * last) / Math.max(1, remaining - 1))];
    if (point) keep.set(point.time, point);
  }

  return [...keep.values()].sort((a, b) => a.time - b.time);
}
