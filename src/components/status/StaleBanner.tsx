import { Icon } from '@/components/ui/Icon';
import { RelativeTime } from './RelativeTime';
import type { EnvelopeMeta } from '@/types/envelope';
import { fetchedAtEpochSeconds } from '@/lib/freshness';
import styles from './StaleBanner.module.css';

interface StaleBannerProps {
  meta: EnvelopeMeta;
}

/**
 * Shown above data that is still on screen while something is wrong with the refresh.
 * Stale never means blank: the last good value stays visible, clearly marked as old.
 */
export function StaleBanner({ meta }: StaleBannerProps) {
  const isRateLimited = meta.degraded?.reason === 'rate_limited';

  return (
    <div
      className={[styles.banner, isRateLimited ? styles.limited : styles.stale].join(' ')}
      role="status"
    >
      <Icon name={isRateLimited ? 'info' : 'warning'} size={13} />
      <span>
        {meta.degraded
          ? meta.degraded.message
          : 'These values are older than usual while a refresh runs.'}
      </span>
      <span className={styles.age}>
        from <RelativeTime epochSeconds={fetchedAtEpochSeconds(meta)} />
      </span>
    </div>
  );
}
