import { describe, expect, it } from 'vitest';
import { GO_TO_ROUTES, NAV_ITEMS, NUMBER_ROUTES } from '@/components/layout/navItems';
import { commands } from '@/components/palette/commandRegistry';

/**
 * Keeps the three ways of getting somewhere in step with each other.
 *
 * The rail, the keyboard shortcuts and the command palette are written separately, and they
 * drifted once already: routes were added to the rail while `Mod+1`–`5` still pointed at the
 * five that existed when the map was written, and Portfolio, Screener and Compare were
 * reachable by mouse but from neither the palette nor a shortcut. These assertions are what
 * make adding a route without wiring it up a failing test rather than a quiet gap.
 */
describe('navigation stays consistent', () => {
  it('gives every rail item a unique route, label and shortcut letter', () => {
    const routes = NAV_ITEMS.map((item) => item.to);
    const keys = NAV_ITEMS.map((item) => item.key);
    const labels = NAV_ITEMS.map((item) => item.label);

    expect(new Set(routes).size).toBe(routes.length);
    expect(new Set(keys).size, `duplicate g-shortcut letter in ${keys.join(', ')}`).toBe(
      keys.length,
    );
    expect(new Set(labels).size).toBe(labels.length);
    expect(keys.every((key) => /^[a-z]$/.test(key))).toBe(true);
  });

  it('numbers the shortcuts in the order the rail draws them', () => {
    // The About page calls Mod+1–9 "jump to a navigation item". That is only true if the
    // numbering follows the visual order rather than a list written at some earlier date.
    NAV_ITEMS.slice(0, 9).forEach((item, index) => {
      expect(NUMBER_ROUTES[String(index + 1)]).toBe(item.to);
    });
    expect(Object.keys(NUMBER_ROUTES)).toHaveLength(Math.min(NAV_ITEMS.length, 9));
  });

  it('maps every g-shortcut to a real rail route', () => {
    for (const [key, route] of Object.entries(GO_TO_ROUTES)) {
      const item = NAV_ITEMS.find((nav) => nav.to === route);
      expect(item, `g ${key} points at ${route}, which is not a rail item`).toBeDefined();
      expect(item?.key).toBe(key);
    }
    expect(Object.keys(GO_TO_ROUTES)).toHaveLength(NAV_ITEMS.length);
  });

  it('reaches every rail route from the command palette', () => {
    const reachable = new Set(
      commands
        .map((command) => command.route)
        .filter((route): route is string => route !== undefined),
    );

    for (const item of NAV_ITEMS) {
      expect(
        reachable.has(item.to),
        `${item.label} (${item.to}) is in the rail but cannot be reached from the palette`,
      ).toBe(true);
    }
  });

  it('advertises the same shortcut in the palette as the keyboard actually binds', () => {
    for (const command of commands) {
      if (!command.shortcut?.startsWith('g ')) continue;
      const letter = command.shortcut.slice(2);
      const target = command.route;
      expect(
        GO_TO_ROUTES[letter],
        `the palette shows "${command.shortcut}" for ${command.title}, but that binding is unset`,
      ).toBe(target);
    }
  });

  it('has a command for every navigate shortcut, so none is undiscoverable', () => {
    const advertised = new Set(
      commands
        .map((command) => command.shortcut)
        .filter((s): s is string => s?.startsWith('g ') === true)
        .map((s) => s.slice(2)),
    );

    for (const key of Object.keys(GO_TO_ROUTES)) {
      expect(
        advertised.has(key),
        `g ${key} works but no palette command mentions it, so nobody will find it`,
      ).toBe(true);
    }
  });
});
