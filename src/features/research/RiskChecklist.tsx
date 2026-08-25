import checklist from '@content/learn/risk-checklist.json';
import { Panel } from '@/components/ui/Panel';
import { Icon } from '@/components/ui/Icon';
import styles from './RiskChecklist.module.css';

interface ChecklistItem {
  id: string;
  question: string;
  why: string;
}

interface Checklist {
  title: string;
  intro: string;
  items: ChecklistItem[];
  closing: string;
}

/**
 * Neutral prompts for a crypto asset.
 *
 * Deliberately **not** a scored checklist. There are no checkboxes whose state adds up to
 * anything, no rating, and no conclusion — a total would be a verdict on an asset's
 * legitimacy, which is precisely what PRODUCT_SCOPE_V0_1.md §3 rules out. The content lives
 * in `content/learn/risk-checklist.json` so it can be reviewed as prose rather than buried in
 * a component.
 */
export function RiskChecklist() {
  const content = checklist as Checklist;

  return (
    <Panel title={content.title}>
      <div className={styles.body}>
        <p className={styles.intro}>{content.intro}</p>

        <ul className={styles.list} role="list">
          {content.items.map((item) => (
            <li key={item.id} className={styles.item}>
              <span className={styles.marker} aria-hidden="true">
                <Icon name="info" size={13} />
              </span>
              <div className={styles.itemText}>
                <p className={styles.question}>{item.question}</p>
                <p className={styles.why}>{item.why}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className={styles.closing}>{content.closing}</p>
      </div>
    </Panel>
  );
}
