import { formatPrice, formatPercent, formatQuantity } from '@/lib/format';
import type { Position } from '@/types/domain';
import styles from './PortfolioRoute.module.css';

interface PositionsTableProps {
  positions: Position[];
  currency: string;
  /** Closed positions have no quantity or value, so those columns are dropped. */
  closed?: boolean | undefined;
}

export function PositionsTable({ positions, currency, closed }: PositionsTableProps) {
  if (positions.length === 0) {
    return <p className={styles.caveat}>Nothing here yet.</p>;
  }

  return (
    <table className={styles.table}>
      <caption className="visually-hidden">
        {closed ? 'Closed positions' : 'Open positions'}
      </caption>
      <thead>
        <tr>
          <th scope="col">Asset</th>
          {closed ? null : <th scope="col">Quantity</th>}
          <th scope="col">Cost</th>
          {closed ? null : <th scope="col">Avg cost</th>}
          {closed ? null : <th scope="col">Price</th>}
          {closed ? null : <th scope="col">Value</th>}
          {closed ? null : <th scope="col">Unrealised</th>}
          <th scope="col">Realised</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr key={p.assetId}>
            <th scope="row" className={styles.symbol}>
              {p.symbol}
              {p.oversold ? (
                <span className={styles.flag} title="More sold than bought — history incomplete">
                  incomplete
                </span>
              ) : null}
              {p.currency !== currency ? <span className={styles.flag}>{p.currency}</span> : null}
            </th>
            {closed ? null : <td className="tabular">{formatQuantity(p.quantity)}</td>}
            <td className="tabular">{formatPrice(p.costBasis, p.currency)}</td>
            {closed ? null : (
              <td className="tabular">
                {p.averageCost === null ? '—' : formatPrice(p.averageCost, p.currency)}
              </td>
            )}
            {closed ? null : (
              <td className="tabular">
                {p.lastPrice === null ? '—' : formatPrice(p.lastPrice, p.currency)}
              </td>
            )}
            {closed ? null : (
              <td className="tabular">
                {/* An unpriced holding shows a dash, never a zero. */}
                {p.marketValue === null ? '—' : formatPrice(p.marketValue, p.currency)}
              </td>
            )}
            {closed ? null : (
              <td className={['tabular', toneOf(p.unrealisedPnl)].filter(Boolean).join(' ')}>
                {p.unrealisedPnl === null ? '—' : formatPrice(p.unrealisedPnl, p.currency)}
                {p.unrealisedPct === null ? null : (
                  <span className={styles.inlinePct}> {formatPercent(p.unrealisedPct)}</span>
                )}
              </td>
            )}
            <td className={['tabular', toneOf(p.realisedPnl)].filter(Boolean).join(' ')}>
              {formatPrice(p.realisedPnl, p.currency)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function toneOf(value: number | null): string | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? styles.positive : styles.negative;
}
