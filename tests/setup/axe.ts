import axe from 'axe-core';

/**
 * Runs axe against a container and returns violations.
 *
 * A ~20-line helper instead of a wrapper package — see DEPENDENCIES.md. Colour-contrast is
 * excluded here because jsdom does not compute real styles; contrast is verified numerically
 * against the token values in `tests/a11y/contrast.test.ts` instead, which is stricter than
 * what axe could tell us in this environment.
 */
export async function findAccessibilityViolations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
    },
  });
  return results.violations;
}

export function describeViolations(violations: axe.Result[]): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.html).join('\n  ')}`)
    .join('\n\n');
}
