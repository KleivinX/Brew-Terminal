import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { SkeletonRows } from '@/components/status/Skeleton';
import { ipc } from '@/lib/ipc';
import { formatAbsoluteTime } from '@/lib/format';
import type { ChartRange } from '@/types/domain';
import styles from './CompareRoute.module.css';

interface MacroPanelProps {
  range: ChartRange;
}

/**
 * The macro backdrop.
 *
 * Notable for needing no key: FRED's CSV endpoint is open and the data is US federal government
 * output in the public domain, so this is the only provider in the app that works on first run
 * with nothing configured.
 *
 * A single series at a time, deliberately. Two macro measures on one chart would need two
 * y-scales — a percentage and an index do not share an axis — and a dual-axis chart is the most
 * misleading thing this could be.
 */
export function MacroPanel({ range }: MacroPanelProps) {
  const [selected, setSelected] = useState('DGS10');

  const { data: catalogue } = useQuery({
    queryKey: ['macro-series'],
    queryFn: () => ipc('list_macro_series'),
    staleTime: Infinity,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['macro', selected, range],
    queryFn: () => ipc('get_macro_series', { id: selected, range }),
    staleTime: 60 * 60_000,
  });

  const series = catalogue?.find((s) => s.id === selected);
  const points = data?.data ?? [];
  const latest = points[points.length - 1];
  const earliest = points[0];

  return (
    <Panel
      title="Macro backdrop"
      meta="From FRED. No key needed — US government data in the public domain."
    >
      <div className={styles.macro}>
        <div className={styles.macroPicker}>
          <label className={styles.label} htmlFor="macro-series">
            Series
          </label>
          <select
            id="macro-series"
            className={styles.select}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {(catalogue ?? []).map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        {series ? (
          <p className={styles.note}>
            {series.description} <span className={styles.frequency}>{series.frequency}.</span>
          </p>
        ) : null}

        {isLoading ? <SkeletonRows rows={3} columns={2} label="Loading series" /> : null}

        {!isLoading && latest && earliest ? (
          <>
            {/*
              A hero number rather than a chart: one macro series over a short range is a
              handful of points, and the figure itself is what carries the meaning.
            */}
            <div className={styles.macroFigure}>
              <span className={[styles.macroValue, 'tabular'].join(' ')}>
                {latest.close.toFixed(2)}
                {series?.unit === '%' ? '%' : ''}
              </span>
              <span className={styles.macroDelta}>
                {latest.close === earliest.close ? (
                  'unchanged over this range'
                ) : (
                  <>
                    {latest.close > earliest.close ? 'up from ' : 'down from '}
                    <span className="tabular">{earliest.close.toFixed(2)}</span> on{' '}
                    {formatAbsoluteTime(earliest.time)}
                  </>
                )}
              </span>
            </div>

            <Sparkline points={points} />

            <p className={styles.note}>
              {points.length} observations, latest {formatAbsoluteTime(latest.time)}.
            </p>
          </>
        ) : null}

        {!isLoading && points.length === 0 ? (
          <p className={styles.note}>This series could not be loaded just now.</p>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * A bare shape for the series. Inline SVG rather than the chart library — one line with no axes
 * does not need a canvas, and the numbers either side of it carry the actual values.
 */
function Sparkline({ points }: { points: { time: number; close: number }[] }) {
  if (points.length < 2) return null;

  const values = points.map((p) => p.close);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const path = points
    .map((point, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 30 - ((point.close - min) / span) * 28 - 1;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg
      className={styles.spark}
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Shape of the series: ${min.toFixed(2)} low, ${max.toFixed(2)} high`}
    >
      <path
        d={path}
        fill="none"
        stroke="var(--chart-2)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
