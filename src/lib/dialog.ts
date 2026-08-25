import { isTauri } from './env';

/**
 * The native file picker, behind the same seam as `ipc()`.
 *
 * Outside Tauri — `npm run dev` in a browser, or a component test — there is no picker and no
 * real filesystem, so these return a fixed fake path. That lets the export and import flows be
 * built and tested in the fast loop; the harness's `export_profile` and `import_profile`
 * handlers know the path is not real. The desktop app gets the real dialog.
 */

/*
 * One virtual path for both directions, so a profile exported in the harness can be imported
 * again in the same session. Two different fake paths would make the round trip untestable in
 * the exact place it most needs testing.
 */
const HARNESS_PATH = '/harness/brew-terminal.brewprofile';

const FILTER = { name: 'Brew Terminal profile', extensions: ['brewprofile'] };

/** Returns the chosen path, or `null` if the user cancelled. */
export async function pickSaveLocation(defaultName: string): Promise<string | null> {
  if (!isTauri()) return HARNESS_PATH;

  const { save } = await import('@tauri-apps/plugin-dialog');
  return save({ defaultPath: defaultName, filters: [FILTER] });
}

/** Returns the chosen path, or `null` if the user cancelled. */
export async function pickProfileFile(): Promise<string | null> {
  if (!isTauri()) return HARNESS_PATH;

  const { open } = await import('@tauri-apps/plugin-dialog');
  const chosen = await open({ multiple: false, directory: false, filters: [FILTER] });
  return typeof chosen === 'string' ? chosen : null;
}
