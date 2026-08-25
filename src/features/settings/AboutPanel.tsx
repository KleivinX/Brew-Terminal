import { useQuery } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
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

export function AboutPanel() {
  const { data: appInfo } = useQuery({
    queryKey: ['app-info'],
    queryFn: () => ipc('get_app_info'),
    staleTime: Infinity,
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
    </div>
  );
}
