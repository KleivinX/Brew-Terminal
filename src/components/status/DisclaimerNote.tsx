import styles from './DisclaimerNote.module.css';

/**
 * The standing notice.
 *
 * Deliberately a *liability* statement rather than a positioning one. "Educational information
 * only" described what the app was allowed to be, which undersold a tool that shows live market
 * data and runs real analysis. This says the thing that actually matters: the app does not
 * decide anything for you, and it carries none of the consequences if you decide badly.
 *
 * "Not advice" stays, because it is the load-bearing half. It is not modesty — an app that
 * issued personalised investment recommendations would be regulated as an adviser in most
 * jurisdictions, and no disclaimer cures that. Showing data, indicators and history is
 * software; telling a named person to buy a named asset is not.
 */
export const DISCLAIMER_TEXT =
  'A research tool, not an adviser. Your decisions, and their consequences, are your own.';

/** The long form, for surfaces with room for it. */
export const DISCLAIMER_LONG =
  'Brew Terminal shows you market data and helps you analyse it. It does not tell you what ' +
  'to do, and it accepts no responsibility for what you decide to do. Data comes from ' +
  'third-party providers and may be delayed, incomplete or wrong — verify anything that ' +
  'matters against a primary source. Any losses are yours.';

interface DisclaimerNoteProps {
  variant?: 'inline' | 'block' | undefined;
  /** Extra context for a specific surface, e.g. community content or AI output. */
  context?: string | undefined;
}

/**
 * Centralised so the wording is identical everywhere and a test can assert its presence on
 * every surface that shows prices, news, community content or model output.
 */
export function DisclaimerNote({ variant = 'inline', context }: DisclaimerNoteProps) {
  return (
    <p className={variant === 'block' ? styles.block : styles.inline}>
      {context ? <span className={styles.context}>{context} </span> : null}
      {DISCLAIMER_TEXT}
    </p>
  );
}
