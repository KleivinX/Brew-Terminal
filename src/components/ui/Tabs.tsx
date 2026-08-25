import styles from './Tabs.module.css';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** Optional count badge, e.g. watchlist size. */
  count?: number | undefined;
}

interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /**
   * Builds the id of the panel each tab controls. Omit when the tabs act as a filter group
   * with no corresponding tabpanel element — advertising `aria-controls` for an id that does
   * not exist is worse than omitting it.
   */
  panelId?: ((id: T) => string) | undefined;
}

/**
 * Roving-tabindex tablist. Arrow keys move between tabs; only the active tab is in the tab
 * order, which is what the WAI-ARIA tabs pattern expects.
 */
export function Tabs<T extends string>({ items, value, onChange, label, panelId }: TabsProps<T>) {
  const activeIndex = items.findIndex((item) => item.id === value);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (activeIndex + 1) % items.length;
    if (event.key === 'ArrowLeft') nextIndex = (activeIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      const next = items[nextIndex];
      if (next) {
        onChange(next.id);
        const el = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
          `#tab-${next.id}`,
        );
        el?.focus();
      }
    }
  };

  return (
    <div role="tablist" aria-label={label} className={styles.tabs}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            id={`tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            {...(panelId ? { 'aria-controls': panelId(item.id) } : {})}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={handleKeyDown}
            className={[styles.tab, selected ? styles.active : null].filter(Boolean).join(' ')}
          >
            {item.label}
            {item.count !== undefined ? <span className={styles.count}>{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
