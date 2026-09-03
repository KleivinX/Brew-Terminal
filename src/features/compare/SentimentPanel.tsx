import { useQuery } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { ProviderBadge } from '@/components/status/ProviderBadge';
import { ExplainWithModel } from '@/components/ai/ExplainWithModel';
import { SkeletonRows } from '@/components/status/Skeleton';
import { ipc } from '@/lib/ipc';
import { formatAbsoluteTime } from '@/lib/format';
import { describeSentiment } from '@/lib/aiContext';
import type { Envelope } from '@/types/envelope';
import type { SentimentBand, SentimentComponent, SentimentIndex } from '@/types/domain';
import styles from './SentimentPanel.module.css';

/** Both indices are daily figures, so an hour between refetches is already generous. */
const STALE_TIME = 60 * 60_000;

const BAND_LABEL: Record<SentimentBand, string> = {
  'extreme-fear': 'Extreme fear',
  fear: 'Fear',
  neutral: 'Neutral',
  greed: 'Greed',
  'extreme-greed': 'Extreme greed',
};

/**
 * Market mood.
 *
 * Two indices that answer the same question for different markets, and arrive by completely
 * different routes: the crypto one is published by someone else and reported here, the equity
 * one is computed here from Federal Reserve series. The card says which, every time — a
 * reported figure and a derived one carry different warranties, and a reader who cannot tell
 * them apart is being asked to trust the wrong thing.
 *
 * The stock card shows its four components rather than only the composite. That is the point
 * of the feature: a single number is a verdict, and four numbers with their inputs named is
 * something you can argue with.
 */
export function SentimentPanel() {
  const crypto = useQuery({
    queryKey: ['sentiment', 'crypto'],
    queryFn: () => ipc('get_crypto_sentiment'),
    staleTime: STALE_TIME,
  });

  const stocks = useQuery({
    queryKey: ['sentiment', 'stocks'],
    queryFn: () => ipc('get_stock_sentiment'),
    staleTime: STALE_TIME,
  });

  const loading = crypto.isLoading || stocks.isLoading;

  return (
    <Panel
      title="Market mood"
      className={styles.panel}
      meta="Fear and greed, measured two different ways. Neither is a forecast."
    >
      {loading ? <SkeletonRows rows={2} columns={2} label="Loading market sentiment" /> : null}

      {!loading ? (
        <div className={styles.cards}>
          <IndexCard
            heading="Crypto"
            envelope={crypto.data}
            error={Boolean(crypto.error)}
            onRetry={() => void crypto.refetch()}
          />
          <IndexCard
            heading="Stocks"
            envelope={stocks.data}
            error={Boolean(stocks.error)}
            onRetry={() => void stocks.refetch()}
          />
        </div>
      ) : null}
    </Panel>
  );
}

interface IndexCardProps {
  heading: string;
  envelope: Envelope<SentimentIndex | null> | undefined;
  error: boolean;
  onRetry: () => void;
}

