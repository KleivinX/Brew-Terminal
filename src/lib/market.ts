/**
 * Market, news and watchlist queries.
 *
 * These live in `lib/` rather than in the pulse slice because Research Lab needs them too, and
 * a feature slice may not import from another feature slice — the `local/no-cross-feature-import`
 * rule enforces that. Shared code moves down; it does not get imported sideways.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';
import { STALE_TIMES } from '@/lib/queryClient';
import type { AssetType, ChartRange, NewsCategory, Note, WatchlistItem } from '@/types/domain';

export const marketKeys = {
  list: (assetType: AssetType, region: string) => ['market-list', assetType, region] as const,
  quotes: (assetIds: string[]) => ['quotes', [...assetIds].sort()] as const,
  news: (category: NewsCategory | 'all') => ['news', category] as const,
  watchlists: ['watchlists'] as const,
  watchlistItems: (id: string) => ['watchlist-items', id] as const,
};

export function useMarketList(assetType: AssetType, region: string) {
  return useQuery({
    queryKey: marketKeys.list(assetType, region),
    queryFn: () => ipc('get_market_list', { assetType, region, limit: 50 }),
    staleTime: STALE_TIMES.quotes,
  });
}

/**
 * Batched by construction. There is no single-quote command in the IPC contract, so a
 * per-row fetch cannot be written by accident — see ARCHITECTURE.md §4.
 */
export function useQuotes(assetIds: string[]) {
  return useQuery({
    queryKey: marketKeys.quotes(assetIds),
    queryFn: () => ipc('get_quotes', { assetIds }),
    enabled: assetIds.length > 0,
    staleTime: STALE_TIMES.quotes,
  });
}

export function useNews(category: NewsCategory | 'all') {
  return useQuery({
    queryKey: marketKeys.news(category),
    queryFn: () => ipc('get_news', { filter: { category, assetId: null, limit: 20 } }),
    staleTime: STALE_TIMES.news,
  });
}

export function useWatchlists() {
  return useQuery({
    queryKey: marketKeys.watchlists,
    queryFn: () => ipc('list_watchlists'),
    staleTime: STALE_TIMES.watchlists,
  });
}

export function useWatchlistItems(watchlistId: string | undefined) {
  return useQuery({
    queryKey: marketKeys.watchlistItems(watchlistId ?? ''),
    queryFn: () => ipc('get_watchlist_items', { watchlistId: watchlistId as string }),
    enabled: Boolean(watchlistId),
    staleTime: STALE_TIMES.watchlists,
  });
}

export function useToggleWatchlistItem(watchlistId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ assetId, present }: { assetId: string; present: boolean }) => {
      if (!watchlistId) throw new Error('No watchlist selected.');
      if (present) {
        await ipc('remove_watchlist_item', { watchlistId, assetId });
      } else {
        await ipc('add_watchlist_item', { watchlistId, assetId });
      }
    },
    onSettled: () => {
      if (watchlistId) {
        void queryClient.invalidateQueries({ queryKey: marketKeys.watchlistItems(watchlistId) });
      }
    },
  });
}

/** Invalidates every query that depends on the set of watchlists or their contents. */
function invalidateWatchlists(queryClient: ReturnType<typeof useQueryClient>, id?: string): void {
  void queryClient.invalidateQueries({ queryKey: marketKeys.watchlists });
  if (id) {
    void queryClient.invalidateQueries({ queryKey: marketKeys.watchlistItems(id) });
  }
}

export function useCreateWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => ipc('create_watchlist', { name }),
    onSuccess: () => invalidateWatchlists(queryClient),
  });
}

export function useRenameWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ watchlistId, name }: { watchlistId: string; name: string }) =>
      ipc('rename_watchlist', { watchlistId, name }),
    onSuccess: () => invalidateWatchlists(queryClient),
  });
}

export function useDeleteWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (watchlistId: string) => ipc('delete_watchlist', { watchlistId }),
    onSuccess: (_result, watchlistId) => invalidateWatchlists(queryClient, watchlistId),
  });
}

/**
 * Reordering is optimistic: the row has to move on the same frame as the keypress, otherwise
 * holding the shortcut to shuffle an item up a long list feels broken. A failure rolls back.
 */
