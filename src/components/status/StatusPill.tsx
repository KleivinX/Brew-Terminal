import type { PanelState } from '@/types/envelope';
import styles from './StatusPill.module.css';

interface StatusPillProps {
  state: PanelState;
  label: string;
  /** Long-form explanation, surfaced as the title attribute. */
  detail?: string | undefined;
}

const STATE_CLASS: Record<PanelState, string> = {
  loading: 'loading',
  ready: 'ready',
  stale: 'stale',
  empty: 'muted',
  'rate-limited': 'stale',
  error: 'error',
  'not-configured': 'muted',
};

/**
 * Status is never colour alone — the pill always carries its label text, and the dot is
 * decorative. See UI_MAP.md §6.
 */
export function StatusPill({ state, label, detail }: StatusPillProps) {
  const variant = STATE_CLASS[state];
  return (
    <span className={[styles.pill, styles[variant]].join(' ')} title={detail} data-state={state}>
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </span>
  );
}
