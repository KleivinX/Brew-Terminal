import { useState } from 'react';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconButton } from '@/components/ui/IconButton';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/status/EmptyState';
import { RelativeTime } from '@/components/status/RelativeTime';
import { useDeleteNote, useNotes, useUpsertNote } from '@/lib/market';
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

  const [editing, setEditing] = useState<Note | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);

  const startNew = (): void => {
    setEditing('new');
    setTitle('');
    setBody('');
  };

  const startEdit = (note: Note): void => {
    setEditing(note);
    setTitle(note.title);
    setBody(note.bodyMd);
  };

  const cancel = (): void => {
    setEditing(null);
    setTitle('');
    setBody('');
  };

  const save = (): void => {
    if (!title.trim() && !body.trim()) return;
    upsertNote.mutate(
      {
        noteId: editing && editing !== 'new' ? editing.id : null,
        title: title.trim(),
        bodyMd: body,
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
        message={`"${pendingDelete?.title || 'Untitled note'}" will be removed from this computer. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDelete) deleteNote.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </Panel>
  );
}
