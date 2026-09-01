import { formatPrice } from '@/lib/format';
import type { Position } from '@/types/domain';
import styles from './PortfolioRoute.module.css';

interface AllocationProps {
  positions: Position[];
  currency: string;
}

/**
 * What share of the portfolio each holding represents.
 *
 * A statement of fact, deliberately without a verdict attached. There is no target allocation to
 * deviate from and no note about concentration — the reader can see that 90% is in one asset
 * without being told what to think about it.
 */
export function Allocation({ positions, currency }: AllocationProps) {
  const priced = positions.filter((p) => p.marketValue !== null && p.currency === currency);
  const total = priced.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);

  if (priced.length === 0 || total <= 0) {
    return (
      <p className={styles.caveat}>
        Allocation needs current prices, and none are available for these holdings yet.
      </p>
    );
  }

  const rows = priced
    .map((p) => ({
      symbol: p.symbol,
      value: p.marketValue ?? 0,
      share: ((p.marketValue ?? 0) / total) * 100,
    }))
    .sort((a, b) => b.share - a.share);

  return (
    <ul role="list" className={styles.allocation}>
      {rows.map((row) => (
        <li key={row.symbol} className={styles.allocationRow}>
          <span className={styles.allocationHead}>
            <span className={styles.symbol}>{row.symbol}</span>
            <span className="tabular">{row.share.toFixed(1)}%</span>
          </span>
          <span
            className={styles.bar}
            role="img"
            aria-label={`${row.symbol}: ${row.share.toFixed(1)} percent, ${formatPrice(row.value, currency)}`}
          >
            <span className={styles.barFill} style={{ inlineSize: `${row.share}%` }} />
          </span>
          <span className={[styles.allocationValue, 'tabular'].join(' ')}>
            {formatPrice(row.value, currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}
