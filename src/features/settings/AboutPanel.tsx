import { useMutation, useQuery } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { ipc } from '@/lib/ipc';
import { shortcutLabel } from '@/lib/keyboard';
import { NAV_ITEMS } from '@/components/layout/navItems';
import styles from './AboutPanel.module.css';

/*
 * Built from the nav list rather than typed out. The hand-written version went stale as routes
 * were added — it advertised five `g` letters and `Mod+1–5` long after the rail had nine
 * entries, so half of what it promised did not work and the numbering pointed at the wrong
 * screens.
 */
const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: shortcutLabel('Mod+K'), action: 'Open the command palette' },
  { keys: shortcutLabel('Mod+R'), action: 'Refresh visible data' },
  {
    keys: `g then ${NAV_ITEMS.map((item) => item.key).join(' / ')}`,
    action: `Go to ${NAV_ITEMS.map((item) => item.label).join(', ')}`,
  },
  {
    keys: `${shortcutLabel('Mod+')}1 – ${Math.min(NAV_ITEMS.length, 9)}`,
    action: 'Jump to a navigation item, in rail order',
  },
  { keys: 'j / k or ↑ ↓', action: 'Move the table selection' },
  { keys: 'Enter', action: 'Open the selected asset' },
  { keys: 'Esc', action: 'Close an overlay' },
];

interface CreditLink {
  label: string;
  href: string;
}

interface Credit {
  name: string;
  role: string;
  links: CreditLink[];
}

interface Source {
  name: string;
  what: string;
  href: string;
  note?: string;
}

/**
 * The data sources actually in use, named.
 *
 * Settings → Data providers lists the adapters that can be switched on and off. The keyless
 * ones are not in that list, because they need no configuring — which meant the app was
 * reading from FRED and Alternative.me while naming them nowhere the user could go and look.
 * A provider badge next to a number tells you the source of that number; this tells you what
 * the app talks to at all. Kept in step with docs/PROVIDERS.md.
 */
const SOURCES: Source[] = [
  {
    name: 'CoinGecko',
    what: 'Crypto prices, market lists and charts',
    href: 'https://www.coingecko.com/en/api',
  },
  {
    name: 'FRED — Federal Reserve Bank of St. Louis',
    what: 'Macro series, and the inputs to the stock Fear & Greed index',
    href: 'https://fred.stlouisfed.org',
    note: 'US government data in the public domain. No key needed.',
  },
  {
    name: 'Alternative.me',
    what: 'The crypto Fear & Greed index, reported as published',
    href: 'https://alternative.me/crypto/fear-and-greed-index/',
  },
  {
    name: 'Finnhub',
    what: 'Equity quotes and profiles',
    href: 'https://finnhub.io',
    note: 'Off until you add your own key.',
  },
  {
    name: 'Alpha Vantage',
    what: 'Equity charts',
    href: 'https://www.alphavantage.co',
    note: 'Off until you add your own key.',
  },
  {
    name: 'Publisher RSS and Atom feeds',
    what: 'News, from the feed list you control',
    href: 'https://en.wikipedia.org/wiki/RSS',
  },
];

/**
 * Every link here opens in the OS browser rather than the app webview, the same rule every
 * other outbound link in the app follows. See THREAT_MODEL.md §3.
 */
const CREDITS: Credit[] = [
  {
    name: 'Kleivin Gjuzi',
    role: 'Built and maintains Brew Terminal',
    links: [
      { label: 'GitHub', href: 'https://github.com/KleivinX' },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/in/kleivin-gjuzi-7a7w/' },
    ],
  },
  {
    name: 'Blocks & Brew',
    role: 'Studio behind the project',
    links: [
      { label: 'blocksandbrew.com', href: 'https://blocksandbrew.com' },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/company/blocks-brew' },
      { label: 'Instagram', href: 'https://instagram.com/blocksandbrew' },
    ],
  },
];

