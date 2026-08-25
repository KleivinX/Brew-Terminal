import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Panel';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { SearchField } from '@/components/ui/SearchField';
import { ProviderBadge } from '@/components/status/ProviderBadge';
import { StatusPill } from '@/components/status/StatusPill';
import { StaleBanner } from '@/components/status/StaleBanner';
import { EmptyState } from '@/components/status/EmptyState';
import { ErrorState } from '@/components/status/ErrorState';
import { SkeletonRows } from '@/components/status/Skeleton';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { derivePanelStatus } from '@/lib/freshness';
import { usePreferences } from '@/lib/preferences';
import { usePaletteStore } from '@/stores/paletteStore';
import { isDev } from '@/lib/env';
import { MarketTable } from './MarketTable';
import { NewsPanel } from './NewsPanel';
import { MockControlPanel } from '@/components/dev/MockControlPanel';
import {
  useMarketList,
  useQuotes,
  useReorderWatchlistItems,
  useToggleWatchlistItem,
  useWatchlistItems,
  useWatchlists,
} from '@/lib/market';
import { useUiStore } from '@/stores/uiStore';
import { WatchlistToolbar } from './WatchlistToolbar';
import styles from './PulseRoute.module.css';

type PulseTab = 'crypto' | 'stocks' | 'watchlist';

const TABS: readonly TabItem<PulseTab>[] = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'watchlist', label: 'Watchlist' },
];

function isPulseTab(value: string | null): value is PulseTab {
  return value === 'crypto' || value === 'stocks' || value === 'watchlist';
}

