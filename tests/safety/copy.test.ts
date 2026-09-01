import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCLAIMER_LONG, DISCLAIMER_TEXT } from '@/components/status/DisclaimerNote';
import { RESPONSE_CAUTION_PATTERNS } from '@/features/model-desk/guardrails';

/**
 * Standing safety rules, enforced over the source itself.
 *
 * The ESLint rule `local/no-banned-copy` catches these at author time; this suite is the
 * belt-and-braces version that also covers content files and the exact disclaimer wording.
 * See PRODUCT_SCOPE_V0_1.md §6.
 */

const ROOT = process.cwd();

function walk(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'generated') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/** Language that implies a verdict, a recommendation, or a certain outcome. */
const BANNED = [
  /\bscam\s+score\b/i,
  /\bfake\s+coin\b/i,
  /\bcoin\s+detector\b/i,
  /\bguaranteed?\s+(returns?|profit|gains?)\b/i,
  /\brisk[- ]free\b/i,
  /\bsafe\s+investment\b/i,
  /\bbest\s+trade\b/i,
  /\bstrong\s+buy\b/i,
  /\bprice\s+target\b/i,
  /\btrading\s+signals?\b/i,
  /\bto\s+the\s+moon\b/i,
];

describe('banned vocabulary', () => {
  const sourceFiles = walk(resolve(ROOT, 'src'), ['.ts', '.tsx']).filter(
    (f) => !f.includes('.test.'),
  );

  it('finds source files to scan', () => {
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  it.each(BANNED.map((p) => [p.source, p] as const))(
    'no source file contains %s',
    (_label, pattern) => {
      const offenders = sourceFiles.filter((file) => {
        const contents = readFileSync(file, 'utf8');
        // The rule definition and this test necessarily quote the patterns themselves, and so
        // does the guardrail module whose job is to detect them in model output. The exemption
        // is paid for by `covers every phrase the copy rule bans`, below.
        if (file.includes('eslint-rules') || file.includes('tests/safety')) return false;
        if (file.endsWith('model-desk/guardrails.ts')) return false;
        return pattern.test(contents);
      });

      expect(offenders, `banned phrase in: ${offenders.join(', ')}`).toHaveLength(0);
    },
  );

  it('no fixture headline uses hype language', () => {
    const fixtures = walk(resolve(ROOT, 'content'), ['.json']);
    for (const file of fixtures) {
      const contents = readFileSync(file, 'utf8');
      for (const pattern of BANNED) {
        expect(pattern.test(contents), `${file} matched ${pattern}`).toBe(false);
      }
    }
  });
});

describe('the model-output scan', () => {
  /*
   * The app's copy rule and the response scan are two lists of the same vocabulary, in two
   * files, for two different jobs. Without this they drift, and the drift is silent: a phrase
   * banned in Brew Terminal's own copy would sail through a model's answer uncautioned.
   */
  it('covers every phrase the copy rule bans', () => {
    const scanned = new Set(RESPONSE_CAUTION_PATTERNS.map((p) => p.source));
    const missing = BANNED.map((p) => p.source).filter((source) => !scanned.has(source));

    expect(missing, `model responses are not scanned for: ${missing.join(', ')}`).toEqual([]);
  });

  it('flags advice-shaped model output and quotes what matched', () => {
    // Deliberately the kind of sentence a model produces despite the system prompt.
    const answer = 'Given the momentum, this is a strong buy and returns are risk-free.';
    const matches = RESPONSE_CAUTION_PATTERNS.filter((p) => p.test(answer));
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('leaves ordinary educational answers alone', () => {
    const answer =
      'An ETF is a fund that trades on an exchange. Its price tracks a basket of holdings, ' +
      'and the main risks are concentration, tracking error and liquidity.';
    expect(RESPONSE_CAUTION_PATTERNS.some((p) => p.test(answer))).toBe(false);
  });
});

describe('the disclaimer', () => {
  it('uses the exact agreed wording', () => {
    // Changing this string changes it everywhere at once, which is the point of centralising it.
    expect(DISCLAIMER_TEXT).toBe(
      'A research tool, not an adviser. Your decisions, and their consequences, are your own.',
    );
  });

  /*
   * The wording above is allowed to change; these two properties are not, which is why they
   * are asserted separately from the literal.
   *
   * v0.2 moved the notice from a positioning statement ("educational information only") to a
   * liability one. That was a deliberate repositioning — the app shows live market data and
   * runs real analysis, and calling that educational undersold it. What could not move is the
   * disclaimer of advice: an app issuing personalised investment recommendations is regulated
   * as an adviser in most jurisdictions, and no wording cures that.
   */
  it('still disclaims being an adviser', () => {
    expect(DISCLAIMER_TEXT.toLowerCase()).toMatch(/not an adviser|not advice|not financial advice/);
  });

  it('still puts the consequences on the reader', () => {
    expect(`${DISCLAIMER_TEXT} ${DISCLAIMER_LONG}`.toLowerCase()).toMatch(
      /your own|are yours|your decisions|your responsibility/,
    );
  });

  it('the long form accepts no responsibility and says data can be wrong', () => {
    const long = DISCLAIMER_LONG.toLowerCase();
    expect(long).toMatch(/accepts no responsibility|no liability/);
    expect(long).toMatch(/delayed, incomplete or wrong|may be wrong/);
  });

  it('is defined in exactly one place', () => {
    const sourceFiles = walk(resolve(ROOT, 'src'), ['.ts', '.tsx']);
    const literalDefinitions = sourceFiles.filter((file) => {
      const contents = readFileSync(file, 'utf8');
      return (
        contents.includes('not financial advice') &&
        !file.endsWith('DisclaimerNote.tsx') &&
        // Prose in a comment is fine; a second copy of the string is not.
        contents
          .split('\n')
          .some((line) => line.includes("'") && line.includes('not financial advice'))
      );
    });

    expect(
      literalDefinitions,
      `duplicate disclaimer literal in: ${literalDefinitions.join(', ')}`,
    ).toHaveLength(0);
  });
});

describe('causality and legitimacy language', () => {
  it('never claims a reason for a price move', () => {
    const sourceFiles = walk(resolve(ROOT, 'src'), ['.tsx']);
    // "Why BTC dropped" style copy asserts causation the app cannot establish.
    const causal = /\bwhy\s+(btc|eth|the\s+market|prices?)\s+(rose|fell|dropped|surged|crashed)/i;

    for (const file of sourceFiles) {
      expect(causal.test(readFileSync(file, 'utf8')), `causal claim in ${file}`).toBe(false);
    }
  });
});
