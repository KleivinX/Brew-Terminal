/**
 * Subsequence matcher for the command palette and asset search.
 *
 * ~40 lines instead of a dependency — see DEPENDENCIES.md. The registry is small and this runs
 * on every keystroke, so keeping it allocation-light matters more than sophistication.
 *
 * Returns 0 for no match, otherwise a score in (0, 1]. The score ranks candidates; it is never
 * shown to the user, and never presented as a judgement about an asset.
 */
export function scoreMatch(query: string, target: string): number {
  if (!query) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact and prefix matches short-circuit — "BTC" should beat a scattered subsequence.
  if (t === q) return 1;
  if (t.startsWith(q)) return 0.95 - Math.min(0.15, (t.length - q.length) * 0.005);

  const wordStart = t.indexOf(` ${q}`);
  if (wordStart >= 0) return 0.85;

  const contains = t.indexOf(q);
  if (contains >= 0) return 0.7 - Math.min(0.2, contains * 0.01);

  // Subsequence: every query character in order, rewarding adjacency.
  let ti = 0;
  let matched = 0;
  let streak = 0;
  let bestStreak = 0;

  for (let qi = 0; qi < q.length; qi += 1) {
    const char = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === char) {
        found = ti;
        ti += 1;
        break;
      }
      ti += 1;
    }
    if (found === -1) return 0;

    matched += 1;
    if (found > 0 && qi > 0 && found === ti - 1) {
      streak += 1;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
    }
  }

  if (matched < q.length) return 0;

  const coverage = q.length / t.length;
  return Math.min(0.6, 0.25 + coverage * 0.2 + bestStreak * 0.03);
}

export interface Scored<T> {
  item: T;
  score: number;
}

export function rank<T>(query: string, items: T[], keys: (item: T) => string[]): Scored<T>[] {
  if (!query.trim()) return items.map((item) => ({ item, score: 1 }));

  const out: Scored<T>[] = [];
  for (const item of items) {
    let best = 0;
    for (const key of keys(item)) {
      const score = scoreMatch(query, key);
      if (score > best) best = score;
    }
    if (best > 0) out.push({ item, score: best });
  }
  return out.sort((a, b) => b.score - a.score);
}
