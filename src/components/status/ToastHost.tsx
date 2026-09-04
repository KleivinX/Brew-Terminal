import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToastStore, type Toast, type ToastTone } from '@/stores/toastStore';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import styles from './ToastHost.module.css';

/**
 * Renders the toast stack.
 *
 * Two live regions, both mounted for the life of the app even while empty. A screen reader
 * only announces changes inside a region it was already watching, so a region that appears at
 * the same moment as its first message announces nothing at all — the single most common way
 * to ship a notification system that is silent for the people who most need it.
 *
 * They are split by urgency rather than combined. `assertive` interrupts whatever is being
 * read, which is right for a failure and rude for "Saved", so errors go in one region and
 * everything else in the other.
 */

const TONE_ICON: Record<ToastTone, IconName> = {
  info: 'info',
  success: 'check',
  warning: 'warning',
  error: 'warning',
};

function ToastRow({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss);

  /*
   * Hovering or focusing the toast stops the clock. A message that removes itself while the
   * pointer is travelling toward its Undo button is worse than one that never offered undo,
   * because the user has already committed to the recovery that is no longer there.
   */
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (toast.duration === null || paused) return undefined;

    const timer = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
    // Leaving `paused` here restarts the full duration when the pointer moves away rather than
    // resuming the remainder. That is the friendlier of the two and needs no bookkeeping: the
    // error it can make is giving someone longer to act, which is not an error.
  }, [toast.id, toast.duration, paused, dismiss]);

  return (
    <li
      className={[styles.toast, styles[toast.tone]].join(' ')}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={TONE_ICON[toast.tone]} size={16} className={styles.icon} />

      <div className={styles.body}>
        <p className={styles.message}>{toast.message}</p>
        {toast.detail ? <p className={styles.detail}>{toast.detail}</p> : null}
      </div>

      {toast.action ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            // Dismissed first: the handler may raise a toast of its own, and the confirmation
            // for "undone" should not appear above the row that offered it.
            dismiss(toast.id);
            toast.action?.onAction();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}

      <IconButton
        icon="close"
        label="Dismiss"
        size={14}
        className={styles.close}
        onClick={() => dismiss(toast.id)}
      />
    </li>
  );
}

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);

  const urgent = toasts.filter((toast) => toast.tone === 'error');
  const routine = toasts.filter((toast) => toast.tone !== 'error');

  return createPortal(
    <div className={styles.host} data-testid="toast-host">
      {/*
        Errors sit above the rest of the stack so a burst of confirmations pushes downward,
        away from the one message that does not remove itself.
      */}
      <div className={styles.region} role="alert" aria-live="assertive" aria-label="Alerts">
        {/*
          The live region and the list are separate elements on purpose. Putting role="alert"
          on the <ol> replaces its list role, which leaves every <li> inside it orphaned — a
          real axe failure, and one that costs screen-reader users the "2 items" count.

          role="list" is not redundant here: Safari and VoiceOver drop list semantics from any
          list whose list-style is none, and WKWebView is the macOS target.
        */}
        <ol className={styles.list} role="list">
          {urgent.map((toast) => (
            <ToastRow key={toast.id} toast={toast} />
          ))}
        </ol>
      </div>

      <div className={styles.region} role="status" aria-live="polite" aria-label="Notifications">
        <ol className={styles.list} role="list">
          {routine.map((toast) => (
            <ToastRow key={toast.id} toast={toast} />
          ))}
        </ol>
      </div>
    </div>,
    document.body,
  );
}
