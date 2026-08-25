/**
 * Runtime environment detection.
 *
 * The app must be developable in a plain browser (`npm run dev`) as well as inside Tauri.
 * There is no macOS WebDriver for Tauri, so the browser harness is also where a good deal of
 * automated UI coverage runs — see ARCHITECTURE.md §12.
 */

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const isDev = (): boolean => import.meta.env.DEV;

/** True when data is coming from fixtures rather than any provider. */
export const isBrowserHarness = (): boolean => !isTauri();
