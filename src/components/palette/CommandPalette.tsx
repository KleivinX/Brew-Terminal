import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { ipc } from '@/lib/ipc';
import { rank } from '@/lib/fuzzy';
import { shortcutLabel } from '@/lib/keyboard';
import { usePaletteStore } from '@/stores/paletteStore';
import { useUiStore } from '@/stores/uiStore';
import { useTheme } from '@/app/providers/ThemeProvider';
import { usePreferences, useSetPreference } from '@/lib/preferences';
import { toast } from '@/stores/toastStore';
import { availableCommands, type Command, type CommandContext } from './commandRegistry';
import type { AssetSearchResult } from '@/types/domain';
import styles from './CommandPalette.module.css';

interface Row {
  key: string;
  group: string;
  title: string;
  /** Match quality, used to interleave commands and asset results. Never shown to the user. */
  score: number;
  subtitle?: string | undefined;
  shortcut?: string | undefined;
  icon?: Command['icon'] | undefined;
  run: () => void;
}

const SEARCH_DEBOUNCE_MS = 140;

/**
 * The modal wrapper. The body is a separate component so it mounts fresh on every open —
 * that gives `useState(initialQuery)` the right value at mount and removes the need for a
 * reset effect, which is both simpler and what `react-hooks/set-state-in-effect` is asking for.
 */
export function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  const initialQuery = usePaletteStore((s) => s.initialQuery);
  const closePalette = usePaletteStore((s) => s.closePalette);

  return (
    <Modal open={open} onClose={closePalette} title="Command palette" size="lg" hideHeader>
      <PaletteBody initialQuery={initialQuery} onClose={closePalette} />
    </Modal>
  );
}

function PaletteBody({ initialQuery, onClose }: { initialQuery: string; onClose: () => void }) {
  const toggleNavRail = useUiStore((s) => s.toggleNavRail);
  const replayOnboarding = useUiStore((s) => s.replayOnboarding);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setTheme, setMotion } = useTheme();
  const setPreference = useSetPreference();
  const { data: preferences } = usePreferences();

  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Debounced so a fast typist does not issue a search per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  const context: CommandContext = useMemo(
    () => ({
      navigate: (to) => void navigate(to),
      setTheme,
      toggleNavRail,
      setMotion,
      refreshVisible: () => {
        void queryClient.invalidateQueries();
      },
      clearCache: () => {
        /*
         * Clears every kind. The palette entry is the blunt instrument — Settings has the
         * per-kind controls — and someone reaching for it in a command list wants the cache
         * gone, not a submenu.
         */
        void ipc('clear_cache', { kind: null })
          .then(() => {
            void queryClient.invalidateQueries();
            toast.success('Cleared the cached market data');
          })
          .catch(() => toast.error('The cache could not be cleared'));
      },
      setAlertsEnabled: (enabled) => {
        setPreference.mutate({ key: 'alertsEnabled', value: enabled });
        toast.info(enabled ? 'Price alerts are on' : 'Price alerts are off');
      },
      replayOnboarding,
      closePalette: onClose,
      aiEnabled: preferences?.aiEnabled ?? false,
      alertsEnabled: preferences?.alertsEnabled ?? false,
      reducedMotion: preferences?.reducedMotion ?? 'system',
    }),
    [
      navigate,
      setTheme,
      setMotion,
      toggleNavRail,
      queryClient,
      onClose,
      replayOnboarding,
      setPreference,
      preferences?.aiEnabled,
      preferences?.alertsEnabled,
      preferences?.reducedMotion,
    ],
  );

  const { data: searchResults } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => ipc('search_assets', { query: debounced, limit: 8 }),
    enabled: debounced.trim().length > 0,
    staleTime: 30_000,
  });

  const rows = useMemo<Row[]>(() => {
    const commandRows: Row[] = rank(query, availableCommands(context), (c) => [
      c.title,
      ...(c.keywords ?? []),
    ]).map(({ item, score }) => ({
      key: item.id,
      group: item.group,
      title: item.title,
      score,
      icon: item.icon,
      shortcut: item.shortcut ? shortcutLabel(item.shortcut) : undefined,
      run: () => {
        item.run(context);
        onClose();
      },
    }));

    const assetRows: Row[] = (searchResults?.data ?? []).map((result: AssetSearchResult) => ({
      key: `asset:${result.asset.id}`,
      group: 'Search',
      title: `${result.asset.symbol} · ${result.asset.name}`,
      score: result.score,
      subtitle: result.asset.exchange ?? result.asset.assetType,
      icon: 'search' as const,
      run: () => {
        void navigate(`/research/${encodeURIComponent(result.asset.id)}`);
        onClose();
      },
    }));

    /*
     * Interleave by score rather than always leading with assets.
     *
     * Putting every asset first meant typing "soft" to reach the Soft theme navigated to
     * Microsoft instead — "Microsoft" merely *contains* "soft" (0.6) while "Theme: Soft"
     * matches it more directly (0.63). A strong asset match still wins: an exact ticker
     * scores 1.0 and a symbol prefix 0.9, comfortably above any command match.
     */
    return [...assetRows, ...commandRows].sort((a, b) => b.score - a.score).slice(0, 40);
  }, [query, context, searchResults, navigate, onClose]);

  // Derived, not stored: clamping at render avoids a state update cascading off row changes.
  const safeIndex = rows.length === 0 ? 0 : Math.min(activeIndex, rows.length - 1);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex(rows.length ? (safeIndex + 1) % rows.length : 0);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex(rows.length ? (safeIndex - 1 + rows.length) % rows.length : 0);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        rows[safeIndex]?.run();
      }
    },
    [rows, safeIndex],
  );

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  let lastGroup: string | null = null;

  return (
    <>
      <div className={styles.inputRow}>
        <Icon name="search" size={15} className={styles.inputIcon} />
        <input
          className={styles.input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search assets, or type a command…"
          aria-label="Search assets or run a command"
          aria-controls="palette-results"
          aria-activedescendant={rows[safeIndex] ? `palette-row-${safeIndex}` : undefined}
          role="combobox"
          aria-expanded
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className={styles.escHint}>esc</kbd>
      </div>

      <ul id="palette-results" ref={listRef} className={styles.list} role="listbox">
        {rows.length === 0 ? (
          <li role="presentation" className={styles.noResults}>
            No matching commands or assets.
          </li>
        ) : (
          rows.map((row, index) => {
            const showGroup = row.group !== lastGroup;
            lastGroup = row.group;
            const active = index === safeIndex;

            return (
              <Fragment key={row.key}>
                {showGroup ? (
                  <li role="presentation" className={styles.groupLabel}>
                    {row.group}
                  </li>
                ) : null}
                {/*
                  In the combobox + aria-activedescendant pattern, focus stays in the input and
                  options are deliberately NOT focusable — the input's keydown handler owns
                  arrow keys and Enter. jsx-a11y cannot see that relationship, so these two
                  rules are false positives here.
                */}
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
                <li
                  id={`palette-row-${index}`}
                  role="option"
                  aria-selected={active}
                  data-active={active}
                  className={[styles.row, active ? styles.active : null].filter(Boolean).join(' ')}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={row.run}
                >
                  {row.icon ? <Icon name={row.icon} size={14} className={styles.rowIcon} /> : null}
                  <span className={styles.rowTitle}>{row.title}</span>
                  {row.subtitle ? <span className={styles.rowSubtitle}>{row.subtitle}</span> : null}
                  {row.shortcut ? <kbd className={styles.rowShortcut}>{row.shortcut}</kbd> : null}
                </li>
              </Fragment>
            );
          })
        )}
      </ul>
    </>
  );
}
