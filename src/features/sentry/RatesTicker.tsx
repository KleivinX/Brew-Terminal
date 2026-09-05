import { ChangeValue } from '@/components/data/ChangeValue';
import { Icon } from '@/components/ui/Icon';
import type { LayerStatus, RateQuote } from '@/types/domain';
import styles from './RatesTicker.module.css';

/**
 * The bottom bar: reference rates, and which sources are answering.
 *
 * Two things share it because they answer the same question — what is the board standing on
 * right now. The rates come from central bank publications and the status line names every
 * source behind the map.
 *
 * The date on each rate is shown, not implied. Central banks publish once a working day, so
 * over a weekend the newest figure is Friday's, and a ticker that hid that would be presenting
 * a three-day-old number as a live cross.
 */

interface RatesTickerProps {
  rates: RateQuote[];
  layers: LayerStatus[];
}

export function RatesTicker({ rates, layers }: RatesTickerProps) {
  const live = layers.filter((layer) => layer.enabled && layer.meta && !layer.meta.degraded);
  const failing = layers.filter((layer) => layer.meta?.degraded);
  const date = rates[0]?.date ?? null;

  return (
    <div className={styles.bar}>
      <div className={styles.rates}>
        {rates.length === 0 ? (
          <span className={styles.quiet}>No reference rates on this refresh.</span>
        ) : (
          <ul role="list" className={styles.list}>
            {rates.map((rate) => (
              <li key={`${rate.base}${rate.quote}`} className={styles.rate}>
                <span className={styles.pair}>
                  {rate.base}/{rate.quote}
                </span>
                <span className={styles.value}>{formatRate(rate.rate)}</span>
                {/*
                  A dash rather than a zero where there is no earlier publication to compare
                  against. "Unchanged" is a claim; "we do not know yet" is a different one, and
                  ChangeValue renders null as the second.
                */}
                <ChangeValue value={rate.changePct} period="change on the previous publication" />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        One live region for the whole bar, on a wrapper rather than on the list — role="status"
        on a <ul> or <li> replaces the list role and orphans the items. Same shape as ToastHost
        and the Atlas status line.
      */}
      <div className={styles.status} role="status" aria-live="polite">
        <span
          className={styles.dot}
          data-state={failing.length > 0 ? 'degraded' : 'ok'}
          aria-hidden="true"
        />
        <span className={styles.statusText}>
          Sentry:{' '}
          {live.length > 0 ? (
            <>
              {live.length} {live.length === 1 ? 'source' : 'sources'} answering
            </>
          ) : (
            <>no source answering</>
          )}
          {failing.length > 0 ? (
            <>
              {' '}
              · <Icon name="warning" size={11} /> {failing.map((l) => l.label).join(', ')}{' '}
              unavailable
            </>
          ) : null}
          {date ? <span className={styles.date}> · rates published {date}</span> : null}
        </span>
      </div>
    </div>
  );
}

/**
 * Significant figures rather than a fixed decimal count.
 *
 * A single rule cannot serve both USD/JPY at 156.61 and a rate that sits below 1: four decimal
 * places makes the first unreadable and two rounds the second into uselessness. Four
 * significant figures reads correctly for every pair on the bar.
 */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return '—';
  if (rate >= 100) return rate.toFixed(2);
  if (rate >= 1) return rate.toFixed(3);
  return rate.toFixed(4);
}