function IndexCard({ heading, envelope, error, onRetry }: IndexCardProps) {
  const index = envelope?.data ?? null;

  /*
   * A missing reading is stated, never drawn as a number. Zero is a real value on this scale —
   * maximum fear — so an unreachable provider must not be able to render as one.
   */
  if (!index) {
    const reason = envelope?.meta.degraded?.message;
    return (
      <article className={styles.card} aria-label={`${heading} fear and greed`}>
        <h3 className={styles.heading}>{heading}</h3>
        <p className={styles.unavailable}>
          {error || reason
            ? (reason ?? 'This reading could not be loaded just now.')
            : 'No reading is available yet.'}
        </p>
        <button type="button" className={styles.retry} onClick={onRetry}>
          Try again
        </button>
      </article>
    );
  }

  const monthAgo = valueDaysAgo(index, 30);
  const bandLabel = BAND_LABEL[index.band];
  const headingId = `sentiment-${index.market}`;

  /*
   * Shown only when the publisher's own wording differs from this app's band. Both indices are
   * relabelled with one shared five-band scale so the two gauges are comparable, and quietly
   * overwriting a publisher's own word for their own number would not be reporting it.
   */
  const publisherDiffers =
    index.publisherLabel !== null && index.publisherLabel.toLowerCase() !== bandLabel.toLowerCase();

  return (
    <article className={styles.card} aria-label={`${heading} fear and greed`}>
      <div className={styles.cardHead}>
        <h3 className={styles.heading}>{heading}</h3>
        <span className={index.basis === 'computed' ? styles.basisComputed : styles.basisPublished}>
          {index.basis === 'computed' ? 'Computed here' : 'Published figure'}
        </span>
      </div>

      <div className={styles.figure}>
        <span className={[styles.value, 'tabular'].join(' ')}>{index.value}</span>
        <span className={styles.band} data-band={index.band}>
          {bandLabel}
        </span>
      </div>

      <Gauge value={index.value} label={`${heading}: ${index.value} out of 100, ${bandLabel}`} />

      {publisherDiffers ? (
        <p className={styles.note}>
          Alternative.me publish this as “{index.publisherLabel}”. The band above is this app’s,
          applied to both indices so the two can be read side by side.
        </p>
      ) : null}

      <p className={styles.asOf}>
        Reading for {formatAbsoluteTime(index.asOf)}
        {monthAgo !== null ? (
          <>
            {' · '}
            <span className="tabular">{monthAgo}</span> a month ago
          </>
        ) : null}
      </p>

      {index.history.length > 1 ? (
        <Trend
          history={index.history}
          label={`${heading} over the last ${index.history.length} readings`}
        />
      ) : null}

      {index.components.length > 0 ? (
        <>
          <h4 className={styles.componentsHeading} id={`${headingId}-components`}>
            What goes into it
          </h4>
          <ul className={styles.components} aria-labelledby={`${headingId}-components`}>
            {index.components.map((component) => (
              <ComponentRow key={component.id} component={component} />
            ))}
          </ul>
        </>
      ) : null}

      <details className={styles.method}>
        <summary className={styles.summary}>How this number is made</summary>
        <p className={styles.methodBody}>{index.methodology}</p>
        {index.components.length > 0 ? (
          <ul className={styles.methodList}>
            {index.components.map((component) => (
              <li key={component.id}>
                <strong>{component.name}</strong> — {component.method}{' '}
                <span className={styles.series}>Source: {component.sourceSeries.join(', ')}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </details>

      {envelope ? (
        <div className={styles.badge}>
          <ProviderBadge meta={envelope.meta} />
          {/*
            The components are what makes this worth asking about. A model handed "68" can only
            paraphrase it; handed the four inputs and their arithmetic it has something to
            explain — which is the same reason the panel shows them rather than the composite
            alone.
          */}
          <ExplainWithModel
            kind="sentiment-reading"
            label={`${heading} Fear & Greed: ${index.value}`}
            text={describeSentiment(index, envelope.meta)}
            buttonLabel="Ask about this"
            excludes="no watchlist, no portfolio, no notes"
          />
        </div>
      ) : null}
    </article>
  );
}

function ComponentRow({ component }: { component: SentimentComponent }) {
  return (
    <li className={styles.component}>
      <div className={styles.componentHead}>
        <span className={styles.componentName}>{component.name}</span>
        <span className={[styles.componentScore, 'tabular'].join(' ')}>{component.score}</span>
      </div>
      <div
        className={styles.componentTrack}
        role="meter"
        aria-valuenow={component.score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${component.score} out of 100, ${BAND_LABEL[component.band]}`}
        aria-label={component.name}
      >
        <span
          className={styles.componentFill}
          data-band={component.band}
          style={{ width: `${component.score}%` }}
        />
      </div>
      <p className={styles.reading}>{component.reading}</p>
      {/*
        Named on the row rather than only in the disclosure. A component that measures fear but
        scores as greed is not a bug, it is an inversion — and the reader can only reconcile a
        VIX above its average with a score of 68 if the card says so.
      */}
      {component.inverted ? (
        <p className={styles.inverted}>Inverted: a higher reading here means more fear.</p>
      ) : null}
    </li>
  );
}

/**
 * The 0–100 scale.
 *
 * Diverging blue↔orange rather than the conventional red↔green. That is not a style preference:
 * `tokens.css` reserves red and green for status, and notes that red-green is precisely the
 * pair a deuteranope cannot separate. This reuses the validated correlation pair, and the band
 * is written out in text beside it regardless, so colour is never the only channel.
 */
function Gauge({ value, label }: { value: number; label: string }) {
  return (
    <div
      className={styles.gauge}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={label}
      aria-label={label}
    >
      <div className={styles.gaugeTrack}>
        <span className={styles.gaugeMarker} style={{ left: `${value}%` }} />
      </div>
      <div className={styles.gaugeScale} aria-hidden="true">
        <span>0 · fear</span>
        <span>50</span>
        <span>greed · 100</span>
      </div>
    </div>
  );
}

/**
 * The recent path of the index.
 *
 * Fixed to the full 0–100 scale rather than to the range of the data. An auto-scaled sentiment
 * line turns a five-point wobble into a dramatic mountain, which is the chart equivalent of
 * overstating the case.
 */
function Trend({ history, label }: { history: { time: number; value: number }[]; label: string }) {
  const path = history
    .map((point, i) => {
      const x = (i / (history.length - 1)) * 100;
      const y = 30 - (point.value / 100) * 28 - 1;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const first = history[0];
  const last = history[history.length - 1];

  return (
    <svg
      className={styles.trend}
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label}. From ${first?.value ?? 0} to ${last?.value ?? 0} on a 0 to 100 scale.`}
    >
      {/* The neutral midpoint, so the line is read against something. */}
      <line
        x1="0"
        y1={30 - 0.5 * 28 - 1}
        x2="100"
        y2={30 - 0.5 * 28 - 1}
        stroke="var(--chart-grid)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={path}
        fill="none"
        stroke="var(--chart-corr-positive)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * The reading `days` ago, or `null` when the history does not reach that far back.
 *
 * Mirrors `SentimentIndex::value_days_ago` on the Rust side: strictly at or before the target,
 * so a weekend resolves backwards to the previous session and never forwards to a value that
 * had not happened yet.
 */
export function valueDaysAgo(index: SentimentIndex, days: number): number | null {
  const target = index.asOf - days * 86_400;
  const oldest = index.history[0];
  if (!oldest || oldest.time > target) return null;

  for (let i = index.history.length - 1; i >= 0; i -= 1) {
    const point = index.history[i];
    if (point && point.time <= target) return point.value;
  }
  return null;
}
