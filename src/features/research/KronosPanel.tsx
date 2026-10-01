import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ProviderBadge } from '@/components/status/ProviderBadge';
import { formatAbsoluteTime, formatPrice } from '@/lib/format';
import { ipc } from '@/lib/ipc';
import { usePreferences, useSetPreference } from '@/lib/preferences';
import type { KronosProjection, KronosStatus } from '@/types/domain';
import styles from './KronosPanel.module.css';

interface KronosPanelProps {
  assetId: string;
  symbol: string;
  currency: string;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** "4-hour", "daily", "3-day" — the candle size as a reader would say it. */
function candleSize(intervalSecs: number): string {
  const hours = intervalSecs / 3600;
  if (hours < 24) return `${hours}-hour`;
  return hours === 24 ? 'daily' : `${hours / 24}-day`;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'The model could not be run.';
}

/**
 * The Kronos projection.
 *
 * The only place in the app that shows anything about the future, so it is built to be hard to
 * misread: it is labelled as a third party's model at every step, it will not run until the
 * reader has agreed to a statement of what it is, and it never draws a single line without the
 * spread of the model's own draws around it. The Rust service enforces the agreement as well —
 * this component is not the only thing standing in front of the model.
 */
export function KronosPanel({ assetId, symbol, currency }: KronosPanelProps) {
  const queryClient = useQueryClient();
  const { data: preferences } = usePreferences();
  const setPreference = useSetPreference();
  const [consentOpen, setConsentOpen] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['kronos-status'],
    queryFn: () => ipc('get_kronos_status'),
  });

  const setStatus = (next: KronosStatus): void => {
    queryClient.setQueryData(['kronos-status'], next);
  };

  const download = useMutation({ mutationFn: () => ipc('download_kronos'), onSuccess: setStatus });
  const projection = useMutation({
    mutationFn: () => ipc('run_kronos_projection', { assetId }),
  });
  const remove = useMutation({
    mutationFn: () => ipc('delete_kronos'),
    onSuccess: (next) => {
      setStatus(next);
      projection.reset();
    },
  });

  // Polled only while this panel's own download is running, so an idle app makes no calls.
  const { data: progress } = useQuery({
    queryKey: ['download-progress'],
    queryFn: () => ipc('get_download_progress'),
    refetchInterval: 500,
    enabled: download.isPending,
  });

  const agree = (): void => {
    setPreference.mutate({ key: 'kronosAcknowledged', value: true });
    setConsentOpen(false);
  };

  const acknowledged = preferences?.kronosAcknowledged === true;
  const result = projection.data;

  return (
    <Panel
      title="Kronos projection"
      meta="Output of a third-party AI model. It is often wrong, and it is not advice."
      actions={result ? <ProviderBadge meta={result.meta} /> : undefined}
    >
      <div className={styles.body}>
        <p className={styles.lead}>
          Kronos is an open-source AI model trained on price candles from many exchanges. Given the
          recent candles for {symbol}, it generates candles that could come next. It is made by{' '}
          {status?.publisher ?? 'a third party'}, not by Brew Terminal.
        </p>

        <details className={styles.details}>
          <summary>How it works, and what it cannot tell you</summary>
          <ul className={styles.list}>
            <li>
              <strong>What it is.</strong> {status?.model ?? 'Kronos'}, a {status?.parameters ?? ''}{' '}
              parameter model published under the {status?.licence ?? 'MIT'} licence. It reads
              candles the way a language model reads words, and continues the sequence.{' '}
              {status ? (
                <>
                  <a href={status.sourceUrl} target="_blank" rel="noreferrer noopener">
                    Source code
                  </a>{' '}
                  ·{' '}
                  <a href={status.paperUrl} target="_blank" rel="noreferrer noopener">
                    Research paper
                  </a>
                </>
              ) : null}
            </li>
            <li>
              <strong>Where it runs.</strong> On this computer. The model file is downloaded once
              and checked against its published checksum. The only request a run makes is for the
              candles themselves, from the same provider that draws the chart above.
            </li>
            <li>
              <strong>What the picture shows.</strong> The model is run twenty times, each time
              making different random choices. The dashed line is the average of those runs. The
              shaded band is the lowest and the highest run at each step.
            </li>
            <li>
              <strong>What the band is not.</strong> It is not a probability, a confidence range or
              a level the price is expected to reach. It is the spread of one model&rsquo;s own
              guesses, and the real price can land outside it.
            </li>
            <li>
              <strong>What it has never seen.</strong> News, earnings, interest rates, or anything
              else that is not in the candles. It continues patterns in past prices and nothing
              more.
            </li>
            <li>
              <strong>Why it gives the same answer twice.</strong> The random choices start from a
              fixed seed, so the same candles always give the same picture. Nothing is adjusted
              between runs.
            </li>
          </ul>
        </details>

        {!acknowledged ? (
          <div className={styles.step}>
            <p className={styles.hint}>
              Kronos is off. Switching it on asks you to read and accept what it is, once.
            </p>
            <Button variant="primary" size="sm" onClick={() => setConsentOpen(true)}>
              Switch on Kronos
            </Button>
          </div>
        ) : null}

        {acknowledged && status && !status.installed ? (
          <div className={styles.step}>
            <p className={styles.hint}>
              The model is not on this computer yet. It is a {megabytes(status.downloadBytes)}{' '}
              download from the publisher&rsquo;s page on Hugging Face, verified before it is used,
              and you can remove it at any time.
            </p>
            {download.isPending ? (
              <div className={styles.progress}>
                <progress
                  className={styles.bar}
                  aria-label="Download progress"
                  value={progress?.downloadedBytes ?? 0}
                  max={progress?.totalBytes || 1}
                />
                <span className={styles.hint}>
                  {progress
                    ? `${megabytes(progress.downloadedBytes)} of ${megabytes(progress.totalBytes)} — file ${
                        progress.itemId === 'kronos-model' ? 2 : 1
                      } of 2`
                    : 'Starting…'}
                </span>
                <Button variant="ghost" size="sm" onClick={() => void ipc('cancel_download')}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="primary" size="sm" onClick={() => download.mutate()}>
                Download the model ({megabytes(status.downloadBytes)})
              </Button>
            )}
            {download.isError ? (
              <p className={styles.error} role="alert">
                {errorMessage(download.error)}
              </p>
            ) : null}
          </div>
        ) : null}

        {acknowledged && status?.installed ? (
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="sm"
              onClick={() => projection.mutate()}
              disabled={projection.isPending}
            >
              {projection.isPending ? 'Running the model…' : `Run Kronos on ${symbol}`}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove.mutate()}
              disabled={projection.isPending}
            >
              Remove the model from this computer
            </Button>
          </div>
        ) : null}

        <div role="status" className={styles.status}>
          {projection.isPending
            ? 'Running on this computer. This takes several seconds, around ten on an older laptop, and uses the processor heavily.'
            : null}
          {result && result.data === null
            ? (result.meta.degraded?.message ??
              'There is not enough candle history for this asset for the model to run on.')
            : null}
        </div>

        {projection.isError ? (
          <p className={styles.error} role="alert">
            {errorMessage(projection.error)}
          </p>
        ) : null}

        {result?.data ? <Result projection={result.data} currency={currency} /> : null}
      </div>

      {consentOpen ? (
        <Modal open onClose={() => setConsentOpen(false)} title="Before you use Kronos">
          <div className={styles.consent}>
            <p>
              <strong>This is an AI model, and it makes mistakes.</strong> Kronos generates candles
              that continue a price history. It is frequently wrong, sometimes badly, and nothing it
              produces tells you how likely any outcome is.
            </p>
            <p>
              <strong>It is not ours.</strong> Kronos is made and published by{' '}
              {status?.publisher ?? 'a third party'} under the {status?.licence ?? 'MIT'} licence.
              Brew Terminal runs it unchanged on your computer. We did not train it, we have not
              verified its accuracy, and we do not vouch for what it produces.
            </p>
            <p>
              <strong>It is not advice, and the responsibility is yours.</strong> What it shows is
              not a recommendation to buy, sell or hold anything. If you make a trade or any other
              decision using it, that decision and its results are yours alone. Brew Terminal and
              its contributors accept no responsibility for any loss.
            </p>
            <p className={styles.hint}>
              You will be asked this once. You can read it again under &ldquo;How it works&rdquo; in
              the panel.
            </p>
            <div className={styles.consentActions}>
              <Button variant="ghost" size="sm" onClick={() => setConsentOpen(false)}>
                Not now
              </Button>
              <Button variant="primary" size="sm" onClick={agree}>
                I understand and agree
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </Panel>
  );
}