export function PulseRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const openPalette = usePaletteStore((s) => s.openPalette);
  const { data: preferences } = usePreferences();
  const region = preferences?.region ?? 'global';

  const tabParam = searchParams.get('tab');
  const tab: PulseTab = isPulseTab(tabParam) ? tabParam : 'crypto';
  const setTab = (next: PulseTab): void => setSearchParams({ tab: next }, { replace: true });

  const { data: watchlists } = useWatchlists();
  const selectedWatchlistId = useUiStore((s) => s.selectedWatchlistId);
  const setSelectedWatchlistId = useUiStore((s) => s.setSelectedWatchlistId);

  // Falls back to the default list until the user picks one, and again if the selected list
  // is deleted from under us.
  const activeWatchlist =
    watchlists?.find((w) => w.id === selectedWatchlistId) ??
    watchlists?.find((w) => w.isDefault) ??
    watchlists?.[0];

  const { data: watchlistItems } = useWatchlistItems(activeWatchlist?.id);

  const watchedAssetIds = useMemo(
    () => new Set((watchlistItems ?? []).map((item) => item.assetId)),
    [watchlistItems],
  );
  /** In watchlist order — `watchlistItems` comes back sorted by position. */
  const watchedIdList = useMemo(
    () => (watchlistItems ?? []).map((item) => item.assetId),
    [watchlistItems],
  );

  const toggleWatch = useToggleWatchlistItem(activeWatchlist?.id);
  const reorderItems = useReorderWatchlistItems(activeWatchlist?.id);

  const marketQuery = useMarketList(tab === 'stocks' ? 'stock' : 'crypto', region);
  const watchlistQuery = useQuotes(tab === 'watchlist' ? watchedIdList : []);
  const active = tab === 'watchlist' ? watchlistQuery : marketQuery;

  /*
   * Providers return quotes in their own order, not the order they were asked for. On the
   * Watchlist tab that would silently discard the ordering the user set, so the rows are
   * re-sorted back into watchlist position here.
   *
   * `active.data?.data` is read inside the callback rather than defaulted outside it: a
   * `?? []` fallback allocates a new array on every render and would defeat the memo.
   */
  const quotes = useMemo(() => {
    const rows = active.data?.data ?? [];
    if (tab !== 'watchlist') return rows;

    const position = new Map(watchedIdList.map((id, index) => [id, index]));
    return [...rows].sort(
      (a, b) =>
        (position.get(a.assetId) ?? Number.MAX_SAFE_INTEGER) -
        (position.get(b.assetId) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [tab, active.data, watchedIdList]);

  const moveItem = (assetId: string, direction: 'up' | 'down'): void => {
    const current = [...watchedIdList];
    const from = current.indexOf(assetId);
    const to = direction === 'up' ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= current.length) return;

    const [moved] = current.splice(from, 1);
    if (moved) current.splice(to, 0, moved);
    reorderItems.mutate(current);
  };
  const status = derivePanelStatus(active.data, {
    isLoading: active.isLoading,
    isEmpty: quotes.length === 0,
    error: active.error,
  });

  const [filter, setFilter] = useState('');

  /*
   * Filters the rows already on screen. Distinct from the command palette, which searches
   * every asset the provider knows about — this one narrows what is in front of you and
   * never issues a request.
   */
  const visibleQuotes = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return quotes;
    return quotes.filter(
      (quote) =>
        quote.symbol.toLowerCase().includes(needle) || quote.name.toLowerCase().includes(needle),
    );
  }, [quotes, filter]);

  const filteredEverythingOut = quotes.length > 0 && visibleQuotes.length === 0;

  const [showDevPanel, setShowDevPanel] = useState(false);

  return (
    <>
      <WorkspaceHeader
        title="Pulse"
        subtitle="What is happening across the markets you follow"
        actions={
          isDev() ? (
            <Button size="sm" variant="ghost" onClick={() => setShowDevPanel((v) => !v)}>
              Mock states
            </Button>
          ) : null
        }
      />

      {isDev() && showDevPanel ? <MockControlPanel /> : null}

      <div className={styles.layout}>
        <Panel
          title="Markets"
          fill
          className={styles.markets}
          meta={
            <>
              {active.data ? <ProviderBadge meta={active.data.meta} /> : null}
              <DisclaimerNote />
            </>
          }
          actions={
            <>
              <Tabs
                items={TABS}
                value={tab}
                onChange={setTab}
                label="Market view"
                panelId={(id) => `tabpanel-${id}`}
              />
              <StatusPill state={status.state} label={status.label} detail={status.detail} />
            </>
          }
        >
          <div className={styles.tableToolbar}>
            <SearchField
              label="Filter the assets shown"
              placeholder="Filter these rows…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className={styles.filter}
            />
            {tab === 'watchlist' ? (
              <WatchlistToolbar
                selectedId={activeWatchlist?.id}
                onSelect={setSelectedWatchlistId}
                itemCount={watchedIdList.length}
              />
            ) : null}
          </div>
          <div
            role="tabpanel"
            id={`tabpanel-${tab}`}
            aria-labelledby={`tab-${tab}`}
            className={styles.tabPanel}
          >
            {status.showingFallbackData && active.data ? (
              <StaleBanner meta={active.data.meta} />
            ) : null}

            {status.state === 'loading' ? (
              <SkeletonRows rows={10} columns={6} label="Loading market data" />
            ) : null}

            {status.state === 'not-configured' ? (
              <EmptyState
                icon="settings"
                title="No provider set up yet"
                description={status.detail}
                action={
                  <Button variant="primary" size="sm" onClick={() => openPalette('providers')}>
                    Open provider settings
                  </Button>
                }
              />
            ) : null}

            {status.state === 'error' && !status.showingFallbackData ? (
              <ErrorState
                title="Market data could not be loaded"
                detail={status.detail}
                onRetry={() => void active.refetch()}
              />
            ) : null}

            {filteredEverythingOut ? (
              <EmptyState
                icon="search"
                title="Nothing matches that filter"
                description={`No asset on this tab matches "${filter.trim()}". Clear the filter, or search every asset from the command palette.`}
                action={
                  <Button variant="ghost" size="sm" onClick={() => setFilter('')}>
                    Clear filter
                  </Button>
                }
              />
            ) : null}

            {visibleQuotes.length > 0 ? (
              <MarketTable
                quotes={visibleQuotes}
                label={`${tab} market table`}
                watchedAssetIds={watchedAssetIds}
                onToggleWatch={(assetId, present) => toggleWatch.mutate({ assetId, present })}
                {...(tab === 'watchlist' ? { onMove: moveItem } : {})}
              />
            ) : null}

            {status.state === 'empty' && tab === 'watchlist' ? (
              <EmptyState
                icon="star"
                title="Your watchlist is empty"
                description="Add your first asset to start a watchlist. Use the star on any row, or search from the command palette."
                action={
                  <Button variant="primary" size="sm" onClick={() => openPalette()}>
                    Search for an asset
                  </Button>
                }
              />
            ) : null}

            {status.state === 'empty' && tab !== 'watchlist' ? (
              <EmptyState
                icon="info"
                title="No market data yet"
                description="Nothing came back for this view. Try refreshing, or check the provider in Settings."
              />
            ) : null}
          </div>
        </Panel>

        <NewsPanel />
      </div>
    </>
  );
}
