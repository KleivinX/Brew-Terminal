import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/status/EmptyState';
import { SkeletonRows } from '@/components/status/Skeleton';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { RelativeTime } from '@/components/status/RelativeTime';
import { ChangeValue } from '@/components/data/ChangeValue';
import { ipc } from '@/lib/ipc';
import { formatPrice } from '@/lib/format';
import { useWatchlistItems, useWatchlists } from '@/lib/market';
import { AtlasStatusLine } from './AtlasStatusLine';
import { REFRESH_MS } from './constants';
import styles from './AtlasRoute.module.css';

/**
 * Atlas — a live ticker over rotating free-tier providers.
 *
 * The honest framing, because it is the whole reason this screen is built the way it is:
 * real-time market data is licensed, and no free tier will carry a continuously refreshing
 * ticker on its own. Atlas does not pretend otherwise. It refreshes on a fixed 90-second
 * cadence, spends each provider's allowance deliberately, and shows which tier is answering and
 * how much of it is left.
 *
 * "Real-time" here means ninety seconds old at most, and the screen says so rather than
 * implying a stream. Anything faster from a free tier is either a rate limit waiting to happen
 * or a provider being used outside its terms.
 */
export function AtlasRoute() {
  const navigate = useNavigate();
  const [paused, setPaused] = useState(false);

  const { data: watchlists } = useWatchlists();
  const active = watchlists?.find((list) => list.isDefault) ?? watchlists?.[0];
  const { data: items } = useWatchlistItems(active?.id);

  const assetIds = useMemo(() => (items ?? []).map((item) => item.assetId), [items]);

  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['atlas', assetIds],
    queryFn: () => ipc('atlas_snapshot', { assetIds }),
    enabled: assetIds.length > 0,
    /*
     * Ninety seconds, and deliberately not configurable down. The provider allowances this
     * rotates through are per-minute; a user who set it to five seconds would spend a whole
     * tier's minute in one tick and see nothing but rate limits. The cadence is part of what
     * makes the feature work rather than a preference.
     */
    refetchInterval: paused ? false : REFRESH_MS,
    // A ticker the user is not looking at is a request nobody asked for.
    refetchIntervalInBackground: false,
  });

  const quotes = data?.quotes ?? [];
  const routes = data?.routes ?? [];

  if (!isLoading && assetIds.length === 0) {
    return (
      <>
        <WorkspaceHeader title="Atlas" subtitle="A live ticker for what you follow" />
        <div className={styles.layout}>
          <EmptyState
            icon="pulse"
            title="Nothing on the ticker yet"
            description="Atlas streams the watchlist you already keep. Star an asset anywhere in the app and it appears here."
            action={
              <Button variant="primary" size="sm" onClick={() => void navigate('/pulse')}>
                Go to Pulse
              </Button>
            }
          />
        </div>
      </>
    );
  }

  return (
    <>
      <WorkspaceHeader
        title="Atlas"
        subtitle="A live ticker for what you follow"
        actions={
          <div className={styles.headerActions}>
            <Button size="sm" variant="ghost" onClick={() => setPaused((value) => !value)}>
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void refetch()}>
              Refresh now
            </Button>
          </div>
        }
      />

      <div className={styles.layout}>
        <Panel
          title="Ticker"
          meta={
            dataUpdatedAt ? (
              <span className={styles.updated}>
                updated <RelativeTime epochSeconds={Math.floor(dataUpdatedAt / 1000)} />
                {paused ? ' · paused' : ` · every ${REFRESH_MS / 1000}s`}
              </span>
            ) : null
          }
          className={styles.tickerPanel}
        >
          {isLoading ? <SkeletonRows rows={6} columns={3} label="Starting the ticker" /> : null}

          {!isLoading && quotes.length > 0 ? (
            <ul role="list" className={styles.ticker}>
              {quotes.map((quote) => (
                <li key={quote.assetId} className={styles.row}>
                  <button
                    type="button"
                    className={styles.rowButton}
                    onClick={() => void navigate(`/research/${encodeURIComponent(quote.assetId)}`)}
                  >
                    <span className={styles.symbol}>{quote.symbol}</span>
                    <span className={styles.name}>{quote.name}</span>
                    <span className={styles.price}>{formatPrice(quote.price, quote.currency)}</span>
                    {/*
                      ChangeValue rather than a bare coloured number. Direction travels on four
                      channels here — colour, glyph, sign and an accessible label — because
                      red-green alone is unreadable for a large share of users and identical in
                      the Soft theme. See UI_MAP.md §6.
                    */}
                    <ChangeValue value={quote.changePct24h} period="24 hour change" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {!isLoading && quotes.length === 0 ? (
            <p className={styles.quiet}>
              No provider could answer for this watchlist. The status line below says which tiers
              are unavailable and when they free up.
            </p>
          ) : null}
        </Panel>

        <Panel title="Route" className={styles.routePanel}>
          <div className={styles.routeBody}>
            <AtlasStatusLine routes={routes} fetching={isFetching} />

            <p className={styles.explain}>
              Real-time market data is licensed, so no free tier carries a continuously refreshing
              ticker on its own. Atlas spreads the load across the tiers this app has reviewed,
              steps aside from any that says no, and shows you which one is answering.
            </p>

            <p className={styles.explain}>
              <Icon name="info" size={12} /> Figures are at most {REFRESH_MS / 1000} seconds old.
              Where an allowance did not stretch to the whole list, the rest keeps its previous
              value — the age next to each provider is the honest one.
            </p>

            <Button size="sm" variant="ghost" onClick={() => void navigate('/settings/providers')}>
              Provider settings
            </Button>
          </div>
        </Panel>

        <DisclaimerNote />
      </div>
    </>
  );
}
