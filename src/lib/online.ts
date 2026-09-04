import { useSyncExternalStore } from 'react';

/**
 * Whether the machine has a network connection, as the OS understands it.
 *
 * `navigator.onLine` is trustworthy in exactly one direction. **False means offline** — no
 * interface is up, and every provider request is going to fail. **True means very little**: it
 * is also true on a hotel wifi that has not been paid for, behind a captive portal, or on a
 * router with no upstream. Chromium and WebKit both report it that way and always have.
 *
 * So this is only ever used to say "offline", never to claim the providers are reachable. Panel
 * level freshness — the envelope, the stale banner, the provider badge — remains the thing that
 * says whether a particular number actually arrived, and this sits above it as the reason they
 * are all failing at once.
 */

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

/**
 * Server snapshot returns true.
 *
 * There is no SSR here, but `useSyncExternalStore` wants one and the honest default is the
 * optimistic one: an app that renders "offline" for a frame on every start would be crying
 * wolf, and the event listener corrects it immediately if it is wrong.
 */
function getServerSnapshot(): boolean {
  return true;
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
