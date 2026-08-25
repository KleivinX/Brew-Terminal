import type { Envelope, EnvelopeMeta, PanelState } from '@/types/envelope';

/**
 * Envelope → panel state.
 *
 * Panels never work this out for themselves. One mapping, used everywhere, is what keeps
 * "stale" looking the same in the crypto table and the news feed and the asset header.
 */

export interface PanelStatus {
  state: PanelState;
  /** Short label for the status pill, e.g. "Live", "Stale", "Rate limited". */
  label: string;
  /** One sentence explaining the state, safe to render to the user. */
  detail: string;
  /** True when a value is on screen despite something being wrong with the refresh. */
  showingFallbackData: boolean;
}

export interface DeriveOptions {
  isLoading: boolean;
  isEmpty: boolean;
  error?: unknown | undefined;
}

export function derivePanelStatus(
  envelope: Envelope<unknown> | undefined,
  options: DeriveOptions,
): PanelStatus {
  // A first load with nothing cached is the only case that gets a skeleton. Once any value
  // exists we keep showing it, because a spinner over a known price helps nobody.
  if (options.isLoading && !envelope) {
    return {
      state: 'loading',
      label: 'Loading',
      detail: 'Fetching data.',
      showingFallbackData: false,
    };
  }

  if (!envelope) {
    if (options.error) {
      return {
        state: 'error',
        label: 'Unavailable',
        detail: 'This data could not be loaded. Try again, or check the provider in Settings.',
        showingFallbackData: false,
      };
    }
    return {
      state: 'empty',
      label: 'No data',
      detail: 'Nothing to show yet.',
      showingFallbackData: false,
    };
  }

  const { degraded, stale } = envelope.meta;

  if (degraded) {
    const hasData = !options.isEmpty;
    switch (degraded.reason) {
      case 'not_configured':
        return {
          state: 'not-configured',
          label: 'Not set up',
          detail: degraded.message,
          showingFallbackData: false,
        };
      case 'rate_limited':
        return {
          state: 'rate-limited',
          label: 'Rate limited',
          detail: degraded.message,
          showingFallbackData: hasData,
        };
      default:
        return {
          state: 'error',
          label: 'Refresh failed',
          detail: degraded.message,
          showingFallbackData: hasData,
        };
    }
  }

  if (options.isEmpty) {
    return {
      state: 'empty',
      label: 'No data',
      detail: 'Nothing to show yet.',
      showingFallbackData: false,
    };
  }

  if (stale) {
    return {
      state: 'stale',
      label: 'Stale',
      detail: 'Showing the last known values while a refresh runs.',
      showingFallbackData: true,
    };
  }

  return {
    state: 'ready',
    label: envelope.meta.source === 'mock' ? 'Mock data' : 'Live',
    detail:
      envelope.meta.source === 'mock'
        ? 'Development fixtures — not real market data.'
        : 'Up to date.',
    showingFallbackData: false,
  };
}

/** Seconds since this data was retrieved. Negative clock skew is clamped to zero. */
export function ageInSeconds(meta: EnvelopeMeta, now: number = Date.now()): number {
  const fetched = Date.parse(meta.fetchedAt);
  if (Number.isNaN(fetched)) return 0;
  return Math.max(0, Math.round((now - fetched) / 1000));
}

export function fetchedAtEpochSeconds(meta: EnvelopeMeta): number {
  const parsed = Date.parse(meta.fetchedAt);
  return Number.isNaN(parsed) ? 0 : Math.round(parsed / 1000);
}
