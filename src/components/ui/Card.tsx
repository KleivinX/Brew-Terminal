import type { ReactNode } from 'react';
import styles from './Card.module.css';

interface CardProps {
  label: string;
  value: ReactNode;
  /** Small supporting line: units, timeframe, or the source of the figure. */
  hint?: ReactNode | undefined;
  className?: string | undefined;
}

/** A single labelled figure. Used for key metrics — never for anything advisory. */
export function Card({ label, value, hint, className }: CardProps) {
  return (
    <div className={[styles.card, className].filter(Boolean).join(' ')}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}
