/**
 * The freshness envelope.
 *
 * Every data-returning command replies with one of these rather than a bare payload. This is
 * the mechanism behind "no number renders without its provider and its age": the UI physically
 * cannot obtain data without also receiving the attribution, the timestamp and the degraded
 * state. Forgetting to show provenance requires deliberately discarding it.
 */

export type EnvelopeSource = 'live' | 'cache' | 'mock';

export type DegradedReason =
  'rate_limited' | 'network' | 'provider_error' | 'not_configured' | 'invalid_response';

export interface Degraded {
  reason: DegradedReason;
  /** ISO 8601 UTC. Present when the provider told us when to come back. */
  retryAfter: string | null;
  /** User-safe. Never contains a credential, a raw URL with query string, or a provider body. */
  message: string;
}

export interface EnvelopeMeta {
  providerId: string;
  /** Rendered in the provider badge. Attribution is not optional. */
  providerName: string;
  /** ISO 8601 UTC — when this data was actually retrieved, not when it was requested. */
  fetchedAt: string;
  source: EnvelopeSource;
  /** Past its TTL but still the best value we have. Shown, not hidden. */
  stale: boolean;
  /** Non-null when a live refresh failed. The data field still holds the last good value. */
  degraded: Degraded | null;
}

export interface Envelope<T> {
  data: T;
  meta: EnvelopeMeta;
}

/**
 * The single visual state a data panel is in. Derived from the envelope by
 * `lib/freshness.ts` — panels never compute this themselves, so the mapping stays consistent
 * across every surface in the app.
 */
export type PanelState =
  'loading' | 'ready' | 'stale' | 'empty' | 'rate-limited' | 'error' | 'not-configured';
