import styles from './DisclaimerNote.module.css';

export const DISCLAIMER_TEXT = 'Educational information only — not financial advice.';

interface DisclaimerNoteProps {
  variant?: 'inline' | 'block' | undefined;
  /** Extra context for a specific surface, e.g. community content or AI output. */
  context?: string | undefined;
}

/**
 * The standing disclaimer. Centralised so the wording is identical everywhere and a test can
 * assert its presence on every surface that shows prices, news, community content or AI output.
 */
export function DisclaimerNote({ variant = 'inline', context }: DisclaimerNoteProps) {
  return (
    <p className={variant === 'block' ? styles.block : styles.inline}>
      {context ? <span className={styles.context}>{context} </span> : null}
      {DISCLAIMER_TEXT}
    </p>
  );
}
