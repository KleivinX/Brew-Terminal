import { Link } from 'react-router-dom';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { GLOSSARY_CATEGORY_LABELS, glossaryEntry } from './content';
import { ExplainWithModel } from '@/components/ai/ExplainWithModel';
import styles from './GlossaryEntryView.module.css';

interface GlossaryEntryViewProps {
  termId: string;
}

export function GlossaryEntryView({ termId }: GlossaryEntryViewProps) {
  const entry = glossaryEntry(termId);

  if (!entry) {
    return (
      <Panel title="Not found">
        <div className={styles.body}>
          <p>
            There is no glossary entry called &ldquo;{termId}&rdquo;.{' '}
            <Link to="/learn/glossary" className={styles.link}>
              Back to the glossary
            </Link>
            .
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title={entry.term}
      meta={<span className={styles.category}>{GLOSSARY_CATEGORY_LABELS[entry.category]}</span>}
      actions={
        <ExplainWithModel
          kind="glossary-term"
          label={entry.term}
          text={`${entry.term}: ${entry.short}`}
        />
      }
    >
      <article className={styles.body}>
        <p className={styles.short}>{entry.short}</p>

        {entry.body.map((paragraph, index) => (
          <p key={index} className={styles.paragraph}>
            {paragraph}
          </p>
        ))}

        {entry.aliases.length > 0 ? (
          <p className={styles.aliases}>Also called: {entry.aliases.join(', ')}</p>
        ) : null}

        {entry.seeAlso.length > 0 ? (
          <nav className={styles.seeAlso} aria-label="Related terms">
            <span className={styles.seeAlsoLabel}>Related</span>
            <ul className={styles.seeAlsoList} role="list">
              {entry.seeAlso.map((id) => {
                const related = glossaryEntry(id);
                if (!related) return null;
                return (
                  <li key={id}>
                    <Link to={`/learn/glossary/${id}`} className={styles.chip}>
                      {related.term}
                      <Icon name="chevron-right" size={11} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.history.back()}
            aria-label="Go back"
          >
            Back
          </Button>
        </div>
      </article>
    </Panel>
  );
}