const WIDTH = 600;
const HEIGHT = 180;
const PAD = 8;

/**
 * The picture, the sentence and the table — in that order of precision.
 *
 * The drawing is `aria-hidden`: everything it shows is stated in the sentence under it and
 * listed in the table, which is the accessible form rather than an alternative to it.
 */
function Result({ projection, currency }: { projection: KronosProjection; currency: string }) {
  const { history, points, paths } = projection;
  const lastClose = history[history.length - 1]?.close;
  const final = points[points.length - 1];
  if (lastClose === undefined || !final) return null;

  const values = [...history.map((p) => p.close), ...points.flatMap((p) => [p.low, p.high])];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const count = history.length + points.length;

  const x = (index: number): number => PAD + (index / (count - 1)) * (WIDTH - 2 * PAD);
  const y = (value: number): number =>
    HEIGHT - PAD - ((value - min) / (max - min || 1)) * (HEIGHT - 2 * PAD);
  const at = (index: number, value: number): string =>
    `${x(index).toFixed(1)},${y(value).toFixed(1)}`;

  const now = history.length - 1;
  const recorded = history.map((p, i) => at(i, p.close)).join(' ');
  const average = [at(now, lastClose), ...points.map((p, i) => at(now + 1 + i, p.mean))].join(' ');
  const band = [
    at(now, lastClose),
    ...points.map((p, i) => at(now + 1 + i, p.high)),
    ...points.map((p, i) => at(now + 1 + i, p.low)).reverse(),
  ].join(' ');

  const price = (value: number): string => formatPrice(value, currency);

  return (
    <div className={styles.result}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polygon className={styles.band} points={band} />
        <line className={styles.now} x1={x(now)} x2={x(now)} y1={PAD} y2={HEIGHT - PAD} />
        <polyline className={styles.recorded} points={recorded} />
        <polyline className={styles.average} points={average} />
      </svg>

      <ul className={styles.legend}>
        <li>
          <span className={`${styles.swatch} ${styles.swatchRecorded}`} /> Recorded closes
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.swatchAverage}`} /> Average of {paths} model
          runs
        </li>
        <li>
          <span className={`${styles.swatch} ${styles.swatchBand}`} /> Lowest to highest run
        </li>
      </ul>

      <p className={styles.summary}>
        The last recorded close was <span className="tabular">{price(lastClose)}</span>. Across{' '}
        {paths} runs of the model, the average close {points.length} candles ahead (
        {formatAbsoluteTime(final.time)}) is <span className="tabular">{price(final.mean)}</span>,
        with the lowest run at <span className="tabular">{price(final.low)}</span> and the highest
        at <span className="tabular">{price(final.high)}</span>. This is what the model generated,
        not what will happen.
      </p>

      <p className={styles.hint}>
        {projection.model} · run on this computer in {(projection.elapsedMs / 1000).toFixed(1)} s ·
        given {projection.contextCandles} {candleSize(projection.intervalSecs)} candles ·{' '}
        {projection.hasVolume ? 'with volume' : 'prices only, the provider reports no volume'}
      </p>

      <details className={styles.details}>
        <summary>Show the numbers</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className="visually-hidden">
              Model output for each projected candle: average, lowest and highest run
            </caption>
            <thead>
              <tr>
                <th scope="col">Candle</th>
                <th scope="col">Average</th>
                <th scope="col">Lowest run</th>
                <th scope="col">Highest run</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.time}>
                  <th scope="row">{formatAbsoluteTime(point.time)}</th>
                  <td className="tabular">{price(point.mean)}</td>
                  <td className="tabular">{price(point.low)}</td>
                  <td className="tabular">{price(point.high)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
