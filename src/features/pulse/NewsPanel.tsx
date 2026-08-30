import { useState } from 'react';
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
              <li key={article.id} className={styles.item}>
                {/*
                External links open in the OS browser via the Rust opener, never in the app
                webview — no third-party origin executes inside Brew Terminal.
                See THREAT_MODEL.md §3.
              */}
                <a
                  className={styles.link}
                  href={article.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {article.title}
                </a>
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
