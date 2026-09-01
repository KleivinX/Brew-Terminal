import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/status/EmptyState';
import { ErrorState } from '@/components/status/ErrorState';
import { SkeletonRows } from '@/components/status/Skeleton';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { ipc } from '@/lib/ipc';
import { formatPrice, formatPercent } from '@/lib/format';
import type { Position } from '@/types/domain';
import { TransactionDialog } from './TransactionDialog';
import { PositionsTable } from './PositionsTable';
import { Allocation } from './Allocation';
import styles from './PortfolioRoute.module.css';

/**
 * What you hold, and what it has done.
 *
 * The app records and computes; it does not judge. There is no "you are overexposed", no
 * suggested rebalance, no score. Allocation is shown because it is a fact about the portfolio,
 * and what to make of it is the reader's business.
 */
export function PortfolioRoute() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['portfolio'],
    queryFn: () => ipc('get_portfolio'),
    staleTime: 30_000,
  });

  const { data: transactions } = useQuery({
    queryKey: ['transactions'],
    queryFn: () => ipc('list_transactions', { assetId: null }),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
  };

  const remove = useMutation({
    mutationFn: (id: string) => ipc('delete_transaction', { id }),
    onSuccess: refresh,
  });

  const open = useMemo(
    () => (data?.positions ?? []).filter((p: Position) => p.quantity > 0),
    [data],
  );
  const closed = useMemo(
    () => (data?.positions ?? []).filter((p: Position) => p.quantity <= 0),
    [data],
  );

  const currency = data?.currency ?? 'USD';
  const editingTransaction = transactions?.find((t) => t.id === editing) ?? null;

  return (
    <>
      <WorkspaceHeader
        title="Portfolio"
        subtitle="What you hold, and what it has done"
        actions={
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            Record a trade
          </Button>
        }
      />

      <div className={styles.layout}>
        {isLoading ? <SkeletonRows rows={6} columns={5} label="Loading your portfolio" /> : null}

        {error ? (
          <ErrorState
            title="Your portfolio could not be loaded"
            detail="The transaction history could not be read."
            onRetry={() => void refetch()}
          />
        ) : null}

        {data && data.positions.length === 0 ? (
          <EmptyState
            icon="portfolio"
            title="Nothing recorded yet"
            description="Add the trades you have made and this becomes a live view of your cost basis, realised gain and current value. Everything stays on this machine."
            action={
              <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                Record your first trade
              </Button>
            }
          />
        ) : null}

        {data && data.positions.length > 0 ? (
          <>
            <section className={styles.totals} aria-label="Portfolio totals">
              <Figure label="Value" value={formatPrice(data.marketValue, currency)} />
              <Figure label="Cost" value={formatPrice(data.costBasis, currency)} />
              <Figure
                label="Unrealised"
                value={formatPrice(data.unrealisedPnl, currency)}
                sub={data.unrealisedPct === null ? undefined : formatPercent(data.unrealisedPct)}
                tone={data.unrealisedPnl}
              />
              <Figure
                label="Realised"
                value={formatPrice(data.realisedPnl, currency)}
                tone={data.realisedPnl}
              />
              <Figure label="Fees paid" value={formatPrice(data.feesPaid, currency)} />
            </section>

            {data.unpriced.length > 0 ? (
              <p className={styles.caveat} role="status">
                No current price for {data.unpriced.join(', ')}, so the value above covers
                everything else. It is not counted as zero.
              </p>
            ) : null}

            {data.excludedCurrencies.length > 0 ? (
              <p className={styles.caveat} role="status">
                Holdings priced in {data.excludedCurrencies.join(', ')} are listed but not added to
                the totals — the app does not convert currencies, so summing them would mean
                inventing an exchange rate.
              </p>
            ) : null}

            {data.positions.some((p) => p.oversold) ? (
              <p className={styles.warning} role="alert">
                Some positions record more sold than bought. The figures for those cannot be right
                until the missing purchases are added.
              </p>
            ) : null}

            <div className={styles.split}>
              <Panel
                title="Open positions"
                meta={`Cost basis: ${data.method === 'fifo' ? 'FIFO' : 'average cost'}`}
                className={styles.wide}
              >
                <PositionsTable positions={open} currency={currency} />
              </Panel>

              <Panel title="Allocation" meta="By current value">
                <Allocation positions={open} currency={currency} />
              </Panel>
            </div>

            {closed.length > 0 ? (
              <Panel title="Closed positions" meta="Sold in full. Realised gain is kept.">
                <PositionsTable positions={closed} currency={currency} closed />
              </Panel>
            ) : null}

            <Panel title="Transactions" meta="Everything the figures above are computed from">
              <ul role="list" className={styles.transactions}>
                {(transactions ?? []).map((t) => (
                  <li key={t.id} className={styles.transaction}>
                    <span className={styles.txKind} data-kind={t.kind}>
                      {t.kind === 'buy' ? 'Buy' : 'Sell'}
                    </span>
                    <span className={styles.txSymbol}>{t.symbol}</span>
                    <span className="tabular">{t.quantity}</span>
                    <span className="tabular">@ {formatPrice(t.unitPrice, t.currency)}</span>
                    <span className={styles.txDate}>
                      {new Date(t.executedAt * 1000).toLocaleDateString()}
                    </span>
                    <span className={styles.txActions}>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(t.id)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove.mutate(t.id)}
                        aria-label={`Delete ${t.kind} of ${t.symbol}`}
                      >
                        Delete
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </>
        ) : null}

        <DisclaimerNote />
      </div>

      {adding ? (
        <TransactionDialog
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      ) : null}

      {editingTransaction ? (
        <TransactionDialog
          transaction={editingTransaction}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
    </>
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
      <span className={styles.figureLabel}>{label}</span>
      <span className={[styles.figureValue, toneClass, 'tabular'].filter(Boolean).join(' ')}>
        {value}
      </span>
      {sub ? (
        <span className={[styles.figureSub, toneClass].filter(Boolean).join(' ')}>{sub}</span>
      ) : null}
    </div>
  );
}
