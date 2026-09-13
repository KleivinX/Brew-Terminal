import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import styles from './DemoNotice.module.css';

const DISMISSED_KEY = 'brew.demo.noticeDismissed';
const RELEASES = 'https://github.com/KleivinX/Brew-Terminal/releases';

/**
 * Shown only in the public demo build.
 *
 * The status bar already says "Mock data" on every route, permanently, and that is enough
 * inside a development build where the only person reading it put the fixtures there. A
 * stranger arriving from a link has no such context: they see a terminal full of prices that
 * move, and nothing in the framing tells them the market those prices came from does not
 * exist. So the demo says it once, loudly, before they have read a single number.
 *
 * Compiled in by a build-time flag rather than by `isBrowserHarness()`. The harness is also
 * what `npm run dev` and every jsdom test run against, and neither wants a banner about a
 * public demo; the desktop bundle never contains this component at all.
 *
 * Dismissal is per-browser and deliberately not synced anywhere. Losing it costs a reader one
 * click and tells them the truth a second time, which is the right way round for this to fail.
 */
export function DemoNotice() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === 'true';
    } catch {
      // Private windows and blocked site data both throw here. A notice that cannot remember
      // being dismissed is a small annoyance; one that crashes the shell is not.
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, 'true');
    } catch {
      /* nothing to do, and nothing worth telling the reader */
    }
  };

  return (
    <div className={styles.notice} role="status">
      <Icon name="warning" size={14} />
      <p className={styles.text}>
        <strong>This is a demo.</strong> Every number on it comes from fixtures shipped with the
        source, not from a market. Nothing here is a real price. The app itself is a desktop
        download that runs on your own machine and talks to real providers.
      </p>
      <a className={styles.link} href={RELEASES} target="_blank" rel="noreferrer">
        Get the app
      </a>
      <button type="button" className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
