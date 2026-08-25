import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  icon?: IconName | undefined;
  title: string;
  /** Empty states teach the next action — see UI_MAP.md §5. */
  description: string;
  action?: ReactNode | undefined;
}

export function EmptyState({ icon = 'info', title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <Icon name={icon} size={24} className={styles.icon} />
      <p className={styles.title}>{title}</p>
      <p className={styles.description}>{description}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
