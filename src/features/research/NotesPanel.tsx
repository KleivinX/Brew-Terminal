import { useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconButton } from '@/components/ui/IconButton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/status/EmptyState';
import { RelativeTime } from '@/components/status/RelativeTime';
import { useDeleteNote, useNotes, useRestoreNote, useUpsertNote } from '@/lib/market';
import { dayToEpoch, isoDay } from '@/lib/format';
import { toast } from '@/stores/toastStore';
import type { Note } from '@/types/domain';
import styles from './NotesPanel.module.css';

interface NotesPanelProps {
  assetId: string;
  symbol: string;
}

export function NotesPanel({ assetId, symbol }: NotesPanelProps) {
  const { data: notes, isLoading } = useNotes(assetId);
  const upsertNote = useUpsertNote(assetId);
  const deleteNote = useDeleteNote(assetId);
  const restoreNote = useRestoreNote(assetId);

  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);
  /*
   * The day this note is about, as a `yyyy-mm-dd` string because that is what a date input
   * speaks. Empty means unpinned, which is the normal case.
   */
  const [pinned, setPinned] = useState('');

  const startNew = (): void => {
    setEditing('new');
    setTitle('');
    setBody('');
    setPinned('');
  };

  const startEdit = (note: Note): void => {
    setEditing(note);
    setTitle(note.title);
    setBody(note.bodyMd);
    setPinned(note.pinnedAt === null ? '' : isoDay(note.pinnedAt));
  };

  const cancel = (): void => {
    setEditing(null);
    setTitle('');
    setBody('');
    setPinned('');
  };

  const save = (): void => {
    if (!title.trim() && !body.trim()) return;
    upsertNote.mutate(
      {
        noteId: editing && editing !== 'new' ? editing.id : null,
        title: title.trim(),
        bodyMd: body,
        pinnedAt: pinned === '' ? null : dayToEpoch(pinned),
      },
      { onSuccess: cancel },
    );
  };

  return (
    <Panel
      title="Research notes"
      meta={<span className={styles.meta}>Stored on this computer only</span>}
      actions={
        editing === null ? (
          <Button size="sm" variant="secondary" onClick={startNew}>
            New note
          </Button>
        ) : null
      }
    >
      <div className={styles.body}>
        {editing !== null ? (
          <form
            className={styles.editor}
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <label className={styles.label} htmlFor="note-title">
              Title
            </label>
            <Input
              id="note-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={`What you want to remember about ${symbol}`}
              maxLength={200}
              autoComplete="off"
            />

            <label className={styles.label} htmlFor="note-body">
              Note
            </label>
            <textarea
              id="note-body"
              className={styles.textarea}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              maxLength={20000}
              placeholder="Questions to look into, things to verify, what you concluded and why."
            />

            <label className={styles.label} htmlFor="note-pin">
              About a specific day (optional)
            </label>
            <Input
              id="note-pin"
              type="date"
              value={pinned}
              onChange={(event) => setPinned(event.target.value)}
              aria-describedby="note-pin-hint"
            />
            <p id="note-pin-hint" className={styles.hint}>
              Marks the note on the chart above, so a year from now the reason is next to the move
              it explains. Leave blank for a note about {symbol} generally.
            </p>

            <div className={styles.editorActions}>
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={(!title.trim() && !body.trim()) || upsertNote.isPending}
              >
                {upsertNote.isPending ? 'Saving…' : 'Save note'}
              </Button>
            </div>
          </form>
        ) : null}

        {isLoading ? <p className={styles.meta}>Loading notes…</p> : null}

        {!isLoading && (notes ?? []).length === 0 && editing === null ? (
          <EmptyState
            icon="research"
            title="No notes on this asset yet"
            description="Notes are for your own reasoning — what you want to check, what you concluded, and why. They stay on this computer."
            action={
              <Button variant="primary" size="sm" onClick={startNew}>
                Write the first one
              </Button>
            }
          />
        ) : null}

        {(notes ?? []).length > 0 ? (
          <ul className={styles.list} role="list">
            {(notes ?? []).map((note) => (
              <li key={note.id} className={styles.note}>
                <div className={styles.noteHeader}>
                  <span className={styles.noteTitle}>{note.title || 'Untitled note'}</span>
                  <span className={styles.noteActions}>
                    <IconButton
                      icon="research"
                      size={13}
                      label={`Edit note: ${note.title || 'Untitled note'}`}
                      onClick={() => startEdit(note)}
                    />
                    <IconButton
                      icon="trash"
                      size={13}
                      label={`Delete note: ${note.title || 'Untitled note'}`}
                      onClick={() => setPendingDelete(note)}
                    />
                  </span>
                </div>
                {/*
                  Rendered as plain text, not Markdown. A renderer would introduce an
                  HTML-injection surface for no benefit yet — see DEPENDENCIES.md.
                */}
                {note.bodyMd ? <p className={styles.noteBody}>{note.bodyMd}</p> : null}
                <span className={styles.noteMeta}>
                  edited <RelativeTime epochSeconds={note.updatedAt} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this note?"
        message={`"${pendingDelete?.title || 'Untitled note'}" will be removed from this computer. Undo is offered for a few seconds afterwards.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const removed = pendingDelete;
          setPendingDelete(null);
          if (!removed) return;

          // The note itself travels into the closure: restoring it needs the asset link and
          // the original timestamps, and the row is gone by the time Undo is pressed.
          deleteNote.mutate(removed.id, {
            onSuccess: () =>
              toast.info(`Deleted "${removed.title || 'Untitled note'}"`, {
                action: {
                  label: 'Undo',
                  onAction: () =>
                    restoreNote.mutate(removed, {
                      onError: () => toast.error('Could not put that note back'),
                    }),
                },
              }),
            onError: () => toast.error(`Could not delete "${removed.title || 'Untitled note'}"`),
          });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </Panel>
  );
}
