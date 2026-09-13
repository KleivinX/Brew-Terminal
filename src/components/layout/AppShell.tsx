import type { ReactNode } from 'react';
import { NavRail } from './NavRail';
import { StatusBar } from './StatusBar';
import { DemoNotice } from '@/components/status/DemoNotice';
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
        {/*
          Only ever rendered by the GitHub Pages build. `import.meta.env.VITE_DEMO` is a literal
          substituted at build time, so the desktop bundle drops this branch and the component
          with it rather than shipping a banner it can never show.
        */}
        {import.meta.env.VITE_DEMO ? <DemoNotice /> : null}
        <main id="workspace" className={styles.workspace} tabIndex={-1}>
          {children}
        </main>
        <StatusBar />
      </div>
    </div>
  );
}
