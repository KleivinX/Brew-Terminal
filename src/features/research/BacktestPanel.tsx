import { useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { Input } from '@/components/ui/Input';
import { formatPrice, formatPercent, formatAbsoluteTime } from '@/lib/format';
import { backtestContributions, type Cadence } from './backtest';
import type { ChartPoint } from '@/types/domain';
import styles from './BacktestPanel.module.css';

interface BacktestPanelProps {
  points: ChartPoint[];
  currency: string;
  symbol: string;
}

const CADENCES: { id: Cadence; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

/**
 * "What if I had been buying this all along."
 *
 * A question about the past with one correct answer, which is why it is here at all. The panel
 * says which period it covers and that the period is the whole of what it knows — the same
 * arithmetic over a different window gives a different answer, and a reader who cannot see the
 * window cannot judge the number.
 */
export function BacktestPanel({ points, currency, symbol }: BacktestPanelProps) {
  const [amount, setAmount] = useState('100');
  const [cadence, setCadence] = useState<Cadence>('weekly');

  const parsed = Number(amount);
  const result = backtestContributions(points, parsed, cadence);

  return (
    <Panel title="If you had been buying" meta="Arithmetic on the period shown, not a projection.">
      <div className={styles.body}>
        <div className={styles.controls}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="bt-amount">
              Amount each time
            </label>
            <Input
              id="bt-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
            />
          </div>

          <fieldset className={styles.fieldset}>
            <legend className={styles.label}>How often</legend>
            <div className={styles.radios}>
              {CADENCES.map((option) => (
                <label key={option.id} className={styles.radio}>
                  <input
                    type="radio"
                    name="bt-cadence"
                    checked={cadence === option.id}
                    onChange={() => setCadence(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {result === null ? (
          <p className={styles.empty}>
            {points.length === 0
              ? 'No price history is available for this asset, so there is nothing to work through.'
              : 'Enter an amount above zero.'}
          </p>
        ) : (
          <>
            <dl className={styles.figures}>
              <Figure label="Put in" value={formatPrice(result.invested, currency)} />
              <Figure
                label="Worth now"
                value={formatPrice(result.finalValue, currency)}
                tone={result.profit}
              />
              <Figure
                label="Difference"
                value={formatPrice(result.profit, currency)}
                sub={result.profitPct === null ? undefined : formatPercent(result.profitPct)}
                tone={result.profit}
              />
              <Figure
                label={`${symbol} held`}
                value={result.units.toFixed(result.units < 1 ? 6 : 3)}
              />
              <Figure
                label="Average paid"
                value={
                  result.averagePrice === null ? '—' : formatPrice(result.averagePrice, currency)
                }
                sub={`now ${formatPrice(result.finalPrice, currency)}`}
              />
              <Figure
                label="All at once instead"
                value={formatPrice(result.lumpSumValue, currency)}
                sub="same total, spent on day one"
              />
            </dl>

            <p className={styles.footnote}>
              {result.contributions.length} contributions between{' '}
              {formatAbsoluteTime(result.firstTime)} and {formatAbsoluteTime(result.lastTime)}. Buys
              land on the days this series has prices for. This is what did happen over that period,
              which is not a claim about what happens next.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function Figure({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  tone?: number | undefined;
}) {
  const toneClass =
    tone === undefined || tone === 0 ? undefined : tone > 0 ? styles.positive : styles.negative;
  return (
    <div className={styles.figure}>
      <dt className={styles.figureLabel}>{label}</dt>
      <dd className={[styles.figureValue, toneClass, 'tabular'].filter(Boolean).join(' ')}>
        {value}
        {sub ? <span className={styles.figureSub}>{sub}</span> : null}
      </dd>
    </div>
  );
}
