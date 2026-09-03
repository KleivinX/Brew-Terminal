import { NavLink } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { useUiStore } from '@/stores/uiStore';
import { NAV_ITEMS } from './navItems';
import styles from './NavRail.module.css';

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
      {/*
        The mark is the real logo artwork, swapped by theme in CSS. The wordmark stays as text:
        the rail is 200px wide expanded, and the lockup's wordmark scaled to fit beside the mark
        would set its letters at about 8px — under the legibility floor. Text renders it crisp at
        any size and in any theme.

        Labelled once on the group so a screen reader hears "Brew Terminal" rather than the mark
        and the wordmark as two separate things.
      */}
      <div className={styles.brand} role="img" aria-label="Brew Terminal">
        <span className={styles.mark} aria-hidden="true" />
        {expanded ? (
          <span className={styles.wordmark} aria-hidden="true">
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
