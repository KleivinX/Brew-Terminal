import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel } from '@/components/ui/Panel';
import { SearchField } from '@/components/ui/SearchField';
import { EmptyState } from '@/components/status/EmptyState';
import { GLOSSARY_CATEGORY_LABELS, glossary, searchGlossary } from './content';
import type { GlossaryEntry } from './contentSchema';
import styles from './GlossaryIndex.module.css';

const CATEGORIES = ['all', 'markets', 'stocks', 'crypto', 'risk', 'mechanics'] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

export function GlossaryIndex() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  const results = useMemo(() => {
    // Searching a ~50-entry array per keystroke costs nothing measurable, and it happens
    // entirely in memory — the glossary works with the network switched off.
    const matched = searchGlossary(query);
    return category === 'all' ? matched : matched.filter((e) => e.category === category);
  }, [query, category]);

  const grouped = useMemo(() => {
    const map = new Map<GlossaryEntry['category'], GlossaryEntry[]>();
    for (const entry of results) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.term.localeCompare(b.term));
    }
    return map;
  }, [results]);

  return (
    <Panel
      title="Glossary"
      meta={<span className={styles.count}>{glossary.length} terms · works offline</span>}
      actions={
        <div className={styles.filters} role="group" aria-label="Filter by category">
          {CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
              className={[styles.filter, category === value ? styles.filterActive : null]
                .filter(Boolean)
                .join(' ')}
            >
              {value === 'all' ? 'All' : GLOSSARY_CATEGORY_LABELS[value]}
            </button>
          ))}
        </div>
      }
    >
      <div className={styles.body}>
        <SearchField
          label="Search the glossary"
          placeholder="Search terms — try “spread”, “staking”, “P/E”…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={styles.search}
        />

        {results.length === 0 ? (
          <EmptyState
            icon="search"
            title="No terms match that"
            description={`Nothing in the glossary matches “${query.trim()}”. Try a shorter word, or clear the category filter.`}
          />
        ) : null}

        {[...grouped.entries()].map(([cat, entries]) => (
          <section key={cat} className={styles.group} aria-labelledby={`group-${cat}`}>
            <h3 id={`group-${cat}`} className={styles.groupTitle}>
              {GLOSSARY_CATEGORY_LABELS[cat]}
            </h3>
            <ul className={styles.list} role="list">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Link to={`/learn/glossary/${entry.id}`} className={styles.item}>
                    <span className={styles.term}>{entry.term}</span>
                    <span className={styles.short}>{entry.short}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  );
}
