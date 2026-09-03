import { lazy, Suspense, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Panel';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ChangeValue } from '@/components/data/ChangeValue';
import { PriceValue } from '@/components/data/PriceValue';
import { ProviderBadge } from '@/components/status/ProviderBadge';
import { ExplainWithModel } from '@/components/ai/ExplainWithModel';
import { StatusPill } from '@/components/status/StatusPill';
import { StaleBanner } from '@/components/status/StaleBanner';
import { EmptyState } from '@/components/status/EmptyState';
import { ErrorState } from '@/components/status/ErrorState';
import { SkeletonRows } from '@/components/status/Skeleton';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { formatCompact } from '@/lib/format';
import { derivePanelStatus } from '@/lib/freshness';
import { ipc } from '@/lib/ipc';
import { useChart, useQuotes, useSupportedRanges } from '@/lib/market';
import { describeQuote } from '@/lib/aiContext';
import { usePaletteStore } from '@/stores/paletteStore';
import { RangeSelector } from './RangeSelector';
import { NotesPanel } from './NotesPanel';
import { ContextPanel } from './ContextPanel';
import { RiskChecklist } from './RiskChecklist';
import { CommunityPanel } from './CommunityPanel';
import type { ChartRange } from '@/types/domain';
import styles from './ResearchRoute.module.css';

/**
 * The chart library is the single heaviest dependency in the app (~48 KB gzipped) and only
 * this route uses it, so it loads on demand rather than in the Research Lab chunk. See ADR-006.
 */
const AssetChart = lazy(() => import('./AssetChart').then((m) => ({ default: m.AssetChart })));
const BacktestPanel = lazy(() =>
  import('./BacktestPanel').then((m) => ({ default: m.BacktestPanel })),
);

export function ResearchRoute() {
  const { assetId } = useParams<{ assetId?: string }>();
  const openPalette = usePaletteStore((s) => s.openPalette);
  const decodedId = assetId ? decodeURIComponent(assetId) : undefined;

  const { data: asset, isLoading: assetLoading } = useQuery({
    queryKey: ['asset', decodedId],
    queryFn: () => ipc('get_asset', { assetId: decodedId as string }),
    enabled: Boolean(decodedId),
  });

  const quoteQuery = useQuotes(decodedId ? [decodedId] : []);
  const quote = quoteQuery.data?.data?.[0];

  const supportedRanges = useSupportedRanges(asset?.assetType ?? null);
  const [preferredRange, setPreferredRange] = useState<ChartRange>('1M');

  /*
   * Clamped at render rather than corrected by an effect.
   *
   * Moving between assets can change which ranges exist — one provider offers Max, another
   * caps at a year — and storing a range that the current provider cannot serve would mean a
   * request that always fails. Deriving it keeps the selection valid without a state update
   * cascading off the provider list arriving.
   */
  const range: ChartRange =
    supportedRanges.length === 0 || supportedRanges.includes(preferredRange)
      ? preferredRange
      : ((supportedRanges.includes('1M') ? '1M' : supportedRanges[0]) as ChartRange);

  const chartQuery = useChart(decodedId, range);
  const chartStatus = derivePanelStatus(chartQuery.data, {
    isLoading: chartQuery.isLoading,
    isEmpty: (chartQuery.data?.data ?? []).length === 0,
    error: chartQuery.error,
  });

  if (!decodedId) {
    return (
      <>
        <WorkspaceHeader title="Research Lab" subtitle="Deep dive on a single asset" />
        <EmptyState
          icon="research"
          title="Pick an asset to research"
          description="Search for a coin or company, or open one from a Pulse table. Research Lab shows price history, key metrics and your own notes for that asset."
          action={
            <Button variant="primary" size="sm" onClick={() => openPalette()}>
              Search for an asset
            </Button>
          }
        />
      </>
    );
  }

  if (assetLoading || quoteQuery.isLoading) {
    return (
      <>
        <WorkspaceHeader title="Research Lab" />
        <div className={styles.body}>
          <SkeletonRows rows={4} columns={4} label="Loading asset" />
        </div>
      </>
    );
  }

  if (!asset) {
    return (
      <>
        <WorkspaceHeader title="Research Lab" />
        <EmptyState
          icon="warning"
          title="That asset is not in the current data set"
          description={`Nothing matched "${decodedId}". It may not be covered by the providers you have switched on.`}
          action={
            <Button variant="secondary" size="sm" onClick={() => openPalette()}>
              Search for another asset
            </Button>
          }
        />
      </>
    );
  }

  const isCrypto = asset.assetType === 'crypto';

  return (
    <>
      <WorkspaceHeader
        title={`${asset.symbol} · ${asset.name}`}
        subtitle={asset.exchange ? `${asset.assetType} · ${asset.exchange}` : asset.assetType}
        actions={
          /*
            Only offered once there is a quote to describe. Attaching an asset with no figures
            would hand a model a name and invite it to fill in the rest from memory, which is
            the one thing this app has no interest in doing.
          */
          quote && quoteQuery.data ? (
            <ExplainWithModel
              kind="asset-snapshot"
              label={`${quote.symbol} snapshot`}
              text={describeQuote(quote, quoteQuery.data.meta)}
              buttonLabel="Ask about this"
              excludes="no watchlist, no portfolio, no notes, no price history"
            />
          ) : null
        }
      />

      <div className={styles.body}>
        <Panel
          title="Overview"
          meta={
            <>
              {quoteQuery.data ? <ProviderBadge meta={quoteQuery.data.meta} /> : null}
              <DisclaimerNote />
            </>
          }
        >
          {quote ? (
            <div className={styles.metrics}>
              <Card
                label="Price"
                value={<PriceValue value={quote.price} currency={quote.currency} />}
                hint={quote.currency}
              />
              <Card
                label="24h change"
                value={<ChangeValue value={quote.changePct24h} period="24 hour change" />}
              />
              <Card
                label="7d change"
                value={<ChangeValue value={quote.changePct7d} period="7 day change" />}
              />
              <Card label="Market cap" value={formatCompact(quote.marketCap)} />
              <Card label="Volume 24h" value={formatCompact(quote.volume24h)} />
            </div>
          ) : (
            <EmptyState
              title="No quote available"
              description="The provider for this asset returned no pricing."
            />
          )}
        </Panel>

        <Panel
          title="Price history"
          meta={chartQuery.data ? <ProviderBadge meta={chartQuery.data.meta} /> : null}
          actions={
            <>
              <RangeSelector ranges={supportedRanges} value={range} onChange={setPreferredRange} />
              <StatusPill
                state={chartStatus.state}
                label={chartStatus.label}
                detail={chartStatus.detail}
              />
            </>
          }
        >
          {chartStatus.showingFallbackData && chartQuery.data ? (
            <StaleBanner meta={chartQuery.data.meta} />
          ) : null}

          <div className={styles.chart}>
            {supportedRanges.length === 0 ? (
              <EmptyState
                icon="settings"
                title="No provider offers price history for this asset"
                description="The providers you have switched on cover prices but not historical series for this asset type."
              />
            ) : chartStatus.state === 'loading' ? (
              <SkeletonRows rows={5} columns={2} label="Loading price history" />
            ) : chartStatus.state === 'error' && !chartStatus.showingFallbackData ? (
              <ErrorState
                title="Price history could not be loaded"
                detail={chartStatus.detail}
                onRetry={() => void chartQuery.refetch()}
              />
            ) : (
              <Suspense fallback={<SkeletonRows rows={5} columns={2} label="Loading chart" />}>
                <AssetChart
                  points={chartQuery.data?.data ?? []}
                  currency={quote?.currency ?? 'USD'}
                  label={`${asset.symbol} over ${range}`}
                />
              </Suspense>
            )}
          </div>
        </Panel>

        {/* Only offered where there is history to work through. */}
        {(chartQuery.data?.data.length ?? 0) > 1 ? (
          <Suspense fallback={<SkeletonRows rows={3} columns={3} label="Loading" />}>
            <BacktestPanel
              points={chartQuery.data?.data ?? []}
              currency={quote?.currency ?? 'USD'}
              symbol={asset.symbol}
            />
          </Suspense>
        ) : null}

        <ContextPanel assetType={asset.assetType} symbol={asset.symbol} />

        <NotesPanel assetId={asset.id} symbol={asset.symbol} />

        <CommunityPanel />

        {isCrypto ? <RiskChecklist /> : null}
      </div>
    </>
  );
}
