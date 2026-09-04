import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { RelativeTime } from '@/components/status/RelativeTime';
import { ipc } from '@/lib/ipc';
import type { FeedCandidate, FeedPreview, NewsCategory, NewsFeed } from '@/types/domain';
import styles from './NewsFeedsPanel.module.css';

const CATEGORIES: Array<{ value: NewsCategory; label: string }> = [
  { value: 'crypto', label: 'Crypto' },
  { value: 'stocks', label: 'Stocks' },
  { value: 'macro', label: 'Macro' },
  { value: 'other', label: 'Other' },
];

const CATEGORY_LABEL: Record<NewsCategory, string> = {
  crypto: 'Crypto',
  stocks: 'Stocks',
  macro: 'Macro',
  other: 'Other',
};

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'That could not be done.';
}

export function NewsFeedsPanel() {
  const queryClient = useQueryClient();

  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<NewsCategory>('crypto');
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  /*
   * Discovery is a separate step in front of the manual form rather than a replacement for it.
   * What it produces is a candidate the user still confirms — they pick the category and the
   * name, and the address they are about to save stays visible. Adding a feed straight from a
   * search result would be the one flow here that saves something the user never read.
   */
  const [site, setSite] = useState('');
  const [candidates, setCandidates] = useState<FeedCandidate[] | null>(null);
  const [siteError, setSiteError] = useState<string | null>(null);

  const { data: feeds } = useQuery({
    queryKey: ['news-feeds'],
    queryFn: () => ipc('list_news_feeds'),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['news-feeds'] });
    // The feed list decides what the news panel can show.
    void queryClient.invalidateQueries({ queryKey: ['news'] });
  };

  const resetForm = (): void => {
    setUrl('');
    setTitle('');
    setPreview(null);
    setFormError(null);
  };

  const discover = useMutation({
    mutationFn: (input: string) => ipc('discover_feeds', { input }),
    onSuccess: (found) => {
      setCandidates(found);
      setSiteError(null);
    },
    onError: (error) => {
      setCandidates(null);
      setSiteError(errorMessage(error));
    },
  });

  /** Moves a chosen candidate into the add form below, where it is confirmed. */
  const chooseCandidate = (candidate: FeedCandidate): void => {
    setUrl(candidate.url);
    setTitle(candidate.title ?? '');
    setPreview({
      title: candidate.title,
      itemCount: candidate.itemCount,
      newestTitle: candidate.newestTitle,
    });
    setFormError(null);
    document.getElementById('feed-url')?.scrollIntoView({ block: 'center' });
  };

  const check = useMutation({
    mutationFn: (feedUrl: string) => ipc('preview_news_feed', { url: feedUrl }),
    onSuccess: (result) => {
      setPreview(result);
      setFormError(null);
      // Offer the publisher's own name rather than making the user invent one.
      if (!title.trim() && result.title) setTitle(result.title);
    },
    onError: (error) => {
      setPreview(null);
      setFormError(errorMessage(error));
    },
  });

  const add = useMutation({
    mutationFn: () => ipc('add_news_feed', { url: url.trim(), title: title.trim(), category }),
    onSuccess: () => {
      resetForm();
      refresh();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (feedId: string) => ipc('remove_news_feed', { feedId }),
    onSuccess: refresh,
  });

  const setEnabled = useMutation({
    mutationFn: ({ feedId, enabled }: { feedId: string; enabled: boolean }) =>
      ipc('set_news_feed_enabled', { feedId, enabled }),
    onSuccess: refresh,
  });

  const restore = useMutation({
    mutationFn: () => ipc('restore_default_news_feeds'),
    onSuccess: refresh,
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setFormError(null);
    add.mutate();
  };

  const rows: NewsFeed[] = feeds ?? [];
  const missingDefaults = rows.filter((f) => f.isDefault).length < 5;

  return (
    <div className={styles.stack}>
      <Panel
        title="News feeds"
        meta="Headlines come from these RSS and Atom feeds. Nothing is fetched from a feed you have turned off."
      >
        {rows.length === 0 ? (
          <p className={styles.empty}>
            No feeds. The news panel will stay empty until you add one — it will not fall back to
            sample data.
          </p>
        ) : (
          <ul role="list" className={styles.list}>
            {rows.map((feed) => (
              <li key={feed.id} className={styles.feed}>
                <div className={styles.feedMain}>
                  <span className={styles.feedName}>
                    {feed.title || feed.url}
                    <span className={styles.category}>{CATEGORY_LABEL[feed.category]}</span>
                    {feed.isDefault ? <span className={styles.default}>Default</span> : null}
                  </span>
                  <span className={styles.url}>{feed.url}</span>
                  {feed.lastError ? (
                    <span className={styles.error}>{feed.lastError}</span>
                  ) : feed.lastOkAt ? (
                    <span className={styles.ok}>
                      Last loaded <RelativeTime epochSeconds={feed.lastOkAt} />
                    </span>
                  ) : (
                    <span className={styles.ok}>Not loaded yet</span>
                  )}
                </div>

                <div className={styles.feedActions}>
                  <Toggle
                    checked={feed.enabled}
                    onChange={(enabled) => setEnabled.mutate({ feedId: feed.id, enabled })}
                    label={`Use ${feed.title || feed.url}`}
                  />
                  <Button
                    variant="ghost"
                    onClick={() => remove.mutate(feed.id)}
                    aria-label={`Remove ${feed.title || feed.url}`}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Find a site's feed"
        meta="Reads what the site itself declares. No third-party search service."
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (site.trim()) discover.mutate(site.trim());
          }}
        >
          <div className={styles.field}>
            <label className={styles.label} htmlFor="feed-site">
              Site address
            </label>
            <Input
              id="feed-site"
              value={site}
              spellCheck={false}
              autoComplete="off"
              placeholder="coindesk.com"
              invalid={siteError !== null}
              aria-describedby="feed-site-hint"
              onChange={(event) => {
                setSite(event.target.value);
                setCandidates(null);
                setSiteError(null);
              }}
            />
            <p id="feed-site-hint" className={styles.hint}>
              The site&rsquo;s own address is enough — <code>https://</code> is assumed.
            </p>
          </div>

          <div className={styles.formActions}>
            <Button type="submit" variant="secondary" disabled={!site.trim() || discover.isPending}>
              {discover.isPending ? 'Looking…' : 'Find feeds'}
            </Button>
          </div>

          {siteError ? (
            <p className={styles.formError} role="alert">
              {siteError}
            </p>
          ) : null}

          {/*
            An empty result is an answer, not a failure. Plenty of sites publish no feed, and
            saying so is more use than an error that implies something went wrong.
          */}
          {candidates?.length === 0 ? (
            <p className={styles.hint} role="status">
              That site does not advertise a feed. If you know the address, enter it below.
            </p>
          ) : null}

          {candidates && candidates.length > 0 ? (
            <ul role="list" className={styles.candidates}>
              {candidates.map((candidate) => (
                <li key={candidate.url} className={styles.candidate}>
                  <div className={styles.candidateText}>
                    <span className={styles.candidateTitle}>
                      {candidate.title ?? 'An untitled feed'}
                    </span>
                    <span className={styles.candidateUrl}>{candidate.url}</span>
                    <span className={styles.candidateMeta}>
                      {candidate.itemCount} {candidate.itemCount === 1 ? 'item' : 'items'}
                      {candidate.newestTitle ? ` · newest: “${candidate.newestTitle}”` : ''}
                    </span>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => chooseCandidate(candidate)}>
                    Use this
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
      </Panel>

      <Panel title="Add a feed" meta="The address is checked before it is saved.">
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="feed-url">
              Feed address
            </label>
            <Input
              id="feed-url"
              value={url}
              spellCheck={false}
              autoComplete="off"
              placeholder="https://example.com/feed.xml"
              invalid={formError !== null}
              aria-describedby="feed-url-hint"
              onChange={(event) => {
                setUrl(event.target.value);
                setPreview(null);
                setFormError(null);
              }}
            />
            <p id="feed-url-hint" className={styles.hint}>
              Must start with <code>https://</code>.
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="feed-title">
              Name (optional)
            </label>
            <Input
              id="feed-title"
              value={title}
              spellCheck={false}
              autoComplete="off"
              placeholder="Taken from the feed if you leave this blank"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Section</legend>
            <p className={styles.legendHint}>
              Every story from this feed appears under the section you choose. Articles are not
              sorted individually — that would be a judgement about what a story is about.
            </p>
            <div className={styles.radios}>
              {CATEGORIES.map((option) => (
                <label key={option.value} className={styles.radio}>
                  <input
                    type="radio"
                    name="feed-category"
                    value={option.value}
                    checked={category === option.value}
                    onChange={() => setCategory(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          {preview ? (
            <p className={styles.preview} role="status">
              Found <strong>{preview.title ?? 'an untitled feed'}</strong> with {preview.itemCount}{' '}
              {preview.itemCount === 1 ? 'item' : 'items'}.
              {preview.newestTitle ? ` Newest: “${preview.newestTitle}”` : ''}
            </p>
          ) : null}

          {formError ? (
            <p className={styles.formError} role="alert">
              {formError}
            </p>
          ) : null}

          <div className={styles.formActions}>
            <Button
              variant="secondary"
              onClick={() => check.mutate(url.trim())}
              disabled={!url.trim() || check.isPending}
            >
              {check.isPending ? 'Checking…' : 'Check feed'}
            </Button>
            <Button type="submit" disabled={!url.trim() || add.isPending}>
              {add.isPending ? 'Adding…' : 'Add feed'}
            </Button>
          </div>
        </form>
      </Panel>

      {missingDefaults ? (
        <Panel title="Shipped feeds" meta="Feeds that came with the app and were removed.">
          <div className={styles.restore}>
            <p>
              Removing a shipped feed is remembered, so it does not come back on the next launch.
              This puts them back.
            </p>
            <Button
              variant="secondary"
              onClick={() => restore.mutate()}
              disabled={restore.isPending}
            >
              {restore.isPending ? 'Restoring…' : 'Restore the shipped feeds'}
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
