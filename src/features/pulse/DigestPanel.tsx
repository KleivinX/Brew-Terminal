import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Icon } from '@/components/ui/Icon';
import { ChangeValue } from '@/components/data/ChangeValue';
import { ipc } from '@/lib/ipc';
import { useNews } from '@/lib/market';
import { useReadNews } from '@/lib/newsRead';
import type { Quote, SentimentIndex } from '@/types/domain';
import styles from './DigestPanel.module.css';

/**
 * What changed since you last looked.
 *
 * Every figure here already existed somewhere in the app. The reason to assemble them is that
 * answering "anything I should look at?" previously meant visiting four screens and holding the
 * answers in your head — which is a job the software should be doing.
 *
 * It lives on Pulse rather than on a route of its own for two reasons. Pulse's subtitle already
 * promises exactly this ("what is happening across the markets you follow"), and a tenth nav
 * item would have pushed something off the `Mod+1`–`9` range that only goes to nine — the exact
 * drift that had `Mod+1`–`5` pointing at stale routes before it was fixed.
 *
 * Nothing here is a recommendation. It reports what moved, what the indices read and what is
 * unread; which of those matters is the reader's call.
 */

/** How many movers to show per direction. Enough to be a signal, few enough to scan. */
const MOVERS = 3;

interface DigestPanelProps {
  /** The quotes Pulse already has, so this costs no extra request. */
  quotes: Quote[];
  /** True when those quotes are the user's watchlist rather than the whole market. */
  watching: boolean;
  /** Placement in the parent's grid. The route owns its layout, not this panel. */
  className?: string | undefined;
}

function sentimentSummary(index: SentimentIndex | null | undefined): string | null {
  if (!index) return null;

  const band = index.band.replace('-', ' ');
  const weekAgo = index.history.length > 0 ? valueDaysAgo(index, 7) : null;
  if (weekAgo === null) return `${index.value} · ${band}`;

  const delta = index.value - weekAgo;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'level';
  if (delta === 0) return `${index.value} · ${band} · level on a week ago`;
  return `${index.value} · ${band} · ${direction} ${Math.abs(delta)} on a week ago`;
}

/**
 * Mirrors `SentimentIndex::value_days_ago` in Rust: the nearest reading at or before the
 * target, and nothing at all when the history does not reach back that far.
 *
 * Not approximated to the oldest point available. A comparison labelled "a week ago" that is
 * silently answering for three days ago is worse than no comparison.
 */
function valueDaysAgo(index: SentimentIndex, days: number): number | null {
  const target = index.asOf - days * 86_400;
  const oldest = index.history[0];
  if (!oldest || oldest.time > target) return null;

  for (let i = index.history.length - 1; i >= 0; i -= 1) {
    const point = index.history[i];
    if (point && point.time <= target) return point.value;
  }
  return null;
}

export function DigestPanel({ quotes, watching, className }: DigestPanelProps) {
  const navigate = useNavigate();

  const { data: crypto } = useQuery({
    queryKey: ['sentiment', 'crypto'],
    queryFn: () => ipc('get_crypto_sentiment'),
    staleTime: 300_000,
  });
  const { data: stocks } = useQuery({
    queryKey: ['sentiment', 'stocks'],
    queryFn: () => ipc('get_stock_sentiment'),
    staleTime: 300_000,
  });

  const { data: news } = useNews('all');
  const { data: readUrls } = useReadNews();

  const { data: alerts } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => ipc('list_alerts'),
  });

  /*
   * Sorted by 24h change, ignoring anything the provider did not report one for. A missing
   * change is unknown, not zero — treating it as zero would park unpriced assets in the middle
   * of the list as though they had been flat.
   */
  const { gainers, losers } = useMemo(() => {
    const withChange = quotes.filter(
      (quote): quote is Quote & { changePct24h: number } => quote.changePct24h !== null,
    );
    const sorted = [...withChange].sort((a, b) => b.changePct24h - a.changePct24h);

    return {
      gainers: sorted.filter((q) => q.changePct24h > 0).slice(0, MOVERS),
      losers: sorted
        .filter((q) => q.changePct24h < 0)
        .slice(-MOVERS)
        .reverse(),
    };
  }, [quotes]);

  const unreadCount = useMemo(() => {
    const read = new Set(readUrls ?? []);
    return (news?.data ?? []).filter((article) => !read.has(article.url)).length;
  }, [news, readUrls]);

  const firedAlerts = (alerts ?? []).filter((alert) => alert.triggeredAt !== null);

  const cryptoLine = sentimentSummary(crypto?.data);
  const stocksLine = sentimentSummary(stocks?.data);

  return (
    <Panel
      title="Since you last looked"
      meta={watching ? 'Movers from your watchlist' : 'Movers from the market list'}
      className={[styles.panel, className].filter(Boolean).join(' ')}
    >
      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="digest-movers">
          <h3 id="digest-movers" className={styles.heading}>
            Movers
          </h3>

          {gainers.length === 0 && losers.length === 0 ? (
            <p className={styles.quiet}>Nothing has moved yet today.</p>
          ) : (
            <ul role="list" className={styles.movers}>
              {[...gainers, ...losers].map((quote) => (
                <li key={quote.assetId} className={styles.mover}>
                  <button
                    type="button"
                    className={styles.moverButton}
                    onClick={() => void navigate(`/research/${encodeURIComponent(quote.assetId)}`)}
                  >
                    <span className={styles.symbol}>{quote.symbol}</span>
                    <ChangeValue value={quote.changePct24h} period="24 hour change" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.card} aria-labelledby="digest-mood">
          <h3 id="digest-mood" className={styles.heading}>
            Market mood
          </h3>

          {cryptoLine || stocksLine ? (
            <ul role="list" className={styles.lines}>
              {cryptoLine ? (
                <li>
                  <span className={styles.label}>Crypto</span> {cryptoLine}
                </li>
              ) : null}
              {stocksLine ? (
                <li>
                  <span className={styles.label}>Stocks</span> {stocksLine}
                </li>
              ) : null}
            </ul>
          ) : (
            <p className={styles.quiet}>No reading available.</p>
          )}

          <button type="button" className={styles.more} onClick={() => void navigate('/compare')}>
            See the components <Icon name="external" size={12} />
          </button>
        </section>

        <section className={styles.card} aria-labelledby="digest-waiting">
          <h3 id="digest-waiting" className={styles.heading}>
            Waiting for you
          </h3>

          <ul role="list" className={styles.lines}>
            <li>
              {unreadCount === 0
                ? 'No unread headlines.'
                : `${unreadCount} unread ${unreadCount === 1 ? 'headline' : 'headlines'}.`}
            </li>
            <li>
              {firedAlerts.length === 0
                ? 'No alerts have fired.'
                : `${firedAlerts.length} ${firedAlerts.length === 1 ? 'alert has' : 'alerts have'} fired.`}
            </li>
          </ul>

          {firedAlerts.length > 0 ? (
            <button
              type="button"
              className={styles.more}
              onClick={() => void navigate('/settings/alerts')}
            >
              Review them <Icon name="external" size={12} />
            </button>
          ) : null}
        </section>
      </div>
    </Panel>
  );
}
