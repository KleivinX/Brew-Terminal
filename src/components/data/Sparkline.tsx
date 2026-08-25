import { useId, useMemo } from 'react';
import { direction } from '@/lib/format';
import styles from './Sparkline.module.css';

interface SparklineProps {
  points: number[];
  /** Change over the same window, used to pick colour and stroke pattern. */
  changePct: number | null;
  width?: number | undefined;
  height?: number | undefined;
  label: string;
}

const MAX_POINTS = 24;

/**
 * One `<path>` per sparkline.
 *
 * The brief forbids hundreds of SVG elements on the dashboard. With virtualization, a viewport
 * shows ~20 rows, so this is ~20 path nodes — not a chart library, not a canvas per row, and
 * no per-point circles. Series are downsampled at the adapter boundary and clamped again here.
 *
 * Negative series are dashed as well as coloured, so direction survives a greyscale display.
 */
export function Sparkline({ points, changePct, width = 72, height = 22, label }: SparklineProps) {
  const titleId = useId();
  const dir = direction(changePct);

  const path = useMemo(() => {
    if (points.length < 2) return null;

    // Clamp defensively: a provider that ignores our downsampling should not blow up the DOM.
    const series =
      points.length > MAX_POINTS
        ? Array.from({ length: MAX_POINTS }, (_, i) => {
            const index = Math.round((i * (points.length - 1)) / (MAX_POINTS - 1));
            return points[index] ?? 0;
          })
        : points;

    let min = Infinity;
    let max = -Infinity;
    for (const value of series) {
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

    const range = max - min || 1;
    const stepX = width / (series.length - 1);
    const padding = 2;
    const usableHeight = height - padding * 2;

    let d = '';
    for (let i = 0; i < series.length; i += 1) {
      const value = series[i] ?? min;
      const x = (i * stepX).toFixed(2);
      const y = (padding + usableHeight - ((value - min) / range) * usableHeight).toFixed(2);
      d += i === 0 ? `M${x} ${y}` : `L${x} ${y}`;
    }
    return d;
  }, [points, width, height]);

  if (!path) {
    return <span className={styles.unavailable}>—</span>;
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={[styles.spark, styles[dir]].join(' ')}
      role="img"
      aria-labelledby={titleId}
      preserveAspectRatio="none"
    >
      <title id={titleId}>{label}</title>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dir === 'down' ? '3 2' : undefined}
      />
    </svg>
  );
}
