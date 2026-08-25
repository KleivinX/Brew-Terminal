import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Panel';
import { Icon } from '@/components/ui/Icon';
import { GlossaryIndex } from './GlossaryIndex';
import { GlossaryEntryView } from './GlossaryEntryView';
import { PathView } from './PathView';
import { LessonView } from './LessonView';
import { glossary, learningPaths, pathProgress, useProgress } from './content';
import styles from './LearnRoute.module.css';

function LearnHome() {
  const { data: progress } = useProgress();

  return (
    <div className={styles.stack}>
      <Panel title="Learning paths" meta={<span className={styles.meta}>Works offline</span>}>
        <ul className={styles.paths} role="list">
          {learningPaths.map((path) => {
            const { completed, total } = pathProgress(path, progress);
            return (
              <li key={path.id}>
                <Link to={`/learn/path/${path.id}`} className={styles.path}>
                  <span className={styles.pathText}>
                    <span className={styles.pathTitle}>{path.title}</span>
                    <span className={styles.pathDescription}>{path.description}</span>
                  </span>
                  <span className={styles.pathMeta}>
                    <span className={styles.pathProgress}>
                      {completed} / {total}
                    </span>
                    <Icon name="chevron-right" size={14} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="Glossary">
        <div className={styles.glossaryTeaser}>
          <p className={styles.teaserText}>
            {glossary.length} plain-language definitions of the words that turn up in market
            writing, from &ldquo;spread&rdquo; to &ldquo;survivorship bias&rdquo;. Everything is
            stored on this computer, so it works with the network switched off.
          </p>
          <Link to="/learn/glossary" className={styles.teaserLink}>
            Open the glossary
            <Icon name="chevron-right" size={13} />
          </Link>
        </div>
      </Panel>
    </div>
  );
}

function GlossaryEntryRoute() {
  const { termId } = useParams<{ termId: string }>();
  return <GlossaryEntryView termId={termId ?? ''} />;
}

function PathRoute() {
  const { pathId } = useParams<{ pathId: string }>();
  return <PathView pathId={pathId ?? ''} />;
}

function LessonRoute() {
  const { pathId, lessonId } = useParams<{ pathId: string; lessonId: string }>();
  return <LessonView pathId={pathId ?? ''} lessonId={lessonId ?? ''} />;
}

export function LearnRoute() {
  return (
    <>
      <WorkspaceHeader
        title="Learn"
        subtitle="Plain-language financial education, stored on this computer"
      />

      <div className={styles.body}>
        <Routes>
          <Route index element={<LearnHome />} />
          <Route path="glossary" element={<GlossaryIndex />} />
          <Route path="glossary/:termId" element={<GlossaryEntryRoute />} />
          <Route path="path/:pathId" element={<PathRoute />} />
          <Route path="path/:pathId/:lessonId" element={<LessonRoute />} />
          <Route path="*" element={<Navigate to="/learn" replace />} />
        </Routes>
      </div>
    </>
  );
}
