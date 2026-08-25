import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import glossaryJson from '@content/learn/glossary.json';
import pathsJson from '@content/learn/paths.json';
import { rank } from '@/lib/fuzzy';
import { ipc } from '@/lib/ipc';
import type { ProgressStatus } from '@/types/domain';
import { validateContent, type GlossaryEntry, type LearningPath } from './contentSchema';

/**
 * The Learn content bundle.
 *
 * Loaded from local JSON with no network involved at any point, which is what makes Learn work
 * offline. Validated once at module load: content is validated in CI and in tests too, so a
 * failure here means something got past both, and failing loudly beats rendering blank pages.
 */
const validated = validateContent({ glossary: glossaryJson, paths: pathsJson });

if (!validated.content) {
  const summary = validated.issues.map((i) => `${i.where}: ${i.problem}`).join('\n');
  throw new Error(`Learn content failed validation:\n${summary}`);
}

export const glossary: GlossaryEntry[] = validated.content.glossary;
export const learningPaths: LearningPath[] = validated.content.paths;

const byId = new Map(glossary.map((entry) => [entry.id, entry]));

export function glossaryEntry(id: string): GlossaryEntry | undefined {
  return byId.get(id);
}

export function learningPath(id: string): LearningPath | undefined {
  return learningPaths.find((path) => path.id === id);
}

export const GLOSSARY_CATEGORY_LABELS: Record<GlossaryEntry['category'], string> = {
  markets: 'Markets',
  stocks: 'Stocks and funds',
  crypto: 'Crypto',
  risk: 'Risk',
  mechanics: 'Mechanics',
};

/**
 * Searches the glossary in memory.
 *
 * The bundle is ~50 entries, so a linear pass per keystroke is imperceptible and an index
 * would be machinery for nothing — see ARCHITECTURE.md §8. Aliases are matched too, so
 * "shares" finds "Stock" and "APY" finds "Yield".
 */
export function searchGlossary(query: string, limit = 40): GlossaryEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return glossary;

  return rank(trimmed, glossary, (entry) => [entry.term, ...entry.aliases, entry.short])
    .slice(0, limit)
    .map(({ item }) => item);
}

// --- progress ---

export const progressKey = ['learning-progress'] as const;

export function useProgress() {
  return useQuery({
    queryKey: progressKey,
    queryFn: () => ipc('list_progress'),
    staleTime: Infinity,
  });
}

export function useSetProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { itemId: string; pathId: string; status: ProgressStatus }) =>
      ipc('set_progress', vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: progressKey });
    },
  });
}

export function useResetProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pathId: string | null) => ipc('reset_progress', { pathId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: progressKey });
    },
  });
}

export interface PathProgress {
  completed: number;
  total: number;
}

export function pathProgress(
  path: LearningPath,
  progress: { itemId: string; status: ProgressStatus }[] | undefined,
): PathProgress {
  const done = new Set(
    (progress ?? []).filter((p) => p.status === 'completed').map((p) => p.itemId),
  );
  return {
    completed: path.lessons.filter((lesson) => done.has(lesson.id)).length,
    total: path.lessons.length,
  };
}
