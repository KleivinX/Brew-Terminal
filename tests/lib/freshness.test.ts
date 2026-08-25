import { describe, expect, it } from 'vitest';
import { ageInSeconds, derivePanelStatus } from '@/lib/freshness';
import type { Envelope, EnvelopeMeta } from '@/types/envelope';

function meta(overrides: Partial<EnvelopeMeta> = {}): EnvelopeMeta {
  return {
    providerId: 'mock',
    providerName: 'Mock provider',
    fetchedAt: new Date().toISOString(),
    source: 'mock',
    stale: false,
    degraded: null,
    ...overrides,
  };
}

function envelope(overrides: Partial<EnvelopeMeta> = {}): Envelope<number[]> {
  return { data: [1, 2, 3], meta: meta(overrides) };
}

describe('derivePanelStatus', () => {
  it('shows a skeleton only on a first load with nothing cached', () => {
    const status = derivePanelStatus(undefined, { isLoading: true, isEmpty: true });
    expect(status.state).toBe('loading');
  });

  it('keeps showing data while a refresh runs rather than reverting to a skeleton', () => {
    // A spinner over a known price helps nobody.
    const status = derivePanelStatus(envelope(), { isLoading: true, isEmpty: false });
    expect(status.state).toBe('ready');
  });

  it('marks stale data as stale but still showing values', () => {
    const status = derivePanelStatus(envelope({ stale: true }), {
      isLoading: false,
      isEmpty: false,
    });
    expect(status.state).toBe('stale');
    expect(status.showingFallbackData).toBe(true);
  });

  it('surfaces rate limiting with the cached data still visible', () => {
    const status = derivePanelStatus(
      envelope({
        stale: true,
        degraded: {
          reason: 'rate_limited',
          retryAfter: null,
          message: 'Provider request limit reached.',
        },
      }),
      { isLoading: false, isEmpty: false },
    );

    expect(status.state).toBe('rate-limited');
    expect(status.showingFallbackData).toBe(true);
    expect(status.detail).toContain('limit reached');
  });

  it('reports not-configured separately from an error', () => {
    // These need different UI: one links to Settings, the other offers a retry.
    const status = derivePanelStatus(
      envelope({
        degraded: {
          reason: 'not_configured',
          retryAfter: null,
          message: 'No provider is set up for this data yet.',
        },
      }),
      { isLoading: false, isEmpty: true },
    );
    expect(status.state).toBe('not-configured');
    expect(status.showingFallbackData).toBe(false);
  });

  it('labels mock data as mock so fixtures cannot pass as live', () => {
    const status = derivePanelStatus(envelope({ source: 'mock' }), {
      isLoading: false,
      isEmpty: false,
    });
    expect(status.label).toBe('Mock data');
    expect(status.detail).toContain('not real market data');
  });

  it('labels genuinely live data as live', () => {
    const status = derivePanelStatus(envelope({ source: 'live' }), {
      isLoading: false,
      isEmpty: false,
    });
    expect(status.label).toBe('Live');
  });

  it('distinguishes empty from failed', () => {
    expect(derivePanelStatus(envelope(), { isLoading: false, isEmpty: true }).state).toBe('empty');
    expect(
      derivePanelStatus(undefined, { isLoading: false, isEmpty: true, error: new Error('x') })
        .state,
    ).toBe('error');
  });
});

describe('ageInSeconds', () => {
  it('measures elapsed time from the fetch timestamp', () => {
    const fetchedAt = new Date('2025-08-22T00:00:00Z').toISOString();
    const now = new Date('2025-08-22T00:01:30Z').getTime();
    expect(ageInSeconds(meta({ fetchedAt }), now)).toBe(90);
  });

  it('clamps clock skew to zero instead of reporting a negative age', () => {
    const fetchedAt = new Date('2025-08-22T00:05:00Z').toISOString();
    const now = new Date('2025-08-22T00:00:00Z').getTime();
    expect(ageInSeconds(meta({ fetchedAt }), now)).toBe(0);
  });

  it('does not throw on an unparseable timestamp', () => {
    expect(ageInSeconds(meta({ fetchedAt: 'not a date' }))).toBe(0);
  });
});
