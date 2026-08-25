import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// jsdom implements neither of these, and both are load-bearing:
// matchMedia drives prefers-reduced-motion, ResizeObserver drives virtualization.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

/*
 * jsdom does not do layout: every element reports 0x0. @tanstack/react-virtual measures the
 * scroll container to decide how many rows to render, so with real jsdom values it renders
 * none and virtualized tables appear empty to tests. Giving elements a plausible size makes
 * the virtualizer behave as it does in a real viewport.
 */
const VIEWPORT_HEIGHT = 800;
const VIEWPORT_WIDTH = 1200;

for (const [prop, value] of [
  ['clientHeight', VIEWPORT_HEIGHT],
  ['clientWidth', VIEWPORT_WIDTH],
  ['offsetHeight', VIEWPORT_HEIGHT],
  ['offsetWidth', VIEWPORT_WIDTH],
] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get(this: HTMLElement) {
      // Respect an explicit inline size when a test sets one.
      const inline = this.style.getPropertyValue(
        prop.toLowerCase().includes('height') ? 'height' : 'width',
      );
      const parsed = Number.parseFloat(inline);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : value;
    },
  });
}

Element.prototype.getBoundingClientRect = function getBoundingClientRect(this: Element) {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: VIEWPORT_WIDTH,
    bottom: VIEWPORT_HEIGHT,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    toJSON: () => ({}),
  } as DOMRect;
};
