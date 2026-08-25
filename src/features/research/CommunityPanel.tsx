import { useQuery } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { ProviderBadge } from '@/components/status/ProviderBadge';
import { EmptyState } from '@/components/status/EmptyState';
import { SkeletonRows } from '@/components/status/Skeleton';
import { StatusPill } from '@/components/status/StatusPill';
import { RelativeTime } from '@/components/status/RelativeTime';
import { ipc, IpcError } from '@/lib/ipc';
import { usePreferences, useSetPreference } from '@/lib/preferences';
import styles from './CommunityPanel.module.css';

/**
 * Community temperature.
 *
 * Off by default and opt-in, because it fetches other people's opinions from a third party.
 * The word "temperature" is doing careful work: this shows *what is being discussed*, never
 * what the discussion concludes. There is no sentiment score, no ranking, no "trending" —
 * ordering is by recency, and the numbers shown are the platform's own, labelled as such.
 *
 * Every post carries its source, its timestamp and an unverified label, because none of it has
 * been checked by anyone. See PRODUCT_SCOPE_V0_1.md §6 and UI_MAP.md.
 */
export function CommunityPanel() {
  const { data: preferences } = usePreferences();
  const setPreference = useSetPreference();
  const enabled = preferences?.communityEnabled ?? false;

  const { data, isLoading, error } = useQuery({
    queryKey: ['community', 20],
    queryFn: () => ipc('get_community_posts', { filter: { assetId: null, limit: 20 } }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const notConfigured = error instanceof IpcError && error.kind === 'not_configured';
  const posts = (data?.data ?? []).slice(0, 8);

  return (
    <Panel
      title="Community temperature"
      actions={<StatusPill state={enabled ? 'ready' : 'empty'} label="Unverified" />}
      meta={data ? <ProviderBadge meta={data.meta} /> : null}
    >
      <div className={styles.body}>
        {!enabled ? (
          <>
            <EmptyState
              icon="info"
              title="Community discussion is switched off"
              description="This shows what people are posting publicly about markets. It is other people's opinions, from a third party, and none of it has been checked by anyone — so it is off until you ask for it."
            />
            <Toggle
              label="Show community discussion"
              description="Turning this on lets Brew Terminal fetch public posts. Nothing is posted on your behalf and no account is involved."
              checked={false}
              onChange={() => setPreference.mutate({ key: 'communityEnabled', value: true })}
            />
          </>
        ) : null}

        {enabled && notConfigured ? (
          <EmptyState
            icon="info"
            title="No community source is set up"
            description="The feature is on, but no community provider is enabled. Only a fixture source ships with this version — no live discussion platform has been wired in."
          />
        ) : null}

        {enabled && isLoading ? <SkeletonRows rows={4} /> : null}

        {enabled && !notConfigured && !isLoading ? (
          <>
            <p className={styles.disclaimer}>
              Posts written by strangers on a public platform. Nothing here is verified, endorsed or
              checked by Brew Terminal, and the app does not rank, score or summarise it — the order
              is simply newest first, and the numbers are whatever the platform reports.
            </p>

            {posts.length === 0 ? (
              <EmptyState
                icon="info"
                title="Nothing to show"
                description="The source returned no posts."
              />
            ) : (
              <ul className={styles.list} role="list">
                {posts.map((post) => (
                  <li key={post.id} className={styles.post}>
                    <a
                      className={styles.title}
                      href={post.url}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {post.title}
                    </a>
                    <p className={styles.meta}>
                      <span className={styles.unverified}>Unverified</span>
                      {post.community ? <span>{post.community}</span> : null}
                      <span>{post.sourceName}</span>
                      {post.postedAt ? <RelativeTime epochSeconds={post.postedAt} /> : null}
                      {post.score !== null || post.commentCount !== null ? (
                        <span className={styles.counts}>
                          {post.score !== null ? `${post.score} points` : null}
                          {post.score !== null && post.commentCount !== null ? ' · ' : null}
                          {post.commentCount !== null ? `${post.commentCount} comments` : null}
                          {' as reported'}
                        </span>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className={styles.footer}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPreference.mutate({ key: 'communityEnabled', value: false })}
              >
                Switch community discussion off
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}
