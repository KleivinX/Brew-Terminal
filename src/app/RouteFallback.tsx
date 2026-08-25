import { SkeletonRows } from '@/components/status/Skeleton';
import styles from './RouteFallback.module.css';

/** Shown while a lazy route chunk loads. Sized to the workspace so nothing jumps. */
export function RouteFallback({ label }: { label: string }) {
  return (
    <div className={styles.fallback}>
      <SkeletonRows rows={6} columns={4} label={label} />
    </div>
  );
}
