import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { useUiStore } from '@/stores/uiStore';
import styles from './NavRail.module.css';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Shown under the label when the rail is expanded. */
  hint: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/pulse', label: 'Pulse', icon: 'pulse', hint: 'Market overview' },
  { to: '/research', label: 'Research Lab', icon: 'research', hint: 'Asset deep dive' },
  { to: '/learn', label: 'Learn', icon: 'learn', hint: 'Glossary and paths' },
  { to: '/desk', label: 'Model Desk', icon: 'desk', hint: 'Optional AI' },
  { to: '/settings', label: 'Settings', icon: 'settings', hint: 'Providers and privacy' },
];

/**
 * Icon-only by default, expandable to labels. Labels are always in the DOM for screen readers
 * — collapsing is a visual affordance, not an accessibility trade.
 */
export function NavRail() {
  const expanded = useUiStore((s) => s.navRailExpanded);
  const toggle = useUiStore((s) => s.toggleNavRail);

  return (
    <nav
      className={[styles.rail, expanded ? styles.expanded : null].filter(Boolean).join(' ')}
      aria-label="Primary"
    >
      <div className={styles.brand}>
        <span className={styles.mark} aria-hidden="true">
          B
        </span>
        {expanded ? (
          <span className={styles.wordmark}>
            Brew<span className={styles.wordmarkAccent}>Terminal</span>
          </span>
        ) : null}
      </div>

      <ul className={styles.list} role="list">
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                [styles.link, isActive ? styles.active : null].filter(Boolean).join(' ')
              }
              title={expanded ? undefined : item.label}
            >
              <Icon name={item.icon} size={18} />
              <span className={expanded ? styles.linkText : 'visually-hidden'}>
                {item.label}
                {expanded ? <span className={styles.linkHint}>{item.hint}</span> : null}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className={styles.footer}>
        <IconButton
          icon="sidebar"
          label={expanded ? 'Collapse navigation' : 'Expand navigation'}
          onClick={toggle}
          aria-expanded={expanded}
        />
      </div>
    </nav>
  );
}
