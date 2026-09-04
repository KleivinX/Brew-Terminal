import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { ProviderBadge } from '@/components/status/ProviderBadge';
import { StatusPill } from '@/components/status/StatusPill';
import { StaleBanner } from '@/components/status/StaleBanner';
import { EmptyState } from '@/components/status/EmptyState';
import { ErrorState } from '@/components/status/ErrorState';
import { SkeletonRows } from '@/components/status/Skeleton';
import { derivePanelStatus } from '@/lib/freshness';
import { formatRelativeTime } from '@/lib/format';
import { useNews } from '@/lib/market';
import { useMarkNewsRead, useMarkNewsUnread, useReadNews } from '@/lib/newsRead';
import { IconButton } from '@/components/ui/IconButton';
import type { NewsCategory } from '@/types/domain';
import styles from './NewsPanel.module.css';

const FILTERS: readonly TabItem<NewsCategory | 'all'>[] = [
  { id: 'all', label: 'All' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'stocks', label: 'Stocks' },
  { id: 'macro', label: 'Macro' },
];

export function NewsPanel() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<NewsCategory | 'all'>('all');
  const { data, isLoading, error, refetch } = useNews(category);

  const articles = data?.data ?? [];
  const status = derivePanelStatus(data, {
    isLoading,
    isEmpty: articles.length === 0,
    error,
  });

  /*
   * Read state arrives as one bounded list and is intersected here rather than being joined
   * server-side. It keeps `get_news` a pure provider call — the envelope describes what the
   * feeds returned, and a local read flag mixed into that payload would blur what has
   * provenance and what does not.
   */
  const { data: readUrls } = useReadNews();
  const read = useMemo(() => new Set(readUrls ?? []), [readUrls]);

  const markRead = useMarkNewsRead();
  const markUnread = useMarkNewsUnread();

  const unread = articles.filter((article) => !read.has(article.url));

  return (
    <Panel
      title="Market news"
      meta={data ? <ProviderBadge meta={data.meta} /> : null}
      actions={
        <>
          <Tabs
            items={FILTERS}
            value={category}
            onChange={setCategory}
            label="News category"
            panelId={(id) => `newspanel-${id}`}
          />
          {unread.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => markRead.mutate(unread.map((article) => article.url))}
            >
              Mark {unread.length} read
            </Button>
          ) : null}
          <StatusPill state={status.state} label={status.label} detail={status.detail} />
        </>
      }
      scroll
      fill
    >
      <div role="tabpanel" id={`newspanel-${category}`} aria-labelledby={`tab-${category}`}>
        {status.showingFallbackData && data ? <StaleBanner meta={data.meta} /> : null}

        {status.state === 'loading' ? (
          <SkeletonRows rows={6} columns={2} label="Loading news" />
        ) : null}

        {/*
          Without a feed the panel says so and offers the way to fix it. v0.1.0 fell back to
          fixture headlines here, which meant a release could show invented reporting.
        */}
        {status.state === 'not-configured' ? (
          <EmptyState
            icon="settings"
            title="No news feeds set up yet"
            description={status.detail}
            action={
              <Button variant="primary" size="sm" onClick={() => void navigate('/settings/news')}>
                Open news feed settings
              </Button>
            }
          />
        ) : null}

        {status.state === 'error' && !status.showingFallbackData ? (
          <ErrorState
            title="News could not be loaded"
            detail={status.detail}
            onRetry={() => void refetch()}
          />
        ) : null}

        {status.state === 'empty' ? (
          <EmptyState
            icon="info"
            title="No stories in this filter"
            description="No feed you have enabled covers this section. Add one in Settings, or try a different category."
            action={
              <Button variant="secondary" size="sm" onClick={() => void navigate('/settings/news')}>
                Manage feeds
              </Button>
            }
          />
        ) : null}

        {articles.length > 0 ? (
          <ul className={styles.list} role="list">
            {articles.map((article) => (
              <li
                key={article.id}
                className={[styles.item, read.has(article.url) ? styles.read : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                {/*
                External links open in the OS browser via the Rust opener, never in the app
                webview — no third-party origin executes inside Brew Terminal.
                See THREAT_MODEL.md §3.
              */}
                <div className={styles.row}>
                  <a
                    className={styles.link}
                    href={article.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    // Opening a story is the ordinary way of reading it, so it counts. The
                    // alternative — only the explicit toggle marks read — means the list never
                    // thins out on its own, which is the whole point of tracking this.
                    onClick={() => markRead.mutate([article.url])}
                  >
                    {article.title}
                  </a>

                  <IconButton
                    icon={read.has(article.url) ? 'refresh' : 'check'}
                    label={
                      read.has(article.url)
                        ? `Mark “${article.title}” unread`
                        : `Mark “${article.title}” read`
                    }
                    size={14}
                    className={styles.toggle}
                    onClick={() =>
                      read.has(article.url)
                        ? markUnread.mutate(article.url)
                        : markRead.mutate([article.url])
                    }
                  />
                </div>
                <div className={styles.meta}>
                  <span className={styles.source}>{article.sourceName}</span>
                  <span aria-hidden="true">·</span>
                  <span className={styles.category}>{article.category}</span>
                  {article.publishedAt ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <time dateTime={new Date(article.publishedAt * 1000).toISOString()}>
                        {formatRelativeTime(article.publishedAt)}
                      </time>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}
