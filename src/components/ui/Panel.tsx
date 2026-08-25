import type { ReactNode } from 'react';
import styles from './Panel.module.css';

interface PanelProps {
  title: string;
  /** Rendered in the header, right-aligned: provider badge, status pill, filters. */
  actions?: ReactNode | undefined;
  /** Sits under the title — usually the provider attribution and last-updated line. */
  meta?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  /** Set when the panel body scrolls independently (tables, long lists). */
  scroll?: boolean | undefined;
  /**
   * Makes the body fill the remaining height of a flex parent.
   *
   * Off by default: in a scrolling column of panels, a filling body squashes every panel to
   * nothing. Only a panel that owns its viewport — the Pulse market table — wants this.
   */
  fill?: boolean | undefined;
}

export function Panel({ title, actions, meta, children, className, scroll, fill }: PanelProps) {
  return (
    <section className={[styles.panel, className].filter(Boolean).join(' ')} aria-label={title}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h2 className={styles.title}>{title}</h2>
          {meta ? <div className={styles.meta}>{meta}</div> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>
      <div
        className={[scroll ? styles.bodyScroll : styles.body, fill ? styles.bodyFill : null]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>
    </section>
  );
}
