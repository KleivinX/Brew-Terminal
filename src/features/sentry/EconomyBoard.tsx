import type { EconomyScore } from '@/types/domain';
import styles from './EconomyBoard.module.css';

/**
 * Country scorecards.
 *
 * Rows of published indicators, side by side, with **no composite score**. A single
 * "instability index" would be this app inventing a number and rendering it with the same
 * authority as the national accounts it was derived from, which is the thing ADR-022 rules
 * out. The reader compares the columns.
 *
 * Every value carries its own year, and that is load-bearing rather than pedantic: the World
 * Bank's most recent figure for the same indicator is a different year in different countries,
 * so one heading over the whole table would be wrong for most of it.
 */

interface EconomyBoardProps {
  economies: EconomyScore[];
  onSelect: (markerId: string) => void;
  selectedId: string | null;
}

export function EconomyBoard({ economies, onSelect, selectedId }: EconomyBoardProps) {
  if (economies.length === 0) {
    return (
      <p className={styles.quiet}>
        No country indicators. Switch the Economies layer on, or check its status in the layer list.
      </p>
    );
  }

  return (
    <ul role="list" className={styles.list}>
      {economies.map((economy) => {
        const markerId = `economy:${economy.countryCode}`;

        return (
          <li key={economy.countryCode}>
            <button
              type="button"
              className={styles.card}
              data-selected={markerId === selectedId ? 'true' : undefined}
              onClick={() => onSelect(markerId)}
            >
              <span className={styles.name}>
                {economy.countryName}
                <span className="visually-hidden">. Show on the map.</span>
              </span>

              <span className={styles.grid}>
                {economy.indicators.map((indicator) => (
                  <span key={indicator.code} className={styles.cell}>
                    <span className={styles.label}>{indicator.label}</span>
                    <span className={styles.value}>
                      {formatIndicator(indicator.value, indicator.unit)}
                    </span>
                    {/*
                      The year sits with the value, not in a column heading, because it is
                      genuinely per value. Germany's inflation may be 2025 while its neighbour's
                      is 2024 in the same response.
                    */}
                    <span className={styles.year}>{indicator.year}</span>
                  </span>
                ))}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One decimal place, with the unit attached.
 *
 * Deliberately not `ChangeValue`: these are levels, not changes. A current account deficit is
 * negative by definition for half the countries here and colouring it red would read as an
 * alarm about an ordinary state of affairs.
 */
function formatIndicator(value: number, unit: string): string {
  const rounded = value.toFixed(1);
  return unit === '%' ? `${rounded}%` : `${rounded}${unit ? ` ${unit}` : ''}`;
}
