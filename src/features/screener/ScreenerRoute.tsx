import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ProviderBadge } from '@/components/status/ProviderBadge';
import { EmptyState } from '@/components/status/EmptyState';
import { SkeletonRows } from '@/components/status/Skeleton';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { ipc } from '@/lib/ipc';
import { formatPrice, formatPercent, formatCompact } from '@/lib/format';
import type { AssetType, ScreenerFilter, ScreenerSort } from '@/types/domain';
import styles from './ScreenerRoute.module.css';

/**
 * Filter the market on your own criteria.
 *
 * There are no preset screens called "undervalued" or "momentum", and no score. A preset would
 * be the app asserting which numbers matter; the filters are the reader saying so. What the app
 * contributes is honest arithmetic and a clear statement of what was excluded and why.
 */

const SORTS: { id: ScreenerSort; label: string }[] = [
  { id: 'market-cap', label: 'Market cap' },
  { id: 'price', label: 'Price' },
  { id: 'change24h', label: '24h change' },
  { id: 'change7d', label: '7d change' },
  { id: 'volume', label: 'Volume' },
  { id: 'symbol', label: 'Symbol' },
];

function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function ScreenerRoute() {
  const [assetType, setAssetType] = useState<AssetType | null>(null);
  const [query, setQuery] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [minCap, setMinCap] = useState('');
  const [minChange, setMinChange] = useState('');
  const [maxChange, setMaxChange] = useState('');
  const [sort, setSort] = useState<ScreenerSort>('market-cap');
  const [descending, setDescending] = useState(true);

  const filter: ScreenerFilter = {
    assetType,
    price: { min: numberOrNull(minPrice), max: numberOrNull(maxPrice) },
    marketCap: { min: numberOrNull(minCap), max: null },
    change24h: { min: numberOrNull(minChange), max: numberOrNull(maxChange) },
    change7d: { min: null, max: null },
    volume24h: { min: null, max: null },
    query: query.trim() === '' ? null : query.trim(),
    sort,
    descending,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['screen', filter],
    queryFn: () => ipc('run_screen', { filter }),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const asked =
    assetType !== null ||
    query.trim() !== '' ||
    [minPrice, maxPrice, minCap, minChange, maxChange].some((v) => v.trim() !== '');

  const reset = (): void => {
    setAssetType(null);
    setQuery('');
    setMinPrice('');
    setMaxPrice('');
    setMinCap('');
    setMinChange('');
    setMaxChange('');
  };

  return (
    <>
      <WorkspaceHeader title="Screener" subtitle="Filter the market on your own criteria" />

      <div className={styles.layout}>
        <Panel
          title="Filters"
          meta="Applied to data already fetched, so changing one costs no request."
          className={styles.filters}
        >
          <div className={styles.form}>
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Asset type</legend>
              <div className={styles.radios}>
                {([null, 'crypto', 'stock'] as const).map((option) => (
                  <label key={String(option)} className={styles.radio}>
                    <input
                      type="radio"
                      name="asset-type"
                      checked={assetType === option}
                      onChange={() => setAssetType(option as AssetType | null)}
                    />
                    {option === null ? 'Any' : option === 'crypto' ? 'Crypto' : 'Stocks'}
                  </label>
                ))}
              </div>
            </fieldset>

            <Field label="Name or symbol" id="scr-query">
              <Input
                id="scr-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="btc"
                spellCheck={false}
              />
            </Field>

            <div className={styles.pair}>
              <Field label="Min price" id="scr-min-price">
                <Input
                  id="scr-min-price"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Max price" id="scr-max-price">
                <Input
                  id="scr-max-price"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
            </div>

            <Field label="Min market cap" id="scr-min-cap">
              <Input
                id="scr-min-cap"
                value={minCap}
                onChange={(e) => setMinCap(e.target.value)}
                inputMode="decimal"
                placeholder="1000000000"
              />
            </Field>

            <div className={styles.pair}>
              <Field label="Min 24h %" id="scr-min-change">
                <Input
                  id="scr-min-change"
                  value={minChange}
                  onChange={(e) => setMinChange(e.target.value)}
                  inputMode="decimal"
                />
              </Field>
              <Field label="Max 24h %" id="scr-max-change">
                <Input
                  id="scr-max-change"
                  value={maxChange}
                  onChange={(e) => setMaxChange(e.target.value)}
                  inputMode="decimal"
                  placeholder="-5"
                />
              </Field>
            </div>

            <Field label="Sort by" id="scr-sort">
              <select
                id="scr-sort"
                className={styles.select}
                value={sort}
                onChange={(e) => setSort(e.target.value as ScreenerSort)}
              >
                {SORTS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <label className={styles.radio}>
              <input
                type="checkbox"
                checked={descending}
                onChange={(e) => setDescending(e.target.checked)}
              />
              Highest first
            </label>

            <p className={styles.note}>
              An asset the provider gives no value for is excluded from a filter on that figure, and
              sorts last. Unknown is not zero.
            </p>

            {asked ? (
              <Button variant="ghost" onClick={reset}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </Panel>

        <Panel
          title={`Results${rows.length > 0 ? ` (${rows.length})` : ''}`}
          meta={data ? <ProviderBadge meta={data.meta} /> : null}
          scroll
        >
          {isLoading ? <SkeletonRows rows={8} columns={5} label="Screening" /> : null}

          {!isLoading && rows.length === 0 ? (
            <EmptyState
              icon="search"
              title={asked ? 'Nothing matches those filters' : 'No market data available'}
              description={
                asked
                  ? 'Every criterion has to hold at once. Widening one of them will bring rows back.'
                  : 'Enable a market data provider in Settings to screen the market.'
              }
            />
          ) : null}

          {rows.length > 0 ? (
            <table className={styles.table}>
              <caption className="visually-hidden">Screen results</caption>
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col">Price</th>
                  <th scope="col">24h</th>
                  <th scope="col">7d</th>
                  <th scope="col">Market cap</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((quote) => (
                  <tr key={quote.assetId}>
                    <th scope="row" className={styles.symbolCell}>
                      <span className={styles.symbol}>{quote.symbol}</span>
                      <span className={styles.name}>{quote.name}</span>
                    </th>
                    <td className="tabular">{formatPrice(quote.price, quote.currency)}</td>
                    <td className={['tabular', tone(quote.changePct24h)].filter(Boolean).join(' ')}>
                      {formatPercent(quote.changePct24h)}
                    </td>
                    <td className={['tabular', tone(quote.changePct7d)].filter(Boolean).join(' ')}>
                      {formatPercent(quote.changePct7d)}
                    </td>
                    <td className="tabular">{formatCompact(quote.marketCap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Panel>
      </div>

      <div className={styles.footer}>
        <DisclaimerNote />
      </div>
    </>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function tone(value: number | null): string | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? styles.positive : styles.negative;
}
