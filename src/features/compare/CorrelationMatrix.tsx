import { useMemo, useState } from 'react';
import { correlationMatrix, MIN_SAMPLES } from '@/lib/correlation';
import type { AssetSeries } from '@/types/domain';
import styles from './CompareRoute.module.css';

interface CorrelationMatrixProps {
  series: AssetSeries[];
}

/**
 * How closely the selected assets have moved together.
 *
 * A diverging encoding, because correlation has a meaningful zero: strong either way is
 * saturated, uncorrelated is the neutral surface. The pair is orange↔blue rather than the app's
 * red/green — those are reserved status colours, and red-green is the pair a deuteranope cannot
 * read. Every cell also carries its number, so colour is never the only channel.
 */
export function CorrelationMatrix({ series }: CorrelationMatrixProps) {
  const [hover, setHover] = useState<{ a: string; b: string; value: number | null } | null>(null);

  const matrix = useMemo(
    () => correlationMatrix(series.map((s) => ({ symbol: s.symbol, points: s.points }))),
    [series],
  );

  if (matrix.symbols.length < 2) {
    return (
      <p className={styles.note}>
        {matrix.excluded.length > 0
          ? `Not enough shared history to correlate ${matrix.excluded.join(', ')}. At least ${MIN_SAMPLES} overlapping observations are needed.`
          : 'Pick at least two assets to compare.'}
      </p>
    );
  }

  return (
    <div className={styles.matrixWrap}>
      <table className={styles.matrix}>
        <caption className="visually-hidden">
          Correlation of daily returns between {matrix.symbols.join(', ')}
        </caption>
        <thead>
          <tr>
            <td className={styles.corner} />
            {matrix.symbols.map((symbol) => (
              <th key={symbol} scope="col" className={styles.matrixHead}>
                {symbol}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.symbols.map((rowSymbol, i) => (
            <tr key={rowSymbol}>
              <th scope="row" className={styles.matrixHead}>
                {rowSymbol}
              </th>
              {matrix.symbols.map((colSymbol, j) => {
                const value = matrix.cells[i]?.[j] ?? null;
                return (
                  <td
                    key={colSymbol}
                    className={styles.cell}
                    style={value === null ? undefined : { background: fillFor(value) }}
                    onMouseEnter={() => setHover({ a: rowSymbol, b: colSymbol, value })}
                    onMouseLeave={() => setHover(null)}
                  >
                    {/* The number is always present: colour is a second channel, never the only one. */}
                    <span
                      className={
                        value !== null && Math.abs(value) > 0.55 ? styles.cellStrong : undefined
                      }
                    >
                      {value === null ? '—' : value.toFixed(2)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.legendRow}>
        <span className={styles.legendLabel}>−1</span>
        <span className={styles.legendRamp} aria-hidden="true" />
        <span className={styles.legendLabel}>+1</span>
        <span className={styles.legendCaption}>moves opposite · unrelated · moves together</span>
      </div>

      <p className={styles.note} role="status">
        {hover
          ? hover.value === null
            ? `${hover.a} and ${hover.b} share too little history to correlate.`
            : `${hover.a} and ${hover.b}: ${hover.value.toFixed(2)}`
          : `Pearson correlation of daily returns, over the ${matrix.minSamples} periods these assets share. Correlating prices instead would make any two things that rose look identical.`}
      </p>

      {matrix.excluded.length > 0 ? (
        <p className={styles.note}>Left out for want of history: {matrix.excluded.join(', ')}.</p>
      ) : null}
    </div>
  );
}

/**
 * Diverging fill: neutral at zero, saturating toward either pole.
 *
 * `color-mix` in oklab keeps the ramp perceptually even and lets each theme supply its own
 * validated endpoints, rather than hardcoding three sets of hex.
 */
function fillFor(value: number): string {
  const magnitude = Math.min(1, Math.abs(value));
  const pole = value >= 0 ? 'var(--chart-corr-positive)' : 'var(--chart-corr-negative)';
  return `color-mix(in oklab, ${pole} ${Math.round(magnitude * 78)}%, var(--chart-corr-neutral))`;
}
