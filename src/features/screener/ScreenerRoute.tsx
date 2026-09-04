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
import { ExportCsv } from '@/components/data/ExportCsv';
import type { CsvColumn } from '@/lib/csv';
import { SavedViews } from '@/components/views/SavedViews';
import { ipc } from '@/lib/ipc';
import { formatPrice, formatPercent, formatCompact } from '@/lib/format';
import type { AssetType, Quote, ScreenerFilter, ScreenerSort } from '@/types/domain';
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

/**
 * Raw figures rather than the formatted cells, for the same reason as the portfolio export:
 * a CSV is opened by something that will do arithmetic on it.
 *
 * The sparkline is not here. It is 168 points per row, it is a picture rather than a
 * measurement, and a column holding it would be unreadable in every tool that opens this.
 */
const SCREENER_COLUMNS: CsvColumn<Quote>[] = [
  { header: 'Symbol', value: (q) => q.symbol },
  { header: 'Name', value: (q) => q.name },
  { header: 'Type', value: (q) => q.assetType },
  { header: 'Currency', value: (q) => q.currency },
  { header: 'Price', value: (q) => q.price },
  { header: '24h %', value: (q) => q.changePct24h },
  { header: '7d %', value: (q) => q.changePct7d },
  { header: 'Market cap', value: (q) => q.marketCap },
  { header: '24h volume', value: (q) => q.volume24h },
];

/**
 * What a saved screen holds.
 *
 * The raw text of each field rather than the parsed `ScreenerFilter`. The inputs are strings —
 * "1000000000" is what the user typed and what the box has to show again — and round-tripping
 * through numbers would rewrite "1e9" as "1000000000" under someone who typed the first.
 *
 * Every field is optional on read, because a view saved by an older build predates whichever
 * one was added last. `readScreenerView` fills the gaps rather than refusing the whole thing.
 */
interface ScreenerViewPayload {
  assetType: AssetType | null;
  query: string;
  minPrice: string;
  maxPrice: string;
  minCap: string;
  minChange: string;
  maxChange: string;
  sort: ScreenerSort;
  descending: boolean;
}

const SORT_IDS = SORTS.map((s) => s.id);

/** Validates a stored payload. Returns null when it is not a screen at all. */
function readScreenerView(raw: unknown): ScreenerViewPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;

  const text = (key: string): string => (typeof v[key] === 'string' ? (v[key] as string) : '');
  const assetType =
    v.assetType === 'crypto' || v.assetType === 'stock' ? (v.assetType as AssetType) : null;

  // An unknown sort would leave the select with no matching option and the screen sorted by
  // something the user cannot see. Falling back is better than rendering a lie.
  const sort = SORT_IDS.includes(v.sort as ScreenerSort) ? (v.sort as ScreenerSort) : 'market-cap';

  return {
    assetType,
    query: text('query'),
    minPrice: text('minPrice'),
    maxPrice: text('maxPrice'),
    minCap: text('minCap'),
    minChange: text('minChange'),
    maxChange: text('maxChange'),
    sort,
    descending: typeof v.descending === 'boolean' ? v.descending : true,
  };
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

  const currentView = (): ScreenerViewPayload => ({
    assetType,
    query,
    minPrice,
    maxPrice,
    minCap,
    minChange,
    maxChange,
    sort,
    descending,
  });

  const applyView = (raw: unknown): boolean => {
    const view = readScreenerView(raw);
    if (!view) return false;

    setAssetType(view.assetType);
    setQuery(view.query);
    setMinPrice(view.minPrice);
    setMaxPrice(view.maxPrice);
    setMinCap(view.minCap);
    setMinChange(view.minChange);
    setMaxChange(view.maxChange);
    setSort(view.sort);
    setDescending(view.descending);
    return true;
  };
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
            <SavedViews kind="screener" current={currentView} onApply={applyView} />

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
          actions={
            <ExportCsv
              subject="screen"
              columns={SCREENER_COLUMNS}
              rows={() => rows}
              disabled={rows.length === 0}
            />
          }
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
