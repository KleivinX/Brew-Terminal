import { Link } from 'react-router-dom';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useState } from 'react';
import {
  glossaryEntry,
  learningPath,
  pathProgress,
  useProgress,
  useResetProgress,
} from './content';
import styles from './PathView.module.css';

export function PathView({ pathId }: { pathId: string }) {
  const path = learningPath(pathId);
  const { data: progress } = useProgress();
  const resetProgress = useResetProgress();
  const [confirmReset, setConfirmReset] = useState(false);

  if (!path) {
    return (
      <Panel title="Not found">
        <div className={styles.body}>
          <p>
            There is no learning path called &ldquo;{pathId}&rdquo;.{' '}
            <Link to="/learn" className={styles.link}>
              Back to Learn
            </Link>
            .
          </p>
        </div>
      </Panel>
    );
  }

  const completed = new Set(
    (progress ?? []).filter((p) => p.status === 'completed').map((p) => p.itemId),
  );
  const { completed: done, total } = pathProgress(path, progress);

  return (
    <Panel
      title={path.title}
      meta={
        <span className={styles.progress}>
          {done} of {total} read
        </span>
      }
      actions={
        done > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}>
            Reset this path
          </Button>
        ) : null
      }
    >
      <div className={styles.body}>
        <p className={styles.description}>{path.description}</p>

        <ol className={styles.lessons}>
          {path.lessons.map((lesson, index) => {
            const isDone = completed.has(lesson.id);
            return (
              <li key={lesson.id}>
                <Link to={`/learn/path/${path.id}/${lesson.id}`} className={styles.lesson}>
                  <span
                    className={[styles.marker, isDone ? styles.markerDone : null]
                      .filter(Boolean)
                      .join(' ')}
                    aria-hidden="true"
                  >
                    {isDone ? <Icon name="check" size={13} /> : index + 1}
                  </span>
                  <span className={styles.lessonText}>
                    <span className={styles.lessonTitle}>
                      {lesson.title}
                      {isDone ? <span className="visually-hidden"> (read)</span> : null}
                    </span>
                    <span className={styles.lessonSummary}>{lesson.summary}</span>
                    {lesson.keyTerms.length > 0 ? (
                      <span className={styles.terms}>
                        {lesson.keyTerms
                          .map((id) => glossaryEntry(id)?.term)
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </span>
                  <Icon name="chevron-right" size={14} className={styles.chevron} />
                </Link>
              </li>
            );
          })}
        </ol>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset progress for this path?"
        message={`This clears which lessons in "${path.title}" are marked as read. The content itself is unaffected.`}
        confirmLabel="Reset"
        onConfirm={() => {
          resetProgress.mutate(path.id);
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </Panel>
  );
}
