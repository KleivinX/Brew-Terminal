import type { ReactNode } from 'react';
import { NavRail } from './NavRail';
import { StatusBar } from './StatusBar';
import styles from './AppShell.module.css';

/**
 * Nav rail + workspace + status bar. The shell survives any single panel failing, which is why
 * route content sits inside its own error boundary rather than this component.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <a className="skip-link" href="#workspace">
        Skip to content
      </a>
      <NavRail />
      <div className={styles.main}>
        <main id="workspace" className={styles.workspace} tabIndex={-1}>
          {children}
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