export function AboutPanel() {
  const { data: appInfo } = useQuery({
    queryKey: ['app-info'],
    queryFn: () => ipc('get_app_info'),
    staleTime: Infinity,
  });

  // A mutation rather than a query on purpose: a query would run on mount, and this must only
  // ever happen because the user pressed the button.
  const updateCheck = useMutation({
    mutationFn: () => ipc('check_for_updates'),
  });

  return (
    <div className={styles.stack}>
      <Panel title="About Brew Terminal">
        <div className={styles.prose}>
          {/*
            The full lockup, at a size where the wordmark is actually legible. The nav rail only
            has room for the mark, so this is the one place the logo appears whole.
          */}
          <p className={styles.logo} role="img" aria-label="Brew Terminal" />
          <p className={styles.tagline}>Markets, minus the gatekeeping.</p>
          <p>
            A local-first, open-source market research and learning terminal. It is not a trading
            platform, a broker, a portfolio tracker, or a financial adviser, and it is not built to
            become one.
          </p>
          <dl className={styles.facts}>
            <dt>Version</dt>
            <dd className="tabular">{appInfo?.version ?? '—'}</dd>
            <dt>Code licence</dt>
            <dd>AGPL-3.0-or-later</dd>
            <dt>Name and logo</dt>
            <dd>Protected separately — see TRADEMARK.md</dd>
          </dl>
          <DisclaimerNote variant="block" />
        </div>
      </Panel>

      <Panel title="Updates">
        <div className={styles.prose}>
          <p>
            The app never checks for updates on its own. Pressing this asks GitHub what the newest
            release is — nothing is downloaded, and nothing about you or this installation is sent.
          </p>

          <Button
            variant="secondary"
            onClick={() => updateCheck.mutate()}
            disabled={updateCheck.isPending}
          >
            {updateCheck.isPending ? 'Checking…' : 'Check for updates'}
          </Button>

          {updateCheck.isError ? (
            <p className={styles.updateError} role="alert">
              Could not reach GitHub to check. You are still on {appInfo?.version ?? 'this build'}.
            </p>
          ) : null}

          {updateCheck.data ? (
            <p className={styles.updateResult} role="status">
              {updateCheck.data.comparisonFailed ? (
                <>
                  Could not tell. The latest release is tagged{' '}
                  <strong>{updateCheck.data.latestVersion}</strong>, which does not read as a
                  version number.{' '}
                  <a
                    href={updateCheck.data.releaseUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.creditLink}
                  >
                    Open the release page
                  </a>
                </>
              ) : updateCheck.data.updateAvailable ? (
                <>
                  <strong>{updateCheck.data.latestVersion}</strong> is available. You are running{' '}
                  {updateCheck.data.currentVersion}.{' '}
                  <a
                    href={updateCheck.data.releaseUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.creditLink}
                  >
                    Open the release page
                  </a>
                </>
              ) : (
                <>You are on the newest release ({updateCheck.data.currentVersion}).</>
              )}
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel title="Keyboard shortcuts">
        <table className={styles.shortcuts}>
          <caption className="visually-hidden">Keyboard shortcuts</caption>
          <thead>
            <tr>
              <th scope="col">Keys</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((shortcut) => (
              <tr key={shortcut.keys}>
                <td>
                  <kbd className={styles.kbd}>{shortcut.keys}</kbd>
                </td>
                <td>{shortcut.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Data attribution">
        <div className={styles.prose}>
          <p>
            Market data, news and community content come from third-party providers, each shown with
            its name and the time the data was retrieved. Figures may be delayed, incomplete or
            wrong. Verify anything that matters against a primary source.
          </p>
          <p className={styles.mock}>
            This build is running on development fixtures. Every number you see is synthetic.
          </p>

          <ul role="list" className={styles.sources}>
            {SOURCES.map((source) => (
              <li key={source.name} className={styles.source}>
                <a
                  className={styles.sourceName}
                  href={source.href}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {source.name}
                </a>
                <span className={styles.sourceWhat}>{source.what}</span>
                {source.note ? <span className={styles.sourceNote}>{source.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <Panel title="Credits">
        <div className={styles.prose}>
          <p className={styles.madeWith}>
            Made with <span aria-hidden="true">♥</span>
            <span className="visually-hidden">love</span> by Kleivin &amp; Blocks and Brew
          </p>

          <ul role="list" className={styles.credits}>
            {CREDITS.map((credit) => (
              <li key={credit.name} className={styles.credit}>
                <span className={styles.creditName}>{credit.name}</span>
                <span className={styles.creditRole}>{credit.role}</span>
                <span className={styles.creditLinks}>
                  {credit.links.map((link) => (
                    <a
                      key={link.href}
                      className={styles.creditLink}
                      href={link.href}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {link.label}
                    </a>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </div>
  );
}
