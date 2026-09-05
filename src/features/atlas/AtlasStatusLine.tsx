import { Icon } from '@/components/ui/Icon';
import { RelativeTime } from '@/components/status/RelativeTime';
import type { AtlasRoute } from '@/types/domain';
import styles from './AtlasStatusLine.module.css';

/**
 * Which free tier is answering, and what is behind it.
 *
 * This is not decoration. A ticker that cannot say which provider served a number, and how much
 * of that provider's allowance is left, is asking the reader to trust a figure with no account
 * of where it came from — which is the one thing this app does not do anywhere else.
 *
 * "Fallback ready" is a claim, so it is only made when the rotation manager has actually
 * confirmed a second provider could take the next request right now. Where there is no second
 * source for a market the line says that instead of implying redundancy that does not exist.
 */

const MARKET_LABEL: Record<string, string> = {
  crypto: 'Crypto',
  stock: 'Stocks',
  etf: 'ETFs',
  index: 'Indices',
};

export function AtlasStatusLine({ routes, fetching }: { routes: AtlasRoute[]; fetching: boolean }) {
  if (routes.length === 0) {
    return (
      <div role="status" aria-live="polite">
        <p className={styles.line}>
          <span className={styles.dot} data-state="idle" aria-hidden="true" />
          Atlas: waiting for a watchlist
        </p>
      </div>
    );
  }

  return (
    /*
      The live region wraps the list rather than sitting on it. role="status" on a <ul> or an
      <li> replaces the list role and orphans the items — an axe failure, and it costs screen
      reader users the item count. Same shape as the toast host.
    */
    <div role="status" aria-live="polite">
      <ul role="list" className={styles.list}>
        {routes.map((route) => {
          const label = MARKET_LABEL[route.market] ?? route.market;
          const connected = route.providerId !== '';

          return (
            <li key={route.market} className={styles.line}>
              <span
                className={styles.dot}
                data-state={connected ? (fetching ? 'live' : 'ok') : 'blocked'}
                aria-hidden="true"
              />

              <span className={styles.text}>
                {connected ? (
                  <>
                    <span className={styles.label}>Atlas · {label}</span> connected via{' '}
                    <strong>{route.providerName}</strong>
                    {route.fallbackName ? (
                      <> — {route.fallbackName} ready</>
                    ) : (
                      /*
                       * Said plainly rather than left blank. A single reviewed source for a
                       * market is the current truth, and a status line that stays silent about it
                       * would let the reader assume a safety net.
                       */
                      <> — no second source reviewed</>
                    )}
                    <span className={styles.budget}>
                      {route.windowRemaining} calls left this minute
                      {route.dayRemaining !== null ? ` · ${route.dayRemaining} today` : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={styles.label}>Atlas · {label}</span> no provider available
                    <span className={styles.blocked}>
                      {route.blocked.map((entry) => (
                        <span key={entry.providerName} className={styles.blockedItem}>
                          <Icon name="warning" size={11} /> {entry.providerName}: {entry.reason}
                          {entry.until !== null ? (
                            <>
                              {' '}
                              until <RelativeTime epochSeconds={entry.until} />
                            </>
                          ) : null}
                        </span>
                      ))}
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
