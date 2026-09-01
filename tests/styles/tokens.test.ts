import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Static verification that every custom property a stylesheet reads is one that exists.
 *
 * CSS fails silently here in the worst possible way: `background: var(--typo)` is not an error,
 * it is *nothing*. The declaration is dropped at computed-value time and the element paints
 * transparent, so a mistyped token looks like a deliberate design choice rather than a bug.
 * jsdom does not compute real styles, so no rendering test can catch it either — which is how
 * `--surface-raised` survived across thirteen call sites in six features.
 *
 * A fallback does not excuse an undefined name. `var(--radius-pill, 999px)` renders correctly
 * today and still means the token it names does not exist: the fallback is a hardcoded value
 * that no theme can override, which is exactly what the token layer is for.
 *
 * Both checks are pure text analysis, deliberately: they are independent of rendering, run in
 * milliseconds, and fail on the CI machine for the same reason they fail locally.
 */

const SRC = resolve(process.cwd(), 'src');
const TOKENS_CSS = join(SRC, 'styles/tokens.css');

function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => extensions.some((ext) => entry.endsWith(ext)))
    .map((entry) => join(dir, entry));
}

/** `--name: value` — a declaration, not a `var()` read. */
const DEFINITION = /(?:^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g;
/** `var(--name)` and `var(--name, fallback)`, including nested reads. */
const REFERENCE = /var\(\s*(--[A-Za-z0-9_-]+)/g;

/** Every group-1 capture of a global pattern. A group that did not participate is dropped. */
function captures(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].flatMap(([, group]) => (group === undefined ? [] : [group]));
}

describe('CSS custom properties', () => {
  const cssFiles = filesUnder(SRC, ['.css']);

  it('finds the stylesheets it is meant to be checking', () => {
    // Guards against the check silently passing because the walk returned nothing.
    expect(cssFiles.length).toBeGreaterThan(50);
    expect(cssFiles).toContain(TOKENS_CSS);
  });

  it('never reads a custom property that is nowhere defined', () => {
    const defined = new Set<string>();
    const referenced = new Map<string, string[]>();

    for (const file of cssFiles) {
      const relative = file.slice(resolve(process.cwd()).length + 1);
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          for (const name of captures(line, DEFINITION)) defined.add(name);
          for (const name of captures(line, REFERENCE)) {
            const sites = referenced.get(name) ?? [];
            sites.push(`${relative}:${index + 1}`);
            referenced.set(name, sites);
          }
        });
    }

    // A property may also be supplied at runtime from an inline style object or setProperty —
    // `--chart-N` is read that way. Those count as defined; the value simply arrives from TS.
    for (const file of filesUnder(SRC, ['.ts', '.tsx'])) {
      const source = readFileSync(file, 'utf8');
      for (const name of captures(source, /['"](--[A-Za-z0-9_-]+)['"]\s*:/g)) defined.add(name);
      for (const name of captures(source, /setProperty\(\s*['"](--[A-Za-z0-9_-]+)['"]/g)) {
        defined.add(name);
      }
    }

    const undeclared = [...referenced.entries()]
      .filter(([name]) => !defined.has(name))
      .map(([name, sites]) => `${name} — read at ${sites.join(', ')}`);

    expect(undeclared, 'undefined custom properties render as nothing, not as an error').toEqual(
      [],
    );
  });

  it('defines the same token set in all three themes', () => {
    // A token added to one theme and forgotten in the others fails the same silent way: the
    // element renders transparent, but only for the users on the theme that was missed.
    const tokensCss = readFileSync(TOKENS_CSS, 'utf8');

    const themeTokens = (theme: 'dark' | 'light' | 'soft'): Set<string> => {
      const selector =
        theme === 'dark'
          ? String.raw`:root,\s*\[data-theme='dark'\]`
          : String.raw`\[data-theme='${theme}'\]`;
      const block = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(tokensCss);
      if (!block?.[1]) throw new Error(`could not find token block for theme: ${theme}`);
      return new Set(captures(block[1], /^\s*(--[\w-]+):/gm));
    };

    const themes = {
      dark: themeTokens('dark'),
      light: themeTokens('light'),
      soft: themeTokens('soft'),
    };
    const union = new Set(Object.values(themes).flatMap((set) => [...set]));

    const gaps = Object.entries(themes).flatMap(([theme, set]) =>
      [...union].filter((name) => !set.has(name)).map((name) => `${theme} is missing ${name}`),
    );

    expect(gaps, 'every theme must answer for every themed token').toEqual([]);
  });
});
