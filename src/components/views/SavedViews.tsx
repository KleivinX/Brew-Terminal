import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconButton } from '@/components/ui/IconButton';
import { ipc } from '@/lib/ipc';
import { toast } from '@/stores/toastStore';
import type { SavedView, SavedViewKind } from '@/types/domain';
import styles from './SavedViews.module.css';

/**
 * Named filter sets and selections, for any screen that builds one.
 *
 * The screener has six filter fields and a sort; compare has up to six assets and a range. Both
 * threw that away on reload, which made them things you played with rather than things you came
 * back to.
 *
 * The payload is opaque to this component and to Rust — the screen that wrote it owns the shape.
 * That is why `onApply` receives parsed JSON and is expected to validate: a view written by an
 * older version may no longer describe fields that exist, and the screen is the only thing that
 * can tell.
 *
 * Nothing is applied automatically. A screen that silently restored a filter set would leave
 * someone looking at a filtered market wondering where everything went, which is the same
 * failure as showing a stale number with no age on it.
 */

interface SavedViewsProps {
  kind: SavedViewKind;
  /** The current screen state, serialised. Called only when Save is pressed. */
  current: () => unknown;
  /** Given the parsed payload. Return false if it cannot be read, and say so to the user. */
  onApply: (payload: unknown) => boolean;
  /** Disables Save when the screen has nothing worth keeping. */
  canSave?: boolean | undefined;
}

export function SavedViews({ kind, current, onApply, canSave = true }: SavedViewsProps) {
  const queryClient = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  /*
   * Focus moves to the name field when it appears, because the button that revealed it has just
   * been removed from the DOM — without this a keyboard user is left with focus on nothing.
   * A stable callback ref rather than autoFocus: the attribute is banned for the general case
   * (it steals focus on page load), and this is the specific case where moving focus is the
   * correct behaviour rather than a surprise.
   */
  const focusOnMount = useCallback((element: HTMLInputElement | null) => {
    element?.focus();
  }, []);

  const { data: views } = useQuery({
    queryKey: ['saved-views', kind],
    queryFn: () => ipc('list_saved_views', { kind }),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['saved-views', kind] });
  };

  const save = useMutation({
    mutationFn: (viewName: string) =>
      ipc('save_view', { kind, name: viewName, payload: JSON.stringify(current()) }),
    onSuccess: (view) => {
      setNaming(false);
      setName('');
      refresh();
      toast.success(`Saved “${view.name}”`);
    },
    onError: () =>
      toast.error('That view could not be saved', {
        detail: 'Check the name is not empty and try again.',
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => ipc('delete_saved_view', { id }),
    onSuccess: refresh,
    onError: () => toast.error('That view could not be removed'),
  });

  const apply = (view: SavedView): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(view.payload);
    } catch {
      /*
       * Stored JSON that will not parse means the row was written by something other than this
       * app, since save validates before storing. Saying so beats a screen that silently does
       * nothing when a button is pressed.
       */
      toast.error(`“${view.name}” could not be read`);
      return;
    }

    if (!onApply(parsed)) {
      toast.warning(`“${view.name}” was saved by an older version`, {
        detail: 'It no longer matches what this screen can show. Save it again to replace it.',
      });
      return;
    }

    toast.info(`Applied “${view.name}”`);
  };

  const rows = views ?? [];

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        {rows.length > 0 ? (
          <ul role="list" className={styles.list}>
            {rows.map((view) => (
              <li key={view.id} className={styles.chip}>
                {/*
                  The label is explicit because the visible text is only the view's name, and
                  "Large caps" on its own does not say what pressing it does. Sighted users get
                  that from the chip's shape and position; a screen reader gets it from here.
                */}
                <button
                  type="button"
                  className={styles.apply}
                  aria-label={`Apply ${view.name}`}
                  onClick={() => apply(view)}
                >
                  {view.name}
                </button>
                <IconButton
                  icon="close"
                  label={`Remove ${view.name}`}
                  size={12}
                  className={styles.remove}
                  onClick={() => remove.mutate(view.id)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>No saved views yet.</p>
        )}

        {naming ? null : (
          <Button size="sm" variant="secondary" disabled={!canSave} onClick={() => setNaming(true)}>
            Save this view
          </Button>
        )}
      </div>

      {naming ? (
        <form
          className={styles.namer}
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) save.mutate(name.trim());
          }}
        >
          <Input
            ref={focusOnMount}
            aria-label="Name for this view"
            placeholder="Name this view"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setNaming(false);
                setName('');
              }
            }}
          />
          <Button
            type="submit"
            size="sm"
            variant="primary"
            disabled={!name.trim() || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setNaming(false);
              setName('');
            }}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {/* Saving over a name is how a refined view is updated, so it is worth saying. */}
      {naming && rows.some((view) => view.name === name.trim()) ? (
        <p className={styles.hint} role="status">
          This replaces the view already called “{name.trim()}”.
        </p>
      ) : null}
    </div>
  );
}
