import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { isTauri } from '@/lib/env';
import { toast } from '@/stores/toastStore';
import type { TriggeredAlert } from '@/types/domain';

/**
 * Surfaces an alert that fired while the user was doing something else.
 *
 * The background poll records `triggered_at` and, until now, wrote a log line. Unless the user
 * happened to open the alerts panel afterwards, the thing they asked to be told about was never
 * actually told to them.
 *
 * Two routes, and they are not redundant. Rust sends an OS notification, which is what reaches
 * someone whose window is not in front — the entire point of a price alert. This is the other
 * half: when the app *is* in front, a system notification is the wrong texture and easy to miss,
 * so the event becomes a toast in the app's own voice.
 */

/** Exported for tests: what happens when alerts arrive, without the Tauri listener around it. */
export function announceFiredAlerts(fired: TriggeredAlert[], openAlerts: () => void): void {
  if (fired.length === 0) return;

  /*
   * One toast per alert up to a point, then a single summary. Several thresholds crossing in
   * the same poll is normal in a fast market, and a column of six toasts is a wall rather than
   * a notification — the same reason the OS notification is always one.
   */
  if (fired.length > 3) {
    toast.warning(`${fired.length} alerts fired`, {
      detail: fired.map((f) => f.alert.symbol).join(', '),
      key: 'alerts:batch',
      action: { label: 'View', onAction: openAlerts },
    });
    return;
  }

  for (const item of fired) {
    toast.warning(item.message, {
      // Keyed by alert, so the same one arriving twice replaces rather than stacks.
      key: `alert:${item.alert.id}`,
      action: { label: 'View', onAction: openAlerts },
    });
  }
}

export function AlertWatch() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    // No event bus outside the desktop shell, and nothing to listen to in the browser harness.
    if (!isTauri()) return undefined;

    let stop: (() => void) | undefined;
    let cancelled = false;

    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<TriggeredAlert[]>('alerts:fired', (event) => {
        announceFiredAlerts(event.payload, () => void navigate('/settings/alerts'));
        // The panel is showing a list that just changed underneath it.
        void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      }).then((unlisten) => {
        // The await can land after unmount; without this the listener outlives the component.
        if (cancelled) unlisten();
        else stop = unlisten;
      }),
    );

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [navigate, queryClient]);

  return null;
}
