import { Link, useNavigate } from 'react-router-dom';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { glossaryEntry, learningPath, useProgress, useSetProgress } from './content';
import styles from './LessonView.module.css';

interface LessonViewProps {
  pathId: string;
  lessonId: string;
}

export function LessonView({ pathId, lessonId }: LessonViewProps) {
  const navigate = useNavigate();
  const path = learningPath(pathId);
  const lesson = path?.lessons.find((l) => l.id === lessonId);

  const { data: progress } = useProgress();
  const setProgress = useSetProgress();

  if (!path || !lesson) {
    return (
      <Panel title="Not found">
        <div className={styles.body}>
          <p>
            That lesson does not exist.{' '}
            <Link to="/learn" className={styles.link}>
              Back to Learn
            </Link>
            .
          </p>
        </div>
      </Panel>
    );
  }

  const isDone = (progress ?? []).find((p) => p.itemId === lesson.id)?.status === 'completed';

  const index = path.lessons.findIndex((l) => l.id === lesson.id);
  const next = path.lessons[index + 1];
  const previous = path.lessons[index - 1];

  const toggleRead = (): void => {
    setProgress.mutate({
      itemId: lesson.id,
      pathId: path.id,
      status: isDone ? 'not-started' : 'completed',
    });
  };

  return (
    <Panel
      title={lesson.title}
      meta={
        <Link to={`/learn/path/${path.id}`} className={styles.breadcrumb}>
          {path.title} · lesson {index + 1} of {path.lessons.length}
        </Link>
      }
      actions={
        <Button size="sm" variant={isDone ? 'secondary' : 'primary'} onClick={toggleRead}>
          {isDone ? 'Mark as unread' : 'Mark as read'}
        </Button>
      }
    >
      <article className={styles.body}>
        <p className={styles.summary}>{lesson.summary}</p>

        {lesson.body.map((paragraph, i) => (
          <p key={i} className={styles.paragraph}>
            {paragraph}
          </p>
        ))}

        {lesson.keyTerms.length > 0 ? (
          <nav className={styles.terms} aria-label="Terms used in this lesson">
            <span className={styles.termsLabel}>Terms used here</span>
            <ul className={styles.termList} role="list">
              {lesson.keyTerms.map((id) => {
                const entry = glossaryEntry(id);
                if (!entry) return null;
                return (
                  <li key={id}>
                    <Link to={`/learn/glossary/${id}`} className={styles.chip}>
                      {entry.term}
                      <Icon name="chevron-right" size={11} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        ) : null}

        <div className={styles.nav}>
          {previous ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void navigate(`/learn/path/${path.id}/${previous.id}`)}
            >
              ← {previous.title}
            </Button>
          ) : (
            <span />
          )}
          {next ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void navigate(`/learn/path/${path.id}/${next.id}`)}
            >
              {next.title} →
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void navigate(`/learn/path/${path.id}`)}
            >
              Back to {path.title}
            </Button>
          )}
        </div>
      </article>
    </Panel>
  );
}
