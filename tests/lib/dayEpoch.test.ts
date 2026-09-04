import { describe, expect, it } from 'vitest';
import { dayToEpoch, isoDay } from '@/lib/format';

describe('note pin dates', () => {
  it('round-trips a day', () => {
    const epoch = dayToEpoch('2026-03-14');
    expect(epoch).not.toBeNull();
    expect(isoDay(epoch!)).toBe('2026-03-14');
  });

  /**
   * Midday, not midnight. A daily series plots somewhere inside its day, and a marker at 00:00
   * sits on the boundary where rounding can put it against the previous session.
   */
  it('stamps midday UTC', () => {
    expect(new Date(dayToEpoch('2026-03-14')! * 1000).toISOString()).toBe(
      '2026-03-14T12:00:00.000Z',
    );
  });

  /**
   * UTC on both sides. A note pinned to the 3rd stays on the 3rd for a reader in Auckland and
   * one in Los Angeles; round-tripping through local time is how a marker moves a day when
   * someone changes timezone.
   */
  it('does not drift across timezones', () => {
    for (const day of ['2026-01-01', '2026-06-30', '2026-12-31']) {
      expect(isoDay(dayToEpoch(day)!)).toBe(day);
    }
  });

  it('refuses anything that is not a date', () => {
    for (const bad of ['', '2026', '2026-03', 'yesterday', '14/03/2026', '2026-3-4']) {
      expect(dayToEpoch(bad), bad).toBeNull();
    }
  });

  /** Date.parse rolls 31 February into March. A date that does not survive the round trip was
   * never a real one, and a note pinned to it would silently land on the wrong day. */
  it('refuses a day that does not exist', () => {
    expect(dayToEpoch('2026-02-31')).toBeNull();
    expect(dayToEpoch('2026-13-01')).toBeNull();
    expect(dayToEpoch('2026-04-31')).toBeNull();
  });

  it('accepts a real leap day and rejects a fake one', () => {
    expect(dayToEpoch('2024-02-29')).not.toBeNull();
    expect(dayToEpoch('2026-02-29')).toBeNull();
  });
});
