import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Numeric contrast verification against the token values themselves.
 *
 * jsdom does not compute real styles, so axe's colour-contrast rule cannot help here. Parsing
 * the token file and doing the WCAG maths is both stricter and independent of rendering —
 * change a colour in tokens.css and this test tells you immediately whether it still passes.
 *
 * Thresholds: 4.5:1 for body text, 3:1 for large text and UI boundaries.
 */

// Resolved from the project root: under the jsdom environment `import.meta.url` is an http
// URL, so it cannot be converted to a file path.
const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const clean = hex.trim().replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Extracts a theme's token block. Dark is declared on `:root, [data-theme='dark']`; the other
 * two are declared on their own selectors.
 */
function themeTokens(theme: 'dark' | 'light' | 'soft'): Record<string, string> {
  const selector =
    theme === 'dark'
      ? String.raw`:root,\s*\[data-theme='dark'\]`
      : String.raw`\[data-theme='${theme}'\]`;
  const blockMatch = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(tokensCss);
  if (!blockMatch?.[1]) throw new Error(`could not find token block for theme: ${theme}`);

  const tokens: Record<string, string> = {};
  for (const line of blockMatch[1].split('\n')) {
    const decl = /^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(line);
    if (decl?.[1] && decl[2]) tokens[decl[1]] = decl[2];
  }
  return tokens;
}

const THEMES = ['dark', 'light', 'soft'] as const;

/** Pairs that carry meaning. Each must clear its threshold in every theme. */
const BODY_TEXT_PAIRS: [string, string][] = [
  ['--text-primary', '--bg-app'],
  ['--text-primary', '--bg-surface'],
  ['--text-secondary', '--bg-app'],
  ['--text-secondary', '--bg-surface'],
  ['--text-muted', '--bg-app'],
  ['--accent', '--bg-app'],
  ['--accent', '--bg-surface'],
  ['--positive', '--bg-surface'],
  ['--negative', '--bg-surface'],
  ['--status-stale', '--bg-surface'],
  ['--accent-contrast-text', '--accent'],
];

/** Boundaries and large text only need 3:1. */
const UI_PAIRS: [string, string][] = [['--border-strong', '--bg-surface']];

describe.each(THEMES)('theme: %s', (theme) => {
  const tokens = themeTokens(theme);

  it('defines every token the contrast checks depend on', () => {
    for (const [fg, bg] of [...BODY_TEXT_PAIRS, ...UI_PAIRS]) {
      expect(tokens[fg], `${theme} is missing ${fg}`).toBeDefined();
      expect(tokens[bg], `${theme} is missing ${bg}`).toBeDefined();
    }
  });

  it.each(BODY_TEXT_PAIRS)('%s on %s reaches 4.5:1', (fg, bg) => {
    const ratio = contrastRatio(parseHex(tokens[fg] as string), parseHex(tokens[bg] as string));
    expect(
      ratio,
      `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs 4.5:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)('%s on %s reaches 3:1', (fg, bg) => {
    const ratio = contrastRatio(parseHex(tokens[fg] as string), parseHex(tokens[bg] as string));
    expect(
      ratio,
      `${theme}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs 3:1`,
    ).toBeGreaterThanOrEqual(3);
  });

  it('separates positive and negative enough to be distinguishable', () => {
    // Direction is never colour alone, but when colour is used the two must not be
    // near-identical in hue-blind terms either.
    const ratio = contrastRatio(
      parseHex(tokens['--positive'] as string),
      parseHex(tokens['--negative'] as string),
    );
    expect(ratio).toBeGreaterThan(1.2);
  });
});

describe('contrast maths', () => {
  it('matches known WCAG reference values', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBeCloseTo(1, 5);
  });
});
