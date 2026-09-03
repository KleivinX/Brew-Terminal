import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SearchField } from '@/components/ui/SearchField';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { EmptyState } from '@/components/status/EmptyState';
import { RelativeTime } from '@/components/status/RelativeTime';
import { SkeletonRows } from '@/components/status/Skeleton';
import { useAllNotes, useDeleteNote, useNoteSearch, useUpsertNote } from '@/lib/market';
import { MAX_NOTE_BODY, MAX_NOTE_TITLE, noteSymbol, snippetOf } from './noteText';
import type { Note } from '@/types/domain';
import styles from './NotesRoute.module.css';

/**
 * The notes workspace.
 *
 * Notes already existed before this route, but only inside the research panel and only ever
 * attached to an asset — `list_notes` takes an asset id, so a note with none was unreachable
 * the moment it was written. This is the surface that shows all of them, and the only place a
 * note that belongs to no particular asset can be made.
 *
 * Two panes rather than one: a list you can scan and an editor you can type in. The open note
 * is in the URL (`#/notes/:id`) so it survives a reload and can be linked to, which is the
 * behaviour anything that looks like a document expects.
 */
export function NotesRoute() {
  const { noteId } = useParams<{ noteId: string }>();
  const navigate = useNavigate();

  const { data: notes, isLoading } = useAllNotes();
  const [query, setQuery] = useState('');
  const { data: matches, isFetching: searching } = useNoteSearch(query);

  const upsertNote = useUpsertNote(undefined);
  const deleteNote = useDeleteNote(undefined);

  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);
  /*
   * Which note the save confirmation belongs to, rather than a bare boolean. A boolean was
   * cleared the instant a save navigated to the new note's URL, so the confirmation never
   * actually appeared. Keyed by id it survives that, and still clears itself when a different
   * note is opened.
   */
  const [savedId, setSavedId] = useState<string | null>(null);

  const searchActive = query.trim().length >= 2;
  const visible = useMemo(() => {
    const rows = searchActive ? (matches ?? []) : (notes ?? []);
    return rows;
  }, [searchActive, matches, notes]);

  /*
   * Which note is open: the URL decides, and the note that was just saved fills the gap.
   *
   * Saving asks the router to move to the new note's URL, but that navigation is asynchronous —
   * it had not landed by the time the list refetch rendered, so for a moment the app had saved
   * a note, was showing it in the list, and had collapsed the editor to "Nothing open". The
   * writer watched their note disappear the instant they saved it.
   *
   * Hanging the open note off the URL alone made the editor wait on the router for something it
   * already knew. `noteId` still wins, so deep links and switching notes behave exactly as
   * before; `savedId` only covers the window before the URL catches up.
   */
  const activeId = noteId ?? savedId;

  const selected = useMemo(() => {
    if (!activeId) return undefined;
    const fromList = (notes ?? []).find((note) => note.id === activeId);
    // The list refetch may also still be in flight; the save handed us the note itself.
    return fromList ?? (upsertNote.data?.id === activeId ? upsertNote.data : undefined);
  }, [activeId, notes, upsertNote.data]);

  /*
   * A note deleted elsewhere — the research panel, another window — leaves the URL pointing at
   * something that no longer exists. Once the list has loaded and does not contain it, step
   * back to the index rather than showing an editor for a ghost.
   */
  useEffect(() => {
    if (creating || isLoading || !noteId || !notes) return;
    if (!notes.some((note) => note.id === noteId)) void navigate('/notes', { replace: true });
  }, [creating, isLoading, noteId, notes, navigate]);

  // Keeps the list highlight and the editor in step while the URL is still catching up.
  const openId = selected?.id;

  const startNew = (): void => {
    setCreating(true);
    setSavedId(null);
    void navigate('/notes');
  };

  const open = (note: Note): void => {
    setCreating(false);
    setSavedId(null);
    void navigate(`/notes/${note.id}`);
  };

  const save = (title: string, bodyMd: string): void => {
    upsertNote.mutate(
      { noteId: creating ? null : (selected?.id ?? null), title: title.trim(), bodyMd },
      {
        onSuccess: (note) => {
          setCreating(false);
          setSavedId(note.id);
          void navigate(`/notes/${note.id}`);
        },
      },
    );
  };

  const confirmDelete = (): void => {
    if (!pendingDelete) return;
    const removed = pendingDelete.id;
    deleteNote.mutate(removed, {
      onSuccess: () => {
        setPendingDelete(null);
        // Cleared too, or the just-saved note would stay open after being deleted.
        if (savedId === removed) setSavedId(null);
        if (noteId === removed) void navigate('/notes');
      },
    });
  };

  const editing = creating || selected !== undefined;

  return (
    <>
      <WorkspaceHeader
        title="Notes"
        subtitle="Your own record of what you looked at and what you thought"
        actions={
          <Button size="sm" variant="primary" onClick={startNew}>
            New note
          </Button>
        }
      />

      <div className={styles.layout}>
        <section className={styles.list} aria-label="Notes">
          <div className={styles.listHeader}>
            <SearchField
              label="Search your notes"
              placeholder="Search notes…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p className={styles.count}>
              {searchActive
                ? `${visible.length} ${visible.length === 1 ? 'match' : 'matches'}`
                : `${visible.length} ${visible.length === 1 ? 'note' : 'notes'}`}
            </p>
          </div>

          <div className={styles.listBody}>
            {isLoading ? <SkeletonRows rows={5} columns={1} label="Loading notes" /> : null}

            {!isLoading && visible.length > 0 ? (
              <ul className={styles.items} role="list">
                {visible.map((note) => (
                  <li key={note.id} data-note-id={note.id}>
                    <button
                      type="button"
                      className={[styles.item, note.id === openId ? styles.itemActive : null]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => open(note)}
                      aria-current={note.id === openId ? 'true' : undefined}
                    >
                      <span className={styles.itemTitle}>{note.title || 'Untitled note'}</span>
                      {snippetOf(note.bodyMd) ? (
                        <span className={styles.itemSnippet}>{snippetOf(note.bodyMd)}</span>
                      ) : null}
                      <span className={styles.itemMeta}>
                        {note.assetId ? (
                          <span className={styles.tag}>{noteSymbol(note.assetId)}</span>
                        ) : null}
                        <RelativeTime epochSeconds={note.updatedAt} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {!isLoading && visible.length === 0 && searchActive && !searching ? (
              <EmptyState
                icon="search"
                title="Nothing matches that"
                description={`No note contains “${query.trim()}”. Searching looks at both titles and bodies.`}
                action={
                  <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
                    Clear search
                  </Button>
                }
              />
            ) : null}

            {!isLoading && visible.length === 0 && !searchActive ? (
              <EmptyState
                icon="notes"
                title="No notes yet"
                description="Write down a thesis, a question, or what made you look at something. Notes stay on this computer."
                action={
                  <Button variant="primary" size="sm" onClick={startNew}>
                    Write your first note
                  </Button>
                }
              />
            ) : null}
          </div>
        </section>

        <section className={styles.editor} aria-label="Note editor">
          {!editing ? (
            <EmptyState
              icon="notes"
              title="Nothing open"
              description="Pick a note from the list, or start a new one."
              action={
                <Button variant="secondary" size="sm" onClick={startNew}>
                  New note
                </Button>
              }
            />
          ) : (
            /*
              Keyed by what is being edited, so React discards the old editor and mounts a fresh
              one whenever a different note is opened. That is what seeds the fields — replacing
              an effect that wrote to state on every identity change, which the compiler rightly
              flags as a cascading render and which also raced the save round-trip.
            */
            <NoteEditor
              key={creating ? 'new' : selected!.id}
              note={creating ? null : selected!}
              saving={upsertNote.isPending}
              failed={upsertNote.isError}
              saved={savedId !== null && savedId === selected?.id}
              onSave={save}
              onDelete={() => selected && setPendingDelete(selected)}
            />
          )}
        </section>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this note?"
        message={`“${pendingDelete?.title || 'Untitled note'}” will be removed from this computer. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

interface NoteEditorProps {
  /** `null` while writing a new note. */
  note: Note | null;
  saving: boolean;
  failed: boolean;
  saved: boolean;
  onSave: (title: string, bodyMd: string) => void;
  onDelete: () => void;
}

/**
 * The editing pane.
 *
 * Owns the draft. Its parent mounts it under a key derived from the note being edited, so
 * switching notes replaces the component rather than mutating it — the React-recommended way
 * to reset state when identity changes, and the reason there is no effect here at all.
 */
function NoteEditor({ note, saving, failed, saved, onSave, onDelete }: NoteEditorProps) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.bodyMd ?? '');
  const titleRef = useRef<HTMLInputElement>(null);

  // A new note opens with the caret in the title. Only on mount, and only for a new note —
  // stealing focus when an existing note is opened would fight anyone using the keyboard.
  useEffect(() => {
    if (note === null) titleRef.current?.focus();
  }, [note]);

  const dirty =
    note === null
      ? title.trim() !== '' || body.trim() !== ''
      : title !== note.title || body !== note.bodyMd;
  const empty = title.trim() === '' && body.trim() === '';
  const tooLong = body.length > MAX_NOTE_BODY || title.length > MAX_NOTE_TITLE;

  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="note-title">
          Title
        </label>
        <Input
          id="note-title"
          ref={titleRef}
          value={title}
          maxLength={MAX_NOTE_TITLE}
          placeholder="What is this about?"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className={[styles.field, styles.bodyField].join(' ')}>
        <label className={styles.label} htmlFor="note-body">
          Note
        </label>
        <textarea
          id="note-body"
          className={styles.textarea}
          value={body}
          placeholder="Markdown is kept as you type it, and shown as plain text."
          onChange={(event) => setBody(event.target.value)}
          aria-describedby="note-body-help"
        />
        <p id="note-body-help" className={styles.help}>
          {/*
            Stated rather than implied. The app keeps the source as typed instead of running a
            Markdown renderer, because a renderer is an HTML-injection surface — a deliberate
            trade recorded in the Note model, and one the writer should not have to discover by
            watching their `**bold**` stay literal.
          */}
          Stored on this computer only, never sent anywhere on its own.
          <span className={tooLong ? styles.overLimit : styles.counter}>
            {body.length.toLocaleString()} / {MAX_NOTE_BODY.toLocaleString()}
          </span>
        </p>
      </div>

      {note ? (
        <p className={styles.timestamps}>
          {note.assetId ? (
            <>
              Attached to <span className={styles.tag}>{noteSymbol(note.assetId)}</span>
              {' · '}
            </>
          ) : null}
          Created <RelativeTime epochSeconds={note.createdAt} />
          {' · edited '}
          <RelativeTime epochSeconds={note.updatedAt} />
        </p>
      ) : null}

      {failed ? (
        <p className={styles.error} role="alert">
          That note could not be saved.
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          onClick={() => onSave(title, body)}
          disabled={empty || tooLong || saving}
        >
          {saving ? 'Saving…' : 'Save note'}
        </Button>

        {note ? (
          <Button variant="ghost" size="sm" onClick={onDelete} className={styles.delete}>
            <Icon name="trash" size={14} /> Delete
          </Button>
        ) : null}

        {/*
          Save state in words. `dirty` is checked first: after an edit the "Saved" confirmation
          is stale, and leaving it up would tell the writer their unsaved work is safe.
        */}
        <span className={styles.saveState} role="status">
          {dirty ? 'Unsaved changes' : saved ? 'Saved' : note ? 'Up to date' : ''}
        </span>
      </div>
    </div>
  );
}
