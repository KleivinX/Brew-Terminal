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

export const commands: Command[] = [
  // --- Navigate ---
  {
    id: 'nav.pulse',
    title: 'Go to Pulse',
    group: 'Navigate',
    icon: 'pulse',
    keywords: ['market', 'overview', 'dashboard', 'home'],
    shortcut: 'g p',
    run: (ctx) => ctx.navigate('/pulse'),
  },
  {
    id: 'nav.research',
    title: 'Go to Research Lab',
    group: 'Navigate',
    icon: 'research',
    keywords: ['asset', 'detail', 'deep dive', 'chart'],
    shortcut: 'g r',
    run: (ctx) => ctx.navigate('/research'),
  },
  {
    id: 'nav.learn',
    title: 'Go to Learn',
    group: 'Navigate',
    icon: 'learn',
    keywords: ['glossary', 'terms', 'education', 'lessons'],
    shortcut: 'g l',
    run: (ctx) => ctx.navigate('/learn'),
  },
  {
    id: 'nav.glossary',
    title: 'Open the glossary',
    group: 'Navigate',
    icon: 'learn',
    keywords: ['define', 'definition', 'term', 'jargon'],
    run: (ctx) => ctx.navigate('/learn/glossary'),
  },
  {
    id: 'nav.paths',
    title: 'Browse learning paths',
    group: 'Navigate',
    icon: 'learn',
    keywords: ['lessons', 'course', 'basics', 'stocks', 'crypto', 'risk'],
    run: (ctx) => ctx.navigate('/learn'),
  },
  {
    id: 'nav.desk',
    title: 'Go to Model Desk',
    group: 'Navigate',
    icon: 'desk',
    keywords: ['ai', 'model', 'chat', 'explain'],
    shortcut: 'g d',
    run: (ctx) => ctx.navigate('/desk'),
  },
  {
    id: 'nav.settings',
    title: 'Open Settings',
    group: 'Navigate',
    icon: 'settings',
    keywords: ['preferences', 'config', 'providers', 'keys'],
    shortcut: 'g s',
    run: (ctx) => ctx.navigate('/settings'),
  },
  {
    id: 'nav.providers',
    title: 'Open data providers',
    group: 'Navigate',
    icon: 'settings',
    keywords: ['api', 'source', 'key', 'credential'],
    run: (ctx) => ctx.navigate('/settings/providers'),
  },
  {
    id: 'nav.markets',
    title: 'Open market settings',
    group: 'Navigate',
    icon: 'settings',
    keywords: ['region', 'refresh', 'currency', 'interval'],
    run: (ctx) => ctx.navigate('/settings/markets'),
  },
  {
    id: 'nav.privacy',
    title: 'Open privacy settings',
    group: 'Navigate',
    icon: 'settings',
    keywords: ['local', 'cloud', 'data', 'cache'],
    run: (ctx) => ctx.navigate('/settings/privacy'),
  },

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
