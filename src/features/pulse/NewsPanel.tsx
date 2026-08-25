import { useState } from 'react';
import { Panel } from '@/components/ui/Panel';
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
            description="Try a different category, or check back after the next refresh."
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
