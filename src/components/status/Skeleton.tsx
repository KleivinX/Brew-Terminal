import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string | undefined;
  height?: string | undefined;
  className?: string | undefined;
}

/** Occupies the final layout so nothing jumps when real content arrives. */
export function Skeleton({ width = '100%', height = '14px', className }: SkeletonProps) {
  return (
    <span
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

interface SkeletonRowsProps {
  rows?: number | undefined;
  columns?: number | undefined;
  label?: string | undefined;
}

export function SkeletonRows({ rows = 8, columns = 5, label = 'Loading data' }: SkeletonRowsProps) {
  return (
    <div className={styles.rows} role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className={styles.row}>
          {Array.from({ length: columns }, (_, colIndex) => (
            <Skeleton key={colIndex} width={colIndex === 0 ? '30%' : '14%'} />
          ))}
        </div>
      ))}
    </div>
  );
}
