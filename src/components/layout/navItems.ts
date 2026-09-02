import type { IconName } from '@/components/ui/Icon';

/**
 * The primary navigation, in the order it is drawn.
 *
 * One list, three consumers: the rail renders it, the keyboard provider derives both the
 * `Mod+N` and `g`-prefix shortcuts from it, and the command palette is checked against it.
 *
 * It used to live inside `NavRail` while the shortcut maps were written out separately, and
 * the two drifted as routes were added: the rail grew to nine entries while `Mod+1`–`5` still
 * pointed at the five that existed when it was written. `Mod+2` was documented as "jump to a
 * navigation item" and went to Research, which by then was the fourth item. Deriving the
 * numbers from this array is what makes that promise true rather than aspirational.
 */
export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Shown under the label when the rail is expanded. */
  hint: string;
  /**
   * The letter that follows `g`. Chosen for memorability rather than by first letter, because
   * several routes collide on theirs — Settings took `s`, so Screener gets `e`.
   */
  key: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/pulse', label: 'Pulse', icon: 'pulse', hint: 'Market overview', key: 'p' },
  { to: '/portfolio', label: 'Portfolio', icon: 'portfolio', hint: 'What you hold', key: 'o' },
  { to: '/screener', label: 'Screener', icon: 'search', hint: 'Filter the market', key: 'e' },
  { to: '/research', label: 'Research Lab', icon: 'research', hint: 'Asset deep dive', key: 'r' },
  { to: '/compare', label: 'Compare', icon: 'pulse', hint: 'Side by side and macro', key: 'c' },
  { to: '/notes', label: 'Notes', icon: 'notes', hint: 'What you wrote down', key: 'n' },
  { to: '/learn', label: 'Learn', icon: 'learn', hint: 'Glossary and paths', key: 'l' },
  { to: '/desk', label: 'Model Desk', icon: 'desk', hint: 'Optional AI', key: 'd' },
  { to: '/settings', label: 'Settings', icon: 'settings', hint: 'Providers and privacy', key: 's' },
];

/** `g` then a letter. */
export const GO_TO_ROUTES: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.map((item) => [item.key, item.to]),
);

/**
 * `Mod+1` … `Mod+9`, in the order the rail draws them.
 *
 * Stops at nine: `Mod+0` is a browser zoom reset in every webview this ships on, and a tenth
 * nav item would need a different mechanism rather than a binding that fights the platform.
 */
export const NUMBER_ROUTES: Record<string, string> = Object.fromEntries(
  NAV_ITEMS.slice(0, 9).map((item, index) => [String(index + 1), item.to]),
);
