import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import styles from './ErrorState.module.css';

interface ErrorStateProps {
  title: string;
  /** User-safe message from the IPC layer. Never a raw provider body. */
  detail: string;
  onRetry?: (() => void) | undefined;
  /** Secondary route out, e.g. "Open Settings" when a provider is not configured. */
  action?: { label: string; onClick: () => void } | undefined;
}

/** Every error state offers a next action. A dead end is a bug. */
export function ErrorState({ title, detail, onRetry, action }: ErrorStateProps) {
  return (
    <div className={styles.error} role="alert">
      <Icon name="warning" size={20} className={styles.icon} />
      <p className={styles.title}>{title}</p>
      <p className={styles.detail}>{detail}</p>
      <div className={styles.actions}>
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <Icon name="refresh" size={13} />
            Try again
          </Button>
        ) : null}
        {action ? (
          <Button variant="ghost" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
