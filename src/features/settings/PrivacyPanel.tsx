import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { RelativeTime } from '@/components/status/RelativeTime';
import { EmptyState } from '@/components/status/EmptyState';
import { ipc } from '@/lib/ipc';
import { formatCompact } from '@/lib/format';
import styles from './PrivacyPanel.module.css';

/** `included_context` is stored as a JSON array of `{kind, label}` — never the text itself. */
interface LoggedContext {
  kind: string;
  label?: string;
}

function describeContext(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return 'Nothing attached';
    return (parsed as LoggedContext[])
      .map((item) => (item.label ? `${item.kind}: ${item.label}` : item.kind))
      .join(', ');
  } catch {
    return 'Unreadable';
  }
}

/**
 * Plain-language privacy. The claims here must stay literally true — in particular, the
 * database is NOT encrypted at rest in v0.1, and this page says so rather than implying
 * protection that does not exist. See THREAT_MODEL.md §5.
 */
export function PrivacyPanel() {
  const { data: appInfo } = useQuery({
    queryKey: ['app-info'],
    queryFn: () => ipc('get_app_info'),
    staleTime: Infinity,
  });

  const { data: cacheStats } = useQuery({
    queryKey: ['cache-stats'],
    queryFn: () => ipc('get_cache_stats'),
    staleTime: 30_000,
  });

  const queryClient = useQueryClient();
  const [confirmClearLog, setConfirmClearLog] = useState(false);

  const { data: outbound } = useQuery({
    queryKey: ['ai-outbound-log'],
    queryFn: () => ipc('list_ai_outbound_log'),
    staleTime: 10_000,
  });

  const clearLog = useMutation({
    mutationFn: () => ipc('clear_ai_outbound_log'),
    onSuccess: () => {
      setConfirmClearLog(false);
      void queryClient.invalidateQueries({ queryKey: ['ai-outbound-log'] });
    },
  });

  return (
    <div className={styles.stack}>
      <Panel title="Where your data lives">
        <div className={styles.prose}>
          <p>
            Brew Terminal has no account, no server and no telemetry. Watchlists, preferences, notes
            and learning progress are stored in a SQLite database on this computer, and nothing is
            sent anywhere unless you ask for it.
          </p>
          <dl className={styles.paths}>
            <dt>Data folder</dt>
            <dd className="tabular">{appInfo?.dataDir ?? '—'}</dd>
            <dt>Database</dt>
            <dd className="tabular">{appInfo?.dbPath ?? '—'}</dd>
            <dt>Schema version</dt>
            <dd className="tabular">{appInfo?.schemaVersion ?? '—'}</dd>
          </dl>
        </div>
      </Panel>

      <Panel title="What is not protected">
        <div className={styles.prose}>
          <p>
            The database is <strong>not encrypted</strong>. Without a login or a launch password,
            any key the app could use to decrypt it unattended would also be reachable by anything
            else running as you — so encrypting it would look like protection without being
            protection.
          </p>
          <p>
            API keys are handled differently: they are never stored in the database. They go into
            your operating system&rsquo;s credential store, and the app only ever shows a masked
            version after you save one.
          </p>
        </div>
      </Panel>

      <Panel
        title="What has been sent to a model"
        actions={
          (outbound ?? []).length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirmClearLog(true)}>
              Clear log
            </Button>
          ) : null
        }
      >
        {(outbound ?? []).length === 0 ? (
          <EmptyState
            icon="desk"
            title="Nothing has been sent"
            description="The Model Desk records every request it makes here — when, to which endpoint, how large, and what was attached. It has not made any."
          />
        ) : (
          <>
            <ul className={styles.log} role="list">
              {(outbound ?? []).map((entry) => (
                <li key={entry.id} className={styles.logRow}>
                  <div className={styles.logMain}>
                    <span className={styles.logProvider}>{entry.providerId}</span>
                    <span className={styles.logContext}>
                      {describeContext(entry.includedContext)}
                    </span>
                  </div>
                  <div className={styles.logMeta}>
                    <span className="tabular">
                      {entry.charCount === 0 ? 'connection check' : `${entry.charCount} chars`}
                    </span>
                    <RelativeTime epochSeconds={entry.createdAt} />
                  </div>
                </li>
              ))}
            </ul>
            <p className={styles.cacheNote}>
              This records what was <em>attempted</em>, written before each request goes out. A
              request that never connected still appears — for a record of what left this computer,
              over-reporting is the safer direction to be wrong in.
            </p>
            <p className={styles.cacheNote}>
              It never contains your prompts or the text you attached, only that a send happened and
              how big it was. Deleting a conversation on the Model Desk does not remove these rows;
              clearing them is this separate action.
            </p>
          </>
        )}
      </Panel>

      <Panel title="Cached provider data">
        <div className={styles.cards}>
          <Card label="Cached entries" value={cacheStats?.entryCount ?? 0} />
          <Card
            label="Cache size"
            value={formatCompact(cacheStats?.totalBytes ?? 0)}
            hint="bytes"
          />
        </div>
        <p className={styles.cacheNote}>
          Cached market and news results speed up startup and keep the app usable offline. Cache
          controls arrive with the live providers in Phase 2.
        </p>
      </Panel>
      <ConfirmDialog
        open={confirmClearLog}
        title="Clear the send log?"
        message="The record of what the Model Desk has sent is deleted from this computer. Your conversations are not affected."
        confirmLabel="Clear log"
        destructive
        onConfirm={() => clearLog.mutate()}
        onCancel={() => setConfirmClearLog(false)}
      />
    </div>
  );
}
