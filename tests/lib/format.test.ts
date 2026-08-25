import { describe, expect, it } from 'vitest';
import {
  direction,
  directionGlyph,
  directionLabel,
  formatCompact,
  formatPercent,
  formatPrice,
  formatRelativeTime,
} from '@/lib/format';

describe('formatPrice', () => {
  it('uses adaptive precision so both large and tiny prices stay readable', () => {
    // Fixed decimals would render a sub-cent token as "$0.00".
    expect(formatPrice(61240.55, 'USD', 'en-US')).toBe('$61,240.55');
    expect(formatPrice(0.4412, 'USD', 'en-US')).toBe('$0.4412');
    expect(formatPrice(0.00004212, 'USD', 'en-US')).toBe('$0.00004212');
  });

  it('renders an em dash rather than NaN for unusable values', () => {
    expect(formatPrice(Number.NaN)).toBe('—');
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('always shows a sign, because the sign is one of the direction channels', () => {
    expect(formatPercent(2.41, 'en-US')).toBe('+2.41%');
    expect(formatPercent(-1.08, 'en-US')).toBe('-1.08%');
    expect(formatPercent(0, 'en-US')).toBe('+0.00%');
  });

  it('handles a missing value without inventing one', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatCompact', () => {
  it('shortens large figures', () => {
    expect(formatCompact(1_205_000_000_000, 'en-US')).toBe('1.21T');
    expect(formatCompact(28_400_000_000, 'en-US')).toBe('28.4B');
  });

  it('returns an em dash for null', () => {
    expect(formatCompact(null)).toBe('—');
  });
});

describe('direction channels', () => {
  it('classifies direction, including exact zero as flat', () => {
    expect(direction(1.5)).toBe('up');
    expect(direction(-1.5)).toBe('down');
    expect(direction(0)).toBe('flat');
    expect(direction(null)).toBe('flat');
  });

  it('provides a glyph so colour is never the only signal', () => {
    expect(directionGlyph('up')).toBe('▲');
    expect(directionGlyph('down')).toBe('▼');
  });

  it('provides a spoken label for screen readers', () => {
    expect(directionLabel(2.41, '24 hour change')).toBe('24 hour change up 2.41 percent');
    expect(directionLabel(-1.08, '7 day change')).toBe('7 day change down 1.08 percent');
    expect(directionLabel(0, '24 hour change')).toBe('24 hour change unchanged');
    expect(directionLabel(null, '24 hour change')).toBe('24 hour change unavailable');
  });
});

describe('formatRelativeTime', () => {
  // A frozen clock: 2025-08-22T00:00:00Z.
  const now = 1_755_820_800_000;

  it('scales the unit to the distance', () => {
    // Narrow style: seconds/minutes/hours are terse, and `numeric: 'auto'` turns a
    // one-day gap into "yesterday" rather than "1d ago".
    expect(formatRelativeTime(1_755_820_790, now, 'en-US')).toBe('10s ago');
    expect(formatRelativeTime(1_755_819_000, now, 'en-US')).toBe('30m ago');
    expect(formatRelativeTime(1_755_813_600, now, 'en-US')).toBe('2h ago');
    expect(formatRelativeTime(1_755_734_400, now, 'en-US')).toBe('yesterday');
  });

  it('does not crash on a future timestamp from clock skew', () => {
    expect(() => formatRelativeTime(1_755_824_400, now, 'en-US')).not.toThrow();
  });
});
