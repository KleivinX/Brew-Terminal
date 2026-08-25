import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable, type Column } from '@/components/data/DataTable';
import { ChangeValue } from '@/components/data/ChangeValue';
import { PriceValue } from '@/components/data/PriceValue';
import { Sparkline } from '@/components/data/Sparkline';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/status/EmptyState';
import { formatCompact, formatPercent, formatPrice } from '@/lib/format';
import { useUiStore } from '@/stores/uiStore';
import type { Quote } from '@/types/domain';
import styles from './MarketTable.module.css';

interface MarketTableProps {
  quotes: Quote[];
  label: string;
  watchedAssetIds: Set<string>;
  onToggleWatch: (assetId: string, present: boolean) => void;
  emptyState?: React.ReactNode | undefined;
  /**
   * Enables the reorder column. Supplied only on the Watchlist tab, where row order is the
   * user's own and worth preserving; on a market list the order comes from the provider.
   */
  onMove?: ((assetId: string, direction: 'up' | 'down') => void) | undefined;
}

export function MarketTable({
  quotes,
  label,
  watchedAssetIds,
  onToggleWatch,
  emptyState,
  onMove,
}: MarketTableProps) {
  const navigate = useNavigate();
  const selectedAssetId = useUiStore((s) => s.selectedAssetId);
  const setSelectedAssetId = useUiStore((s) => s.setSelectedAssetId);

  const columns = useMemo<Column<Quote>[]>(
    () => [
      /*
       * Reordering is buttons rather than drag-and-drop: it works from the keyboard without
       * a custom drag interaction, and it is far simpler to make accessible. Each button
       * names the asset it moves, so a screen-reader user is never pressing an anonymous
       * arrow. Hidden entirely when reordering does not apply.
       */
      ...(onMove
        ? [
            {
              id: 'reorder',
              header: '',
              width: '58px',
              render: (quote: Quote) => {
                const index = quotes.findIndex((q) => q.assetId === quote.assetId);
                return (
                  <span className={styles.reorder}>
                    <IconButton
                      icon="chevron-down"
                      size={12}
                      label={`Move ${quote.symbol} up`}
                      className={styles.moveUp}
                      disabled={index <= 0}
                      onClick={(event) => {
                        event.stopPropagation();
                        onMove(quote.assetId, 'up');
                      }}
                    />
                    <IconButton
                      icon="chevron-down"
                      size={12}
                      label={`Move ${quote.symbol} down`}
                      disabled={index === quotes.length - 1}
                      onClick={(event) => {
                        event.stopPropagation();
                        onMove(quote.assetId, 'down');
                      }}
                    />
                  </span>
                );
              },
            } satisfies Column<Quote>,
          ]
        : []),
      {
        id: 'watch',
        header: '',
        width: '32px',
        render: (quote) => {
          const watched = watchedAssetIds.has(quote.assetId);
          return (
            <IconButton
              icon={watched ? 'star-filled' : 'star'}
              size={14}
              label={
                watched
                  ? `Remove ${quote.symbol} from watchlist`
                  : `Add ${quote.symbol} to watchlist`
              }
              className={watched ? styles.watched : styles.unwatched}
              onClick={(event) => {
                event.stopPropagation();
                onToggleWatch(quote.assetId, watched);
              }}
            />
          );
        },
      },
      {
        id: 'asset',
        header: 'Asset',
        width: 'minmax(140px, 2fr)',
        sortable: true,
        sortValue: (quote) => quote.symbol,
        render: (quote) => (
          <span className={styles.asset}>
            <span className={styles.symbol}>{quote.symbol}</span>
            <span className={styles.name}>{quote.name}</span>
          </span>
        ),
      },
      {
        id: 'price',
        header: 'Price',
        width: 'minmax(88px, 1fr)',
        align: 'right',
        sortable: true,
        sortValue: (quote) => quote.price,
        render: (quote) => <PriceValue value={quote.price} currency={quote.currency} />,
        cellLabel: (quote) => `Price ${formatPrice(quote.price, quote.currency)}`,
      },
      {
        id: 'change24h',
        header: '24h',
        width: '84px',
        align: 'right',
        sortable: true,
        sortValue: (quote) => quote.changePct24h ?? Number.NEGATIVE_INFINITY,
        render: (quote) => <ChangeValue value={quote.changePct24h} period="24 hour change" />,
      },
      {
        id: 'change7d',
        header: '7d',
        width: '84px',
        align: 'right',
        sortable: true,
        sortValue: (quote) => quote.changePct7d ?? Number.NEGATIVE_INFINITY,
        render: (quote) => <ChangeValue value={quote.changePct7d} period="7 day change" />,
      },
      {
        id: 'marketCap',
        header: 'Market cap',
        width: '104px',
        align: 'right',
        sortable: true,
        sortValue: (quote) => quote.marketCap ?? -1,
        render: (quote) => <span className="tabular">{formatCompact(quote.marketCap)}</span>,
        cellLabel: (quote) => `Market cap ${formatCompact(quote.marketCap)}`,
      },
      {
        id: 'volume',
        header: 'Volume 24h',
        width: '104px',
        align: 'right',
        sortable: true,
        sortValue: (quote) => quote.volume24h ?? -1,
        render: (quote) => <span className="tabular">{formatCompact(quote.volume24h)}</span>,
        cellLabel: (quote) => `24 hour volume ${formatCompact(quote.volume24h)}`,
      },
      {
        id: 'spark',
        header: '7d trend',
        width: '88px',
        align: 'right',
        render: (quote) => (
          <Sparkline
            points={quote.sparkline}
            changePct={quote.changePct7d}
            label={`${quote.symbol} 7 day trend, ${formatPercent(quote.changePct7d)}`}
          />
        ),
      },
    ],
    [watchedAssetIds, onToggleWatch, onMove, quotes],
  );

  return (
    <DataTable
      rows={quotes}
      columns={columns}
      rowKey={(quote) => quote.assetId}
      label={label}
      selectedKey={selectedAssetId}
      onSelectedKeyChange={setSelectedAssetId}
      onActivate={(quote) => void navigate(`/research/${encodeURIComponent(quote.assetId)}`)}
      emptyState={
        emptyState ?? (
          <EmptyState
            title="Nothing to show"
            description="No assets matched this view. Try another tab, or search from the command palette."
          />
        )
      }
    />
  );
}
