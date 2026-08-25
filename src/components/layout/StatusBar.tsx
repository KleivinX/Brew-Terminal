import { useQuery } from '@tanstack/react-query';
import { Icon } from '@/components/ui/Icon';
import { DISCLAIMER_TEXT } from '@/components/status/DisclaimerNote';
import { ipc } from '@/lib/ipc';
import { isBrowserHarness } from '@/lib/env';
import styles from './StatusBar.module.css';

/**
 * A permanent honesty surface.
 *
 * Mode, provider mode and the standing disclaimer are visible at all times, on every route.
 * This is the one piece of chrome that is never conditional.
 */
export function StatusBar() {
  const { data: appInfo } = useQuery({
    queryKey: ['app-info'],
    queryFn: () => ipc('get_app_info'),
    staleTime: Infinity,
  });

  const mockMode = appInfo?.isMockMode ?? isBrowserHarness();

  return (
    <footer className={styles.bar}>
      <span className={styles.item}>
        <Icon name="info" size={12} />
        <span>Local-first · no account · no telemetry</span>
      </span>

      {mockMode ? (
        <span className={[styles.item, styles.mock].join(' ')}>
          <Icon name="warning" size={12} />
          <span>Mock data — development fixtures, not real market data</span>
        </span>
      ) : null}

      <span className={styles.spacer} />

      <span className={styles.disclaimer}>{DISCLAIMER_TEXT}</span>

      {appInfo ? <span className={styles.version}>v{appInfo.version}</span> : null}
    </footer>
  );
}