export function useReorderWatchlistItems(watchlistId: string | undefined) {
  const queryClient = useQueryClient();
  const key = marketKeys.watchlistItems(watchlistId ?? '');

  return useMutation({
    mutationFn: (assetIds: string[]) => {
      if (!watchlistId) throw new Error('No watchlist selected.');
      return ipc('reorder_watchlist_items', { watchlistId, assetIds });
    },

    onMutate: async (assetIds) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<WatchlistItem[]>(key);

      if (previous) {
        const byId = new Map(previous.map((item) => [item.assetId, item]));
        const reordered = assetIds
          .map((assetId, index) => {
            const item = byId.get(assetId);
            return item ? { ...item, position: index } : null;
          })
          .filter((item): item is WatchlistItem => item !== null);
        queryClient.setQueryData<WatchlistItem[]>(key, reordered);
      }

      return { previous };
    },

    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export const CHART_RANGES: readonly ChartRange[] = ['1D', '1W', '1M', '3M', '1Y', 'MAX'] as const;

export const CHART_RANGE_LABELS: Record<ChartRange, string> = {
  '1D': '1D',
  '1W': '1W',
  '1M': '1M',
  '3M': '3M',
  '1Y': '1Y',
  MAX: 'Max',
};

/** Spoken labels, so a range button does not read as two letters. */
export const CHART_RANGE_DESCRIPTIONS: Record<ChartRange, string> = {
  '1D': 'One day',
  '1W': 'One week',
  '1M': 'One month',
  '3M': 'Three months',
  '1Y': 'One year',
  MAX: 'Maximum available history',
};

export function useChart(assetId: string | undefined, range: ChartRange) {
  return useQuery({
    queryKey: ['chart', assetId, range],
    queryFn: () => ipc('get_chart', { assetId: assetId as string, range }),
    enabled: Boolean(assetId),
    // Intraday moves; historical daily closes do not.
    staleTime: range === '1D' ? STALE_TIMES.chartIntraday : STALE_TIMES.chartHistorical,
  });
}

/**
 * The ranges the provider for this asset can actually serve.
 *
 * The UI builds its range buttons from this, so a provider that caps history at a year
 * simply has no "Max" button — rather than one that fails when pressed.
 */
export function useSupportedRanges(assetType: AssetType | null): ChartRange[] {
  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: () => ipc('list_providers'),
    staleTime: 60_000,
  });

  if (!assetType) return [];

  const supporting = (providers ?? []).filter(
    (provider) =>
      provider.kind === 'market' &&
      provider.enabled &&
      provider.supportedAssetTypes.includes(assetType),
  );

  const available = new Set(supporting.flatMap((provider) => provider.supportedRanges));
  return CHART_RANGES.filter((range) => available.has(range));
}

export const noteKeys = {
  /** Every note, for the notes workspace. */
  all: ['notes', 'all'] as const,
  forAsset: (assetId: string) => ['notes', assetId] as const,
  search: (query: string) => ['notes', 'search', query] as const,
};

export function useAllNotes() {
  return useQuery({
    queryKey: noteKeys.all,
    queryFn: () => ipc('list_all_notes'),
    staleTime: Infinity,
  });
}

/**
 * Full-text search across every note.
 *
 * Disabled below two characters: a single letter matches most of a corpus, so the result is a
 * slower way of showing the list that is already on screen.
 */
export function useNoteSearch(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: noteKeys.search(trimmed),
    queryFn: () => ipc('search_notes', { query: trimmed, limit: 50 }),
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
}

export function useNotes(assetId: string | undefined) {
  return useQuery({
    queryKey: noteKeys.forAsset(assetId ?? ''),
    queryFn: () => ipc('list_notes', { assetId: assetId as string }),
    enabled: Boolean(assetId),
    staleTime: Infinity,
  });
}

export function useUpsertNote(assetId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      noteId,
      title,
      bodyMd,
    }: {
      noteId: string | null;
      title: string;
      bodyMd: string;
    }) => ipc('upsert_note', { noteId, assetId: assetId ?? null, title, bodyMd }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      if (assetId) {
        void queryClient.invalidateQueries({ queryKey: noteKeys.forAsset(assetId) });
      }
    },
  });
}

/**
 * Undo for a deleted note.
 *
 * Takes the note object the delete handler kept hold of, because the row is gone by the time
 * the Undo button exists. The backend restores the id, the timestamps and the asset link
 * verbatim — routing this through `upsert_note` instead would bring the note back with a fresh
 * created_at and, from the notes workspace, with no asset attached at all.
 */
export function useRestoreNote(assetId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (note: Note) => ipc('restore_note', { note }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      if (assetId) {
        void queryClient.invalidateQueries({ queryKey: noteKeys.forAsset(assetId) });
      }
    },
  });
}

export function useDeleteNote(assetId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => ipc('delete_note', { noteId }),
    onSuccess: () => {
      /*
       * Every notes query, not only this asset's. A note edited in the research panel also
       * appears in the notes workspace and in any open search result; invalidating one key
       * left the others showing a note that no longer exists.
       */
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      if (assetId) {
        void queryClient.invalidateQueries({ queryKey: noteKeys.forAsset(assetId) });
      }
    },
  });
}
