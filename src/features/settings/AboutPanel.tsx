import { useMutation, useQuery } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { ipc } from '@/lib/ipc';
import { shortcutLabel } from '@/lib/keyboard';
import styles from './AboutPanel.module.css';

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: shortcutLabel('Mod+K'), action: 'Open the command palette' },
  { keys: shortcutLabel('Mod+R'), action: 'Refresh visible data' },
  { keys: 'g then p / r / l / d / s', action: 'Go to Pulse, Research, Learn, Desk, Settings' },
  { keys: `${shortcutLabel('Mod+')}1 – 5`, action: 'Jump to a navigation item' },
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
