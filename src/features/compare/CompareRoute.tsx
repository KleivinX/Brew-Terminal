import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/status/EmptyState';
import { SkeletonRows } from '@/components/status/Skeleton';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { ipc } from '@/lib/ipc';
import { MAX_COMPARE } from './constants';
import { ComparisonChart } from './ComparisonChart';
import { CorrelationMatrix } from './CorrelationMatrix';
import { MacroPanel } from './MacroPanel';
import type { ChartRange } from '@/types/domain';
import styles from './CompareRoute.module.css';

const RANGES: readonly TabItem<ChartRange>[] = [
  { id: '1M', label: '1M' },
  { id: '3M', label: '3M' },
  { id: '1Y', label: '1Y' },
  { id: 'MAX', label: 'MAX' },
];

/**
 * Assets side by side, and the macro backdrop they move against.
 *
 * Three views of the same question — how do these things relate — and none of them draws a
 * conclusion. The correlation cell says 0.87; whether that is too much is the reader's call.
 */
export function CompareRoute() {
  const [assetIds, setAssetIds] = useState<string[]>(['crypto:cg:bitcoin', 'crypto:cg:ethereum']);
  const [draft, setDraft] = useState('');
  const [range, setRange] = useState<ChartRange>('3M');

  const { data, isLoading } = useQuery({
    queryKey: ['multi-series', assetIds, range],
    queryFn: () => ipc('get_multi_series', { assetIds, range }),
    enabled: assetIds.length > 0,
    staleTime: 60_000,
  });

  const add = (): void => {
    const id = draft.trim();
    if (id === '' || assetIds.includes(id) || assetIds.length >= MAX_COMPARE) return;
    setAssetIds((current) => [...current, id]);
    setDraft('');
  };

  const series = data?.series ?? [];

  return (
    <>
      <WorkspaceHeader
        title="Compare"
        subtitle="Several assets on one axis, and what they move against"
        actions={<Tabs items={RANGES} value={range} onChange={setRange} label="Range" />}
      />

      <div className={styles.layout}>
        <Panel title="Assets" meta={`Up to ${MAX_COMPARE} — one per validated colour.`}>
          <div className={styles.picker}>
            <ul role="list" className={styles.chips}>
              {assetIds.map((id, i) => (
                <li key={id} className={styles.chip}>
                  <span
                    className={styles.swatch}
                    style={{ background: `var(--chart-${(i % MAX_COMPARE) + 1})` }}
                    aria-hidden="true"
                  />
                  <span className={styles.chipLabel}>{id.split(':').pop()}</span>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Remove ${id}`}
                    onClick={() => setAssetIds((c) => c.filter((x) => x !== id))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>

            {assetIds.length < MAX_COMPARE ? (
              <div className={styles.addRow}>
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      add();
                    }
                  }}
                  placeholder="crypto:cg:solana"
                  spellCheck={false}
                  aria-label="Asset id to add"
                />
                <Button variant="secondary" onClick={add} disabled={draft.trim() === ''}>
                  Add
                </Button>
              </div>
            ) : (
              <p className={styles.note}>
                That is the sixth. The palette has six colours that were checked for
                distinguishability, and a seventh would need one that was not.
              </p>
            )}

            {data && data.unavailable.length > 0 ? (
              <p className={styles.note} role="status">
                No history available for {data.unavailable.join(', ')} — named rather than quietly
                dropped.
              </p>
            ) : null}
          </div>
        </Panel>

        {isLoading ? <SkeletonRows rows={6} columns={3} label="Loading series" /> : null}

        {!isLoading && series.length === 0 ? (
          <EmptyState
            icon="research"
            title="Nothing to compare yet"
            description="Add at least one asset id. You can copy one from any asset page in Research."
          />
        ) : null}

        {series.length > 0 ? (
          <>
            <Panel title="Indexed to 100" meta="Same axis, because each line starts from itself.">
              <ComparisonChart series={series} />
            </Panel>

            <Panel
              title="Correlation"
              meta="Daily returns, not prices — a shared trend is not agreement."
            >
              <CorrelationMatrix series={series} />
            </Panel>
          </>
        ) : null}

        <MacroPanel range={range} />

        <DisclaimerNote />
      </div>
    </>
  );
}
