import { useEffect, useId, useRef, useState } from 'react';
import {
  createChart,
  AreaSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/app/providers/ThemeProvider';
import { formatAbsoluteTime, formatPercent, formatPrice } from '@/lib/format';
import { summarizeChart, tableRows } from './chartSummary';
import { bollinger, closes, ema, rsi, sma, type IndicatorSeries } from './indicators';
import type { ChartPoint } from '@/types/domain';
import styles from './AssetChart.module.css';

interface AssetChartProps {
  points: ChartPoint[];
  currency: string;
  /** Used in the accessible description, e.g. "BTC · 1 month". */
  label: string;
  height?: number;
}

/**
 * Overlays the reader can switch on. Each is arithmetic over the closes already on screen —
 * turning one on makes no request and reveals nothing new about the asset, only a different view
 * of the same numbers.
 *
 * There is deliberately no crossover marker, no shaded "overbought" zone and no alert. Those
 * would be the app drawing a conclusion; the line is where its job ends.
 */
type OverlayId = 'sma50' | 'sma200' | 'ema20' | 'bollinger';

interface Overlay {
  id: OverlayId;
  label: string;
  /** What it is, in a sentence, for the reader who has not met it before. */
  describe: string;
  /** Minimum closes needed before it can be drawn at all. */
  minimum: number;
}

const OVERLAYS: Overlay[] = [
  {
    id: 'sma50',
    label: 'SMA 50',
    describe: 'The average close of the last 50 points.',
    minimum: 50,
  },
  {
    id: 'sma200',
    label: 'SMA 200',
    describe: 'The average close of the last 200 points.',
    minimum: 200,
  },
  {
    id: 'ema20',
    label: 'EMA 20',
    describe: 'A 20-point average that weights recent closes more heavily.',
    minimum: 20,
  },
  {
    id: 'bollinger',
    label: 'Bollinger',
    describe: 'A 20-point average with a band two standard deviations either side.',
    minimum: 20,
  },
];

/** Reads a CSS custom property so the chart follows the active theme. */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Canvas price chart with a text alternative.
 *
 * The canvas is `aria-hidden`: it is unreadable to assistive technology by nature, so the
 * accessible content is the summary and the data table beside it, not a label pinned to a
 * bitmap. Both are always in the DOM; the table is visually collapsed by default and can be
 * opened by anyone. See ADR-006.
 */
export function AssetChart({ points, currency, label, height = 260 }: AssetChartProps) {
  /*
   * The chart paints axis labels and grid lines into a canvas using token values read at
   * creation time, so it does not follow a theme switch on its own — the grid would stay
   * dark-theme charcoal on a white background. Depending on the theme here rebuilds it when
   * the theme changes, which is rare enough that a rebuild is the right trade against
   * mirroring every colour through applyOptions.
   */
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const [showTable, setShowTable] = useState(false);
  const summaryId = useId();

  const summary = summarizeChart(points);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || points.length === 0) return undefined;

    const chart = createChart(container, {
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: token('--text-muted', '#79838f'),
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: token('--border-subtle', '#232a33') },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      crosshair: { mode: 1 },
      handleScroll: false,
      handleScale: false,
    });

    const rising = (summary?.changePct ?? 0) >= 0;
    const lineColor = rising ? token('--positive', '#3fb950') : token('--negative', '#f85149');

    const series = chart.addSeries(AreaSeries, {
      lineColor,
      topColor: `${lineColor}33`,
      bottomColor: `${lineColor}05`,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    series.setData(
      points.map((point) => ({ time: point.time as UTCTimestamp, value: point.close })),
    );
    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;

    // The chart cannot size itself; it needs to be told when its container changes.
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    observer.observe(container);
    chart.applyOptions({ width: container.clientWidth });

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [points, height, summary?.changePct, theme]);

  if (!summary) {
    return (
      <p className={styles.empty}>
        No price history is available for this asset from the current provider.
      </p>
    );
  }

  const rows = tableRows(points);

  return (
    <div className={styles.wrapper}>
      {/* The visual layer. Everything it conveys is also in the summary and table below. */}
      <div ref={containerRef} className={styles.canvas} aria-hidden="true" />

      <p id={summaryId} className={styles.summary}>
        <span className="visually-hidden">Price chart for {label}. </span>
        {summary.pointCount} points from {formatAbsoluteTime(summary.first.time)} to{' '}
        {formatAbsoluteTime(summary.last.time)}. Opened {formatPrice(summary.first.close, currency)}
        , closed {formatPrice(summary.last.close, currency)}
        {summary.changePct !== null ? <> ({formatPercent(summary.changePct)})</> : null}. High{' '}
        {formatPrice(summary.high.close, currency)}, low {formatPrice(summary.low.close, currency)}.
      </p>

      <Button
        variant="ghost"
        size="sm"
        aria-expanded={showTable}
        onClick={() => setShowTable((open) => !open)}
      >
        {showTable ? 'Hide the underlying numbers' : 'Show the underlying numbers'}
      </Button>

      {showTable ? (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <caption className={styles.caption}>
              Price points behind the chart for {label}
              {points.length > rows.length ? (
                <>
                  {' '}
                  — {rows.length} of {points.length} points, including the high and the low
                </>
              ) : null}
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((point) => (
                <tr key={point.time}>
                  <td>
                    <time dateTime={new Date(point.time * 1000).toISOString()}>
                      {formatAbsoluteTime(point.time)}
                    </time>
                  </td>
                  <td className="tabular">{formatPrice(point.close, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
