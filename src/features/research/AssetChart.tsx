import { useEffect, useId, useRef, useState } from 'react';
import {
  createChart,
  createSeriesMarkers,
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
import { bollinger, closes, ema, sma, type IndicatorSeries } from './indicators';
import type { ChartPoint } from '@/types/domain';
import styles from './AssetChart.module.css';

interface AssetChartProps {
  points: ChartPoint[];
  currency: string;
  /** Used in the accessible description, e.g. "BTC · 1 month". */
  label: string;
  height?: number;
  /**
   * Notes pinned to a day, drawn as markers under the line.
   *
   * The reason this exists: "why did I buy here" is a question asked a year later while looking
   * at the point on the chart, and the answer is useless anywhere else. Only notes with a
   * `pinnedAt` appear — a note about the holding generally has no place on a date axis.
   */
  pins?: { id: string; title: string; pinnedAt: number }[] | undefined;
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
export function AssetChart({ points, currency, label, height = 260, pins }: AssetChartProps) {
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
  const [active, setActive] = useState<OverlayId[]>([]);
  const summaryId = useId();

  const values = closes(points);
  const available = OVERLAYS.filter((o) => values.length >= o.minimum);
  // An overlay whose window no longer fits the selected range would silently draw nothing.
  const drawn = active.filter((id) => available.some((o) => o.id === id));

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

    /*
     * Overlays share the price scale, so they are drawn as plain lines with no last-value label
     * — four price tags stacked on the axis makes the actual price harder to read, which is the
     * opposite of the point.
     */
    const overlayColor = token('--text-muted', '#79838f');
    const bandColor = token('--border-strong', '#39414d');

    const plot = (line: IndicatorSeries, color: string, width: 1 | 2, dashed = false): void => {
      const data = points
        .map((point, i) => ({ time: point.time as UTCTimestamp, value: line[i] }))
        .filter(
          (d): d is { time: UTCTimestamp; value: number } =>
            d.value !== null && d.value !== undefined,
        );
      if (data.length === 0) return;

      chart
        .addSeries(LineSeries, {
          color,
          lineWidth: width,
          lineStyle: dashed ? 2 : 0,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        .setData(data);
    };

    for (const id of drawn) {
      if (id === 'sma50') plot(sma(values, 50), overlayColor, 1);
      if (id === 'sma200') plot(sma(values, 200), overlayColor, 2);
      if (id === 'ema20') plot(ema(values, 20), token('--accent', '#4c8dff'), 1);
      if (id === 'bollinger') {
        const bands = bollinger(values, 20, 2);
        plot(bands.upper, bandColor, 1, true);
        plot(bands.lower, bandColor, 1, true);
      }
    }

    /*
     * Markers for pinned notes, clamped to the chart's own range. A marker outside it is not
     * drawn by the library but does widen the time scale, which would stretch a one-month view
     * back to whenever the oldest note was pinned.
     */
    if (pins && pins.length > 0) {
      const first = points[0]?.time;
      const last = points[points.length - 1]?.time;

      if (first !== undefined && last !== undefined) {
        const inRange = pins
          .filter((pin) => pin.pinnedAt >= first && pin.pinnedAt <= last)
          .sort((a, b) => a.pinnedAt - b.pinnedAt);

        if (inRange.length > 0) {
          createSeriesMarkers(
            series,
            inRange.map((pin) => ({
              time: pin.pinnedAt as UTCTimestamp,
              position: 'belowBar' as const,
              shape: 'circle' as const,
              color: token('--accent', '#f97316'),
              // The title, not an icon alone: the marker has to say what it marks, and the
              // chart is already carrying the date.
              text: pin.title || 'Note',
            })),
          );
        }
      }
    }

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
  }, [points, height, summary?.changePct, theme, drawn, values, pins]);

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

      {available.length > 0 ? (
        <div className={styles.overlays}>
          <span className={styles.overlaysLabel} id={`${summaryId}-overlays`}>
            Overlays
          </span>
          <div
            role="group"
            aria-labelledby={`${summaryId}-overlays`}
            className={styles.overlayButtons}
          >
            {available.map((overlay) => {
              const on = drawn.includes(overlay.id);
              return (
                <button
                  key={overlay.id}
                  type="button"
                  className={[styles.overlayToggle, on ? styles.overlayOn : null]
                    .filter(Boolean)
                    .join(' ')}
                  aria-pressed={on}
                  title={overlay.describe}
                  onClick={() =>
                    setActive((current) =>
                      current.includes(overlay.id)
                        ? current.filter((id) => id !== overlay.id)
                        : [...current, overlay.id],
                    )
                  }
                >
                  {overlay.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/*
        The canvas is aria-hidden, so an overlay drawn on it would be invisible to a screen
        reader. Its latest value is stated here instead — the same discipline the price summary
        already follows.
      */}
      {drawn.length > 0 ? (
        <p className={styles.overlaySummary}>
          {drawn.map((id) => {
            const overlay = OVERLAYS.find((o) => o.id === id);
            if (!overlay) return null;
            const latest = latestOf(id, values);
            return (
              <span key={id} className={styles.overlayReading}>
                {overlay.label}:{' '}
                {latest === null ? 'not enough history' : formatPrice(latest, currency)}
              </span>
            );
          })}
        </p>
      ) : null}

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

/** The most recent defined value of an overlay, for the text alternative. */
function latestOf(id: OverlayId, values: number[]): number | null {
  const series: IndicatorSeries =
    id === 'sma50'
      ? sma(values, 50)
      : id === 'sma200'
        ? sma(values, 200)
        : id === 'ema20'
          ? ema(values, 20)
          : bollinger(values, 20, 2).middle;

  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}
