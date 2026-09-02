import { describe, expect, it } from 'vitest';
import {
  direction,
  directionGlyph,
  directionLabel,
  formatCompact,
  formatQuantity,
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

describe('formatPrice at zero', () => {
  it('renders nothing as nothing, not as eight decimals of it', () => {
    // Decimals are chosen by magnitude, and zero has none — it used to land in the branch for
    // sub-0.0001 prices, so an untouched position showed a realised gain of $0.00000000.
    expect(formatPrice(0, 'USD', 'en-US')).toBe('$0.00');
    expect(formatPrice(-0, 'USD', 'en-US')).toBe('$0.00');
  });

  it('still gives a genuinely tiny price its precision', () => {
    expect(formatPrice(0.00001234, 'USD', 'en-US')).toBe('$0.00001234');
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

describe('formatQuantity', () => {
  /**
   * The case that put this function here. Buying 0.25 then 0.1 leaves 0.35000000000000003 in
   * an f64, and the positions table rendered it raw — someone's holding shown with seventeen
   * digits of binary artefact.
   */
  it('does not show floating-point noise as a holding', () => {
    expect(formatQuantity(0.25 + 0.1, 'en-US')).toBe('0.35');
    expect(formatQuantity(2.1000000000000005, 'en-US')).toBe('2.1');
    expect(formatQuantity(0.1 + 0.2, 'en-US')).toBe('0.3');
  });

  it('drops trailing zeros on a round quantity', () => {
    expect(formatQuantity(18, 'en-US')).toBe('18');
    expect(formatQuantity(120, 'en-US')).toBe('120');
  });

  it('groups large quantities', () => {
    expect(formatQuantity(1_200_000, 'en-US')).toBe('1,200,000');
  });

  it('keeps precision down to the smallest unit Bitcoin has', () => {
    // A satoshi is 1e-8; anything a crypto position can legitimately hold must survive.
    expect(formatQuantity(0.00000001, 'en-US')).toBe('0.00000001');
    expect(formatQuantity(0.12345678, 'en-US')).toBe('0.12345678');
  });

  it('refuses a non-number rather than printing NaN', () => {
    expect(formatQuantity(Number.NaN)).toBe('—');
    expect(formatQuantity(Number.POSITIVE_INFINITY)).toBe('—');
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
