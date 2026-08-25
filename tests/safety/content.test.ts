import { describe, expect, it } from 'vitest';
import glossaryJson from '@content/learn/glossary.json';
import pathsJson from '@content/learn/paths.json';
import { validateContent } from '@/features/learn/contentSchema';

/**
 * The Learn content bundle, validated as a test as well as in CI.
 *
 * The acceptance criterion is that malformed content fails the build. Doing it here as well
 * means an authoring mistake shows up in the ordinary test run rather than only after a push.
 */
const result = validateContent({ glossary: glossaryJson, paths: pathsJson });

describe('Learn content', () => {
  it('validates cleanly', () => {
    expect(
      result.issues.map((i) => `${i.where}: ${i.problem}`),
      'content validation failed',
    ).toEqual([]);
    expect(result.content).not.toBeNull();
  });

  it('covers every term the brief requires', () => {
    /*
     * Named explicitly in the product brief. Listing them here means dropping one during a
     * content edit fails a test rather than going unnoticed.
     */
    const required = [
      'stock',
      'etf',
      'index',
      'market-cap',
      'p-e-ratio',
      'dividend',
      'volatility',
      'liquidity',
      'market-order',
      'limit-order',
      'spread',
      'volume',
      'staking',
      'stablecoin',
      'blockchain',
      'wallet',
      'risk-tolerance',
    ];

    const ids = new Set((result.content?.glossary ?? []).map((e) => e.id));
    const missing = required.filter((id) => !ids.has(id));
    expect(missing, `missing required glossary entries: ${missing.join(', ')}`).toEqual([]);
  });

  it('has at least 40 glossary entries', () => {
    expect(result.content?.glossary.length ?? 0).toBeGreaterThanOrEqual(40);
  });

  it('has five paths with at least three lessons each', () => {
    const paths = result.content?.paths ?? [];
    expect(paths.length).toBeGreaterThanOrEqual(5);
    for (const path of paths) {
      expect(path.lessons.length, `${path.id} has too few lessons`).toBeGreaterThanOrEqual(3);
    }
  });

  it('covers the five paths the brief names', () => {
    const ids = new Set((result.content?.paths ?? []).map((p) => p.id));
    for (const id of [
      'stocks-basics',
      'crypto-basics',
      'reading-financial-news',
      'risk-and-scams',
      'how-markets-work',
    ]) {
      expect(ids.has(id), `missing path: ${id}`).toBe(true);
    }
  });

  it('resolves every cross-reference', () => {
    // validateContent already checks this; asserting separately makes the failure legible.
    const ids = new Set((result.content?.glossary ?? []).map((e) => e.id));
    const broken: string[] = [];

    for (const entry of result.content?.glossary ?? []) {
      for (const ref of entry.seeAlso) {
        if (!ids.has(ref)) broken.push(`${entry.id} → ${ref}`);
      }
    }
    for (const path of result.content?.paths ?? []) {
      for (const lesson of path.lessons) {
        for (const ref of lesson.keyTerms) {
          if (!ids.has(ref)) broken.push(`${path.id}/${lesson.id} → ${ref}`);
        }
      }
    }

    expect(broken).toEqual([]);
  });

  it('gives no entry a dead end', () => {
    // An entry with no onward links is a corridor with no doors.
    const orphans = (result.content?.glossary ?? [])
      .filter((entry) => entry.seeAlso.length === 0)
      .map((entry) => entry.id);
    expect(orphans, `entries with no seeAlso: ${orphans.join(', ')}`).toEqual([]);
  });

  it('never gives advice', () => {
    /*
     * The load-bearing test for this content. Educational copy is where advice-shaped
     * language creeps in most easily — explaining slides into recommending.
     */
    const text = JSON.stringify({ glossaryJson, pathsJson }).toLowerCase();

    for (const banned of [
      'you should buy',
      'you should sell',
      'you should invest',
      'we recommend',
      'guaranteed return',
      'risk-free',
      'risk free',
      'safe investment',
      'best stock',
      'best coin',
      'strong buy',
      'price target',
      'to the moon',
    ]) {
      expect(text, `content contains "${banned}"`).not.toContain(banned);
    }
  });

  it('does not label any asset as a scam or as legitimate', () => {
    // The app has no basis for either verdict, including in its educational copy.
    const entries = result.content?.glossary ?? [];
    const rugPull = entries.find((e) => e.id === 'rug-pull');

    expect(rugPull).toBeDefined();
    // It must describe the pattern and explicitly disclaim the ability to detect it.
    expect(rugPull?.body.join(' ')).toMatch(/does not label assets as scams/i);
  });
});
