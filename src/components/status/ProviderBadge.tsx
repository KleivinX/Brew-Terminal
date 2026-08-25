import type { EnvelopeMeta } from '@/types/envelope';
import { RelativeTime } from './RelativeTime';
import { fetchedAtEpochSeconds } from '@/lib/freshness';
import styles from './ProviderBadge.module.css';

interface ProviderBadgeProps {
  meta: EnvelopeMeta;
}

/**
 * Attribution and age, together, always. This component exists so that "which provider, how
 * old" is a single import rather than something each panel remembers to assemble.
 */
export function ProviderBadge({ meta }: ProviderBadgeProps) {
  const fetchedAt = fetchedAtEpochSeconds(meta);

  return (
    <span className={styles.badge}>
      <span className={styles.provider}>{meta.providerName}</span>
      <span aria-hidden="true">·</span>
      <span className={styles.updated}>
        updated <RelativeTime epochSeconds={fetchedAt} />
      </span>
      {meta.source === 'mock' ? <span className={styles.mock}>fixtures</span> : null}
    </span>
  );
}
