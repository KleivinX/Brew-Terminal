import { describe, expect, it } from 'vitest';
import { rank, scoreMatch } from '@/lib/fuzzy';

describe('scoreMatch', () => {
  it('ranks an exact match above everything else', () => {
    expect(scoreMatch('btc', 'BTC')).toBe(1);
    expect(scoreMatch('btc', 'BTC')).toBeGreaterThan(scoreMatch('btc', 'Bitcoin'));
  });

  it('ranks a prefix above a mid-string match', () => {
    // Typing "bit" should surface Bitcoin before Wrapped Bitcoin.
    expect(scoreMatch('bit', 'Bitcoin')).toBeGreaterThan(scoreMatch('bit', 'Wrapped Bitcoin'));
  });

  it('is case insensitive', () => {
    expect(scoreMatch('AAPL', 'aapl')).toBe(1);
  });

  it('returns zero when the characters are not present in order', () => {
    expect(scoreMatch('xyz', 'Bitcoin')).toBe(0);
    expect(scoreMatch('nib', 'Bitcoin')).toBe(0);
  });

  it('returns zero for an empty query rather than matching everything', () => {
    expect(scoreMatch('', 'Bitcoin')).toBe(0);
  });

  it('matches a scattered subsequence, but scores it below a substring', () => {
    const subsequence = scoreMatch('bcn', 'Bitcoin');
    expect(subsequence).toBeGreaterThan(0);
    expect(subsequence).toBeLessThan(scoreMatch('coin', 'Bitcoin'));
  });

  it('prefers a shorter target when both are prefix matches', () => {
    expect(scoreMatch('sol', 'Solana')).toBeGreaterThan(
      scoreMatch('sol', 'Solana Ecosystem Index'),
    );
  });
});

describe('rank', () => {
  const commands = [
    { id: 'theme.dark', title: 'Theme: Dark', keywords: ['terminal', 'night'] },
    { id: 'nav.pulse', title: 'Go to Pulse', keywords: ['market', 'dashboard'] },
    { id: 'nav.learn', title: 'Go to Learn', keywords: ['glossary', 'terms'] },
  ];

  const keys = (c: (typeof commands)[number]) => [c.title, ...c.keywords];

  it('returns everything for a blank query', () => {
    expect(rank('', commands, keys)).toHaveLength(3);
  });

  it('finds a command by keyword rather than title', () => {
    const results = rank('glossary', commands, keys);
    expect(results[0]?.item.id).toBe('nav.learn');
  });

  it('drops non-matching items', () => {
    expect(rank('zzzz', commands, keys)).toHaveLength(0);
  });

  it('orders results by descending score', () => {
    const results = rank('go to', commands, keys);
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });
});
