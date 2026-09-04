import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc } from '@/lib/ipc';

/**
 * Which headlines have been read.
 *
 * Kept out of `get_news` on purpose. That call returns an envelope describing what the feeds
 * returned, with a provider and an age on it; a local read flag mixed into the same payload
 * would blur the line between what has provenance and what is just this machine's memory. So
 * the read set arrives separately and the panel intersects the two.
 *
 * The set is bounded in SQLite (5,000 marks, pruned by recency), so fetching it whole is cheap
 * and one cached call beats a round trip per panel refresh.
 */

const readNewsKey = ['news-read'] as const;

export function useReadNews() {
  return useQuery({
    queryKey: readNewsKey,
    queryFn: () => ipc('list_read_news'),
    // Read state changes only when this app changes it, so there is nothing to poll for.
    staleTime: Infinity,
  });
}

/**
 * Optimistic on both sides.
 *
 * Marking read is a side effect of an action the user has already taken — clicking a headline,
 * or pressing the toggle — and a row that stays bold for a round trip after being clicked reads
 * as a control that did not work.
 */
export function useMarkNewsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (urls: string[]) => ipc('mark_news_read', { urls }),
    onMutate: async (urls) => {
      await queryClient.cancelQueries({ queryKey: readNewsKey });
      const previous = queryClient.getQueryData<string[]>(readNewsKey);
      queryClient.setQueryData<string[]>(readNewsKey, (current) => [
        ...urls.filter((url) => !(current ?? []).includes(url)),
        ...(current ?? []),
      ]);
      return { previous };
    },
    onError: (_error, _urls, context) => {
      if (context?.previous) queryClient.setQueryData(readNewsKey, context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: readNewsKey }),
  });
}

export function useMarkNewsUnread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (url: string) => ipc('mark_news_unread', { url }),
    onMutate: async (url) => {
      await queryClient.cancelQueries({ queryKey: readNewsKey });
      const previous = queryClient.getQueryData<string[]>(readNewsKey);
      queryClient.setQueryData<string[]>(readNewsKey, (current) =>
        (current ?? []).filter((stored) => stored !== url),
      );
      return { previous };
    },
    onError: (_error, _url, context) => {
      if (context?.previous) queryClient.setQueryData(readNewsKey, context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: readNewsKey }),
  });
}
