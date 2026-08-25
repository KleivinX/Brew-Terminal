import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Icon } from '@/components/ui/Icon';
import { isTypingTarget } from '@/lib/keyboard';
import styles from './DataTable.module.css';

export interface Column<T> {
  id: string;
  header: string;
  /** CSS grid track, e.g. "minmax(180px, 2fr)" or "96px". */
  width: string;
  align?: 'left' | 'right' | undefined;
  sortable?: boolean | undefined;
  /** Value used for sorting. Omit for columns that are not sortable. */
  sortValue?: ((row: T) => number | string) | undefined;
  render: (row: T) => ReactNode;
  /** Screen-reader text when the rendered cell is visual (e.g. a sparkline). */
  cellLabel?: ((row: T) => string) | undefined;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  label: string;
  /** Fires on Enter or double-click. */
  onActivate?: ((row: T) => void) | undefined;
  selectedKey?: string | null | undefined;
  onSelectedKeyChange?: ((key: string | null) => void) | undefined;
  rowHeight?: number | undefined;
  emptyState?: ReactNode | undefined;
}

type SortDirection = 'asc' | 'desc';

/**
 * Virtualized, keyboard-navigable data table.
 *
 * Rendered as a CSS grid rather than a `<table>` so virtualization does not fight table layout;
 * ARIA grid roles carry the semantics that markup would otherwise provide. `aria-rowcount`
 * reports the full row count even though only the visible window exists in the DOM.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  label,
  onActivate,
  selectedKey = null,
  onSelectedKeyChange,
  rowHeight = 40,
  emptyState,
}: DataTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sort, setSort] = useState<{ columnId: string; direction: SortDirection } | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.id === sort.columnId);
    if (!column?.sortValue) return rows;

    const getValue = column.sortValue;
    const multiplier = sort.direction === 'asc' ? 1 : -1;

    return [...rows].sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * multiplier;
      return String(va).localeCompare(String(vb)) * multiplier;
    });
  }, [rows, columns, sort]);

  const virtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  const gridTemplate = useMemo(() => columns.map((c) => c.width).join(' '), [columns]);

  const toggleSort = useCallback((columnId: string) => {
    setSort((current) => {
      if (current?.columnId !== columnId) return { columnId, direction: 'desc' };
      if (current.direction === 'desc') return { columnId, direction: 'asc' };
      return null;
    });
  }, []);

  const moveSelection = useCallback(
    (delta: number) => {
      if (sortedRows.length === 0) return;
      const currentIndex = sortedRows.findIndex((row) => rowKey(row) === selectedKey);
      const nextIndex = Math.min(
        sortedRows.length - 1,
        Math.max(0, currentIndex === -1 ? 0 : currentIndex + delta),
      );
      const next = sortedRows[nextIndex];
      if (next) {
        onSelectedKeyChange?.(rowKey(next));
        virtualizer.scrollToIndex(nextIndex, { align: 'auto' });
      }
    },
    [sortedRows, selectedKey, rowKey, onSelectedKeyChange, virtualizer],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isTypingTarget(event.target)) return;

      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          event.preventDefault();
          moveSelection(1);
          break;
        case 'ArrowUp':
        case 'k':
          event.preventDefault();
          moveSelection(-1);
          break;
        case 'Home':
          event.preventDefault();
          moveSelection(-sortedRows.length);
          break;
        case 'End':
          event.preventDefault();
          moveSelection(sortedRows.length);
          break;
        case 'Enter': {
          const row = sortedRows.find((r) => rowKey(r) === selectedKey);
          if (row && onActivate) {
            event.preventDefault();
            onActivate(row);
          }
          break;
        }
        default:
          break;
      }
    },
    [moveSelection, sortedRows, selectedKey, rowKey, onActivate],
  );

  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div
      className={styles.table}
      role="grid"
      aria-label={label}
      aria-rowcount={sortedRows.length}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div ref={scrollRef} className={styles.scroll}>
        <div className={styles.head} role="row" style={{ gridTemplateColumns: gridTemplate }}>
          {columns.map((column) => {
            const isSorted = sort?.columnId === column.id;
            return (
              <div
                key={column.id}
                role="columnheader"
                aria-sort={
                  isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                }
                className={[
                  styles.headCell,
                  column.align === 'right' ? styles.right : null,
                  column.sortable ? styles.sortable : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {column.sortable ? (
                  <button
                    type="button"
                    className={styles.sortButton}
                    onClick={() => toggleSort(column.id)}
                  >
                    {column.header}
                    {isSorted ? (
                      <Icon
                        name={sort.direction === 'asc' ? 'chevron-down' : 'chevron-right'}
                        size={11}
                      />
                    ) : null}
                  </button>
                ) : (
                  column.header
                )}
              </div>
            );
          })}
        </div>

        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualRows.map((virtualRow) => {
            const row = sortedRows[virtualRow.index];
            if (!row) return null;
            const key = rowKey(row);
            const selected = key === selectedKey;

            return (
              /*
                Keyboard interaction lives on the grid container, which is the focusable
                element (tabIndex={0}) and handles arrows/j/k/Enter for the whole table.
                Duplicating handlers per row would create competing focus targets.
              */
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
              <div
                key={key}
                role="row"
                aria-rowindex={virtualRow.index + 1}
                aria-selected={selected}
                className={[styles.row, selected ? styles.selected : null]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  gridTemplateColumns: gridTemplate,
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => onSelectedKeyChange?.(key)}
                onDoubleClick={() => onActivate?.(row)}
              >
                {columns.map((column) => (
                  <div
                    key={column.id}
                    role="gridcell"
                    className={[styles.cell, column.align === 'right' ? styles.right : null]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {column.cellLabel ? (
                      <span className="visually-hidden">{column.cellLabel(row)}</span>
                    ) : null}
                    {column.render(row)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
