import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query is the in-memory tier only. SQLite is the durable cache, and the Rust
 * governor decides when to actually hit a provider — so the client here is configured
 * conservatively rather than eagerly. See ADR-005.
 */

/** Matches the Rust-side TTLs in DATA_MODEL.md so the two tiers do not fight. */
export const STALE_TIMES = {
  quotes: 60_000,
  chartIntraday: 5 * 60_000,
  chartHistorical: 6 * 60 * 60_000,
  profile: 7 * 24 * 60 * 60_000,
  news: 10 * 60_000,
  community: 30 * 60_000,
  preferences: Infinity,
  watchlists: Infinity,
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Refresh scheduling belongs to the Rust governor, not to window events.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // One retry. Provider backoff already happens in Rust; retrying here would
        // multiply requests against a rate limit we are trying to respect.
        retry: 1,
        retryDelay: 1000,
        staleTime: STALE_TIMES.quotes,
        gcTime: 30 * 60_000,
        // Cuts re-renders when a poll returns identical data — meaningful on a dual-core machine.
        structuralSharing: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
