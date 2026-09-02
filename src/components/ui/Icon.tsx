import type { SVGProps } from 'react';

/**
 * Hand-inlined icon set. A dozen paths beats an icon package and its tree-shaking guesswork —
 * see DEPENDENCIES.md. Decorative by default; pass a `title` when the icon carries meaning
 * that is not already in adjacent text.
 */

export type IconName =
  | 'pulse'
  | 'portfolio'
  | 'research'
  | 'learn'
  | 'desk'
  | 'settings'
  | 'search'
  | 'star'
  | 'star-filled'
  | 'chevron-right'
  | 'chevron-down'
  | 'close'
  | 'refresh'
  | 'warning'
  | 'info'
  | 'check'
  | 'external'
  | 'sidebar'
  | 'command'
  | 'plus'
  | 'notes'
  | 'trash';

const PATHS: Record<IconName, string> = {
  pulse: 'M2 12h4l3-8 4 16 3-8h4',
  portfolio: 'M3 19V9l5-4 5 4 5-3v13M3 19h18M8 19v-5h4v5',
  research: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.5 16.5 21 21',
  learn: 'M3 6.5 12 3l9 3.5-9 3.5-9-3.5zM6 10v5.5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V10',
  desk: 'M4 5h16v11H4zM9 20h6M12 16v4M8 9h5M8 12h8',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-1c.5.4 1.1.8 1.7 1l.4 2.6h4l.4-2.6c.6-.2 1.2-.6 1.7-1l2.3 1 2-3.4z',
  search: 'M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM16 16l5 5',
  star: 'M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8L6.7 20l1-6L3.4 9.9l6-.9z',
  'star-filled': 'M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8L6.7 20l1-6L3.4 9.9l6-.9z',
  'chevron-right': 'm9 5 7 7-7 7',
  'chevron-down': 'm5 9 7 7 7-7',
  close: 'M6 6l12 12M18 6 6 18',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4',
  warning: 'M12 3 2 20h20L12 3zM12 9v5M12 17.5v.5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 7.5V8',
  check: 'm4 12.5 5 5L20 7',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  sidebar: 'M4 5h16v14H4zM10 5v14',
  command: 'M6 3a3 3 0 1 1 3 3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3V6a3 3 0 1 1 3 3H6z',
  plus: 'M12 5v14M5 12h14',
  // A page with a folded corner and three ruled lines. Drawn on the same 24px grid and with
  // the same open-path, stroked construction as the rest of the set — an imported icon from
  // another family reads as foreign at 18px even when nobody can say why.
  notes: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4M9 12h6M9 16h6',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number | undefined;
  /** Provide when the icon is the only carrier of meaning. Omit for decorative icons. */
  title?: string | undefined;
}

export function Icon({ name, size = 16, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'star-filled' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
