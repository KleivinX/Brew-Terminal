import type { IconName } from '@/components/ui/Icon';
import type { Theme } from '@/types/domain';

/**
 * The command registry.
 *
 * A command declares an `available()` predicate so unconfigured features (AI, community) are
 * hidden rather than shown broken. See UI_MAP.md §3.
 */

export type CommandGroup = 'Search' | 'Navigate' | 'Watchlist' | 'Appearance' | 'Data' | 'Help';

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  icon?: IconName | undefined;
  /** Extra terms the fuzzy matcher should consider — synonyms, abbreviations. */
  keywords?: string[] | undefined;
  shortcut?: string | undefined;
  /**
   * Where a Navigate command goes.
   *
   * Declared rather than left implicit inside `run`, so the destination can be checked against
   * the nav rail without reflecting over a closure — reading a route back out of
   * `run.toString()` works until a build step renames or inlines something, and then fails in
   * a way that looks like a missing command rather than a broken test.
   */
  route?: string | undefined;
  run: (context: CommandContext) => void;
  available?: ((context: CommandContext) => boolean) | undefined;
}

export interface CommandContext {
  navigate: (to: string) => void;
  setTheme: (theme: Theme) => void;
  toggleNavRail: () => void;
  refreshVisible: () => void;
  closePalette: () => void;
  aiEnabled: boolean;
}

/** A command whose whole job is to go somewhere. */
function goTo(
  spec: Omit<Command, 'group' | 'run'> & { route: string },
): Command {
  return { ...spec, group: 'Navigate', run: (ctx) => ctx.navigate(spec.route) };
}

export const commands: Command[] = [
  // --- Navigate ---
  goTo({
    id: 'nav.pulse',
    title: 'Go to Pulse',
    icon: 'pulse',
    keywords: ['market', 'overview', 'dashboard', 'home'],
    shortcut: 'g p',
    route: '/pulse',
  }),
  goTo({
    id: 'nav.portfolio',
    title: 'Go to Portfolio',
    icon: 'portfolio',
    keywords: ['holdings', 'positions', 'transactions', 'cost basis', 'pnl'],
    shortcut: 'g o',
    route: '/portfolio',
  }),
  goTo({
    id: 'nav.screener',
    title: 'Go to Screener',
    icon: 'search',
    keywords: ['filter', 'scan', 'find', 'criteria'],
    shortcut: 'g e',
    route: '/screener',
  }),
  goTo({
    id: 'nav.research',
    title: 'Go to Research Lab',
    icon: 'research',
    keywords: ['asset', 'detail', 'deep dive', 'chart'],
    shortcut: 'g r',
    route: '/research',
  }),
  goTo({
    id: 'nav.compare',
    title: 'Go to Compare',
    icon: 'pulse',
    keywords: ['correlation', 'macro', 'side by side', 'fear and greed', 'sentiment'],
    shortcut: 'g c',
    route: '/compare',
  }),
  goTo({
    id: 'nav.notes',
    title: 'Go to Notes',
    icon: 'notes',
    keywords: ['note', 'write', 'journal', 'thesis', 'diary'],
    shortcut: 'g n',
    route: '/notes',
  }),
  goTo({
    id: 'nav.newNote',
    title: 'Write a new note',
    icon: 'notes',
    keywords: ['new note', 'add note', 'jot', 'capture'],
    route: '/notes',
  }),
  goTo({
    id: 'nav.learn',
    title: 'Go to Learn',
    icon: 'learn',
    keywords: ['glossary', 'terms', 'education', 'lessons'],
    shortcut: 'g l',
    route: '/learn',
  }),
  goTo({
    id: 'nav.glossary',
    title: 'Open the glossary',
    icon: 'learn',
    keywords: ['define', 'definition', 'term', 'jargon'],
    route: '/learn/glossary',
  }),
  goTo({
    id: 'nav.paths',
    title: 'Browse learning paths',
    icon: 'learn',
    keywords: ['lessons', 'course', 'basics', 'stocks', 'crypto', 'risk'],
    route: '/learn',
  }),
  goTo({
    id: 'nav.desk',
    title: 'Go to Model Desk',
    icon: 'desk',
    keywords: ['ai', 'model', 'chat', 'explain'],
    shortcut: 'g d',
    route: '/desk',
  }),
  goTo({
    id: 'nav.settings',
    title: 'Open Settings',
    icon: 'settings',
    keywords: ['preferences', 'config', 'providers', 'keys'],
    shortcut: 'g s',
    route: '/settings',
  }),
  goTo({
    id: 'nav.providers',
    title: 'Open data providers',
    icon: 'settings',
    keywords: ['api', 'source', 'key', 'credential'],
    route: '/settings/providers',
  }),
  goTo({
    id: 'nav.markets',
    title: 'Open market settings',
    icon: 'settings',
    keywords: ['region', 'refresh', 'currency', 'interval'],
    route: '/settings/markets',
  }),
  goTo({
    id: 'nav.privacy',
    title: 'Open privacy settings',
    icon: 'settings',
    keywords: ['local', 'cloud', 'data', 'cache'],
    route: '/settings/privacy',
  }),

  // --- Appearance ---
  {
    id: 'theme.dark',
    title: 'Theme: Dark',
    group: 'Appearance',
    keywords: ['terminal', 'night', 'black'],
    run: (ctx) => ctx.setTheme('dark'),
  },
  {
    id: 'theme.light',
    title: 'Theme: Light',
    group: 'Appearance',
    keywords: ['day', 'white', 'bright'],
    run: (ctx) => ctx.setTheme('light'),
  },
  {
    id: 'theme.soft',
    title: 'Theme: Soft',
    group: 'Appearance',
    keywords: ['eye comfort', 'muted', 'low contrast', 'amber'],
    run: (ctx) => ctx.setTheme('soft'),
  },
  {
    id: 'ui.toggleRail',
    title: 'Toggle the navigation rail',
    group: 'Appearance',
    icon: 'sidebar',
    keywords: ['sidebar', 'collapse', 'expand'],
    run: (ctx) => ctx.toggleNavRail(),
  },

  // --- Data ---
  {
    id: 'data.refresh',
    title: 'Refresh visible data',
    group: 'Data',
    icon: 'refresh',
    keywords: ['reload', 'update', 'fetch'],
    shortcut: 'Mod+R',
    run: (ctx) => ctx.refreshVisible(),
  },

  // --- Help ---
  {
    id: 'help.about',
    title: 'About Brew Terminal',
    group: 'Help',
    icon: 'info',
    keywords: ['licence', 'license', 'version', 'attribution', 'disclaimer'],
    run: (ctx) => ctx.navigate('/settings/about'),
  },
];

export function availableCommands(context: CommandContext): Command[] {
  return commands.filter((command) => command.available?.(context) ?? true);
}
