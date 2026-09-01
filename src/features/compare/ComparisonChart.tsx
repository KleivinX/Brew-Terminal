import { useEffect, useId, useRef, useState } from 'react';
import { createChart, LineSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { useTheme } from '@/app/providers/ThemeProvider';
import { indexToBase } from '@/lib/correlation';
import { formatAbsoluteTime } from '@/lib/format';
import type { AssetSeries } from '@/types/domain';
import styles from './CompareRoute.module.css';

interface ComparisonChartProps {
  series: AssetSeries[];
  height?: number;
}

/** The validated categorical order. Assigned by position, never cycled. */
const SLOTS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'];

function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Several assets on one axis, each indexed to 100 at the start.
 *
 * Indexing is what makes a single axis honest. The alternative — a second y-scale for the
 * cheaper asset — is the most misleading thing a price comparison can do, because where the
 * lines cross becomes an artefact of where the author put the axes rather than anything about
 * the assets.
 *
 * Colour follows the asset, not its rank: removing one does not repaint the others.
 */
export function ComparisonChart({ series, height = 320 }: ComparisonChartProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [showTable, setShowTable] = useState(false);
  const summaryId = useId();

  const indexed = series.map((entry, i) => ({
    ...entry,
    slot: SLOTS[i % SLOTS.length] as string,
    points: indexToBase(entry.points),
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container || indexed.length === 0) return undefined;

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
        horzLines: { color: token('--chart-grid', '#232a33') },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      crosshair: { mode: 1 },
      handleScroll: false,
      handleScale: false,
    });

    for (const entry of indexed) {
      if (entry.points.length === 0) continue;
      chart
        .addSeries(LineSeries, {
          color: token(entry.slot, '#d16112'),
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        })
        .setData(entry.points.map((p) => ({ time: p.time as UTCTimestamp, value: p.close })));
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

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
    };
  }, [indexed, height, theme]);

  if (series.length === 0) {
    return <p className={styles.note}>Pick some assets to put on the same axis.</p>;
  }

  const first = indexed[0]?.points[0];
  const last = indexed[0]?.points[indexed[0].points.length - 1];

  return (
    <div className={styles.chartWrap}>
      <div ref={containerRef} className={styles.canvas} aria-hidden="true" />

      {/* Identity is never colour alone: a legend is always present. */}
      <ul className={styles.legend} role="list">
        {indexed.map((entry) => (
          <li key={entry.assetId} className={styles.legendItem}>
            <span
              className={styles.swatch}
              style={{ background: `var(${entry.slot})` }}
              aria-hidden="true"
            />
            <span className={styles.legendSymbol}>{entry.symbol}</span>
            <span className={['tabular', styles.legendValue].join(' ')}>
              {entry.points.length > 0
                ? `${(entry.points[entry.points.length - 1]?.close ?? 100).toFixed(1)}`
                : '—'}
            </span>
          </li>
        ))}
      </ul>

      <p id={summaryId} className={styles.note}>
        Each line starts at 100{first ? ` on ${formatAbsoluteTime(first.time)}` : ''}
        {last ? `, through ${formatAbsoluteTime(last.time)}` : ''}. A value of 150 means that asset
        is half as much again as where it started — the lines share one axis because they are all
        measured against their own starting point, not against each other in currency.
      </p>

      <button
        type="button"
        className={styles.tableToggle}
        aria-expanded={showTable}
        onClick={() => setShowTable((open) => !open)}
      >
        {showTable ? 'Hide the numbers' : 'Show the numbers'}
      </button>

      {showTable ? (
        <table className={styles.dataTable}>
          <caption className="visually-hidden">Indexed values, most recent last</caption>
          <thead>
            <tr>
              <th scope="col">Asset</th>
              <th scope="col">Start</th>
              <th scope="col">Latest</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {indexed.map((entry) => {
              const latest = entry.points[entry.points.length - 1]?.close ?? 100;
              return (
                <tr key={entry.assetId}>
                  <th scope="row">{entry.symbol}</th>
                  <td className="tabular">100.0</td>
                  <td className="tabular">{latest.toFixed(1)}</td>
                  <td className="tabular">{(latest - 100).toFixed(1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
