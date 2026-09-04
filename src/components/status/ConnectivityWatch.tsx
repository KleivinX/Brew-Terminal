import { useEffect, useRef } from 'react';
import { useOnline } from '@/lib/online';
import { toast } from '@/stores/toastStore';

/**
 * Says something the first time the network goes away, and again when it comes back.
 *
 * The status bar carries the standing indicator; this is the interruption, because the moment
 * connectivity drops is the moment every panel starts failing at once and the reason is not
 * otherwise on screen.
 *
 * Renders nothing. It exists so the effect has a home that is not the status bar — the bar
 * should keep working if this is ever removed, and vice versa.
 */
export function ConnectivityWatch() {
  const online = useOnline();

  /*
   * Nothing is said on the first render. Starting the app with no network is a state the
   * status bar already shows, and a toast for it would be an alert about something the user
   * has not just done. Only a *change* is worth interrupting for.
   */
  const previous = useRef<boolean | null>(null);

  useEffect(() => {
    const was = previous.current;
    previous.current = online;
    if (was === null || was === online) return;

    // Keyed, so a flapping connection replaces its own message rather than stacking a column
    // of them.
    if (online) {
      toast.success('Back online', { key: 'connectivity' });
    } else {
      toast.warning('No network connection', {
        detail: 'Panels will show the last data they cached, with its age.',
        key: 'connectivity',
        duration: null,
      });
    }
  }, [online]);

  return null;
}
