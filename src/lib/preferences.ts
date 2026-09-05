import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ipc, setPreference } from './ipc';
import { STALE_TIMES } from './queryClient';
import type { Preferences } from '@/types/domain';

export const preferencesKey = ['preferences'] as const;

/**
 * A discriminated union over every preference key, so `{ key: 'theme', value: 'dark' }` type
 * checks and `{ key: 'theme', value: 42 }` does not. A plain generic on the mutation function
 * does not survive TanStack's inference, which is why this is a mapped union instead.
 */
export type PreferenceUpdate = {
  [K in keyof Preferences]: { key: K; value: Preferences[K] };
}[keyof Preferences];

export function usePreferences() {
  return useQuery({
    queryKey: preferencesKey,
    queryFn: () => ipc('get_preferences'),
    staleTime: STALE_TIMES.preferences,
  });
}

interface RollbackContext {
  previous: Preferences | undefined;
}

/**
 * Optimistic by design: the theme must flip on the same frame as the click, not after a
 * round trip to SQLite. On failure we roll back and the UI reverts visibly.
 */
export function useSetPreference() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, PreferenceUpdate, RollbackContext>({
    mutationFn: ({ key, value }) => setPreference(key, value),

    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: preferencesKey });
      const previous = queryClient.getQueryData<Preferences>(preferencesKey);
      if (previous) {
        queryClient.setQueryData<Preferences>(preferencesKey, { ...previous, [key]: value });
      }
      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(preferencesKey, context.previous);
      }
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: preferencesKey });
    },
  });
}

/**
 * Whether the navigation rail shows labels, and a way to flip it.
 *
 * Backed by the stored preference rather than by session state. There used to be two things
 * called `navRailExpanded` — one in the preferences the Settings toggle wrote to, and one in
 * `uiStore` that the rail actually rendered from — and nothing connected them. The result was a
 * Settings switch that persisted `true` and changed nothing, and a command-palette toggle that
 * worked until the next launch.
 *
 * The optimistic update in `useSetPreference` is what makes one source enough: the flip lands on
 * the same frame as the click, which is the only thing the split was buying.
 */
export function useNavRail(): { expanded: boolean; toggle: () => void } {
  const { data: preferences } = usePreferences();
  const setPreference = useSetPreference();
  const expanded = preferences?.navRailExpanded ?? false;

  return {
    expanded,
    toggle: () => setPreference.mutate({ key: 'navRailExpanded', value: !expanded }),
  };
}
