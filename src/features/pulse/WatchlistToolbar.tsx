import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  useCreateWatchlist,
  useDeleteWatchlist,
  useRenameWatchlist,
  useWatchlists,
} from '@/lib/market';
import type { Watchlist } from '@/types/domain';
import styles from './WatchlistToolbar.module.css';

interface WatchlistToolbarProps {
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  itemCount: number;
}

export function WatchlistToolbar({ selectedId, onSelect, itemCount }: WatchlistToolbarProps) {
  const { data: watchlists } = useWatchlists();
  const createWatchlist = useCreateWatchlist();
  const renameWatchlist = useRenameWatchlist();
  const deleteWatchlist = useDeleteWatchlist();

  const [dialog, setDialog] = useState<'none' | 'create' | 'rename'>('none');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftName, setDraftName] = useState('');

  const selected: Watchlist | undefined =
    watchlists?.find((list) => list.id === selectedId) ?? watchlists?.[0];

  const openCreate = (): void => {
    setDraftName('');
    setDialog('create');
  };

  const openRename = (): void => {
    setDraftName(selected?.name ?? '');
    setDialog('rename');
  };

  const submit = (): void => {
    const name = draftName.trim();
    if (!name) return;

    if (dialog === 'create') {
      createWatchlist.mutate(name, {
        onSuccess: (created) => onSelect(created.id),
      });
    } else if (dialog === 'rename' && selected) {
      renameWatchlist.mutate({ watchlistId: selected.id, name });
    }
    setDialog('none');
  };

  const remove = (): void => {
    if (!selected) return;
    deleteWatchlist.mutate(selected.id, {
      onSuccess: () => {
        const fallback = watchlists?.find((list) => list.id !== selected.id);
        if (fallback) onSelect(fallback.id);
      },
    });
    setConfirmDelete(false);
  };

  return (
    <div className={styles.toolbar}>
      <label className="visually-hidden" htmlFor="watchlist-select">
        Active watchlist
      </label>
      <select
        id="watchlist-select"
        className={styles.select}
        value={selected?.id ?? ''}
        onChange={(event) => onSelect(event.target.value)}
      >
        {(watchlists ?? []).map((list) => (
          <option key={list.id} value={list.id}>
            {list.name}
          </option>
        ))}
      </select>

      <span className={styles.count}>
        {itemCount} {itemCount === 1 ? 'asset' : 'assets'}
      </span>

      <IconButton icon="plus" label="New watchlist" size={14} onClick={openCreate} />
      <IconButton
        icon="research"
        label="Rename watchlist"
        size={14}
        onClick={openRename}
        disabled={!selected}
      />
      <IconButton
        icon="trash"
        label="Delete watchlist"
        size={14}
        onClick={() => setConfirmDelete(true)}
        // The default list is the guaranteed landing place for a first asset, so it stays.
        disabled={!selected || selected.isDefault}
        title={selected?.isDefault ? 'The default watchlist cannot be deleted' : 'Delete watchlist'}
      />

      <Modal
        open={dialog !== 'none'}
        onClose={() => setDialog('none')}
        title={dialog === 'create' ? 'New watchlist' : 'Rename watchlist'}
        size="sm"
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className={styles.label} htmlFor="watchlist-name">
            Name
          </label>
          <Input
            id="watchlist-name"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Crypto majors"
            maxLength={64}
            autoComplete="off"
          />
          <div className={styles.formActions}>
            <Button variant="ghost" onClick={() => setDialog('none')}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={!draftName.trim()}>
              {dialog === 'create' ? 'Create' : 'Rename'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this watchlist?"
        message={`"${selected?.name ?? ''}" and its assets will be removed from this computer. Your notes and the assets themselves are not affected.`}
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
