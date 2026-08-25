import { Panel } from '@/components/ui/Panel';
import { ProviderBadge } from '@/components/status/ProviderBadge';
import { EmptyState } from '@/components/status/EmptyState';
import { SkeletonRows } from '@/components/status/Skeleton';
import { formatRelativeTime } from '@/lib/format';
import { useNews } from '@/lib/market';
import type { AssetType } from '@/types/domain';
import styles from './ContextPanel.module.css';

interface ContextPanelProps {
  assetType: AssetType;
  symbol: string;
}

/**
 * Stories published in the same period as the price movement above.
 *
 * The brief calls this section "What moved this?". That question is exactly what this panel
 * refuses to answer, and the heading says so: the app has no basis for attributing a price
 * change to a story, and a panel that implies otherwise would be the single most misleading
 * thing on the screen. What it can honestly offer is adjacency in time, clearly labelled.
 *
 * Only `provider_tagged` links may ever be described as being *about* an asset — see the
 * `link_kind` column in DATA_MODEL.md §2.6. Nothing here is provider-tagged, so nothing here
 * claims to be about this asset at all.
 */
export function ContextPanel({ assetType, symbol }: ContextPanelProps) {
  const category = assetType === 'crypto' ? 'crypto' : 'stocks';
  const { data, isLoading } = useNews(category);

  const articles = (data?.data ?? []).slice(0, 5);

  return (
    <Panel
      title="Published around this time"
      meta={data ? <ProviderBadge meta={data.meta} /> : null}
    >
      <div className={styles.body}>
        <p className={styles.disclaimer}>
          These are {category} stories from the same period as the prices above. They are{' '}
          <strong>not</strong> an explanation of why {symbol} moved — Brew Terminal has no way to
          establish that, and neither does the presence of a headline. Two things happening near
          each other in time is not one causing the other.
        </p>

        {isLoading ? <SkeletonRows rows={3} columns={2} label="Loading related stories" /> : null}

        {!isLoading && articles.length === 0 ? (
          <EmptyState
            icon="info"
            title="No stories from this period"
            description="Nothing came back for this category. That says nothing about the asset either way."
          />
        ) : null}

        {articles.length > 0 ? (
          <ul className={styles.list} role="list">
            {articles.map((article) => (
              <li key={article.id} className={styles.item}>
                <a
                  className={styles.link}
                  href={article.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {article.title}
                </a>
                <span className={styles.meta}>
                  {article.sourceName}
                  {article.publishedAt ? (
                    <>
                      {' · '}
                      <time dateTime={new Date(article.publishedAt * 1000).toISOString()}>
                        {formatRelativeTime(article.publishedAt)}
                      </time>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}
