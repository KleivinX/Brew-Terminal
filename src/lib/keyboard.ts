/**
 * Keyboard utilities.
 *
 * Single-letter shortcuts are a real hazard in an app with text inputs; every consumer here
 * routes through `isTypingTarget` rather than remembering to check.
 */

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}

/** The platform-correct primary modifier: ⌘ on macOS, Ctrl elsewhere. */
export function isPrimaryModifier(event: KeyboardEvent | React.KeyboardEvent): boolean {
  return isMac() ? event.metaKey : event.ctrlKey;
}

/** True when the event originated in something the user is typing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'textbox'
  );
}

/** Human-readable shortcut label: "⌘K" on macOS, "Ctrl K" elsewhere. */
export function shortcutLabel(keys: string): string {
  if (isMac()) {
    return keys
      .replace(/Mod\+/g, '⌘')
      .replace(/Shift\+/g, '⇧')
      .replace(/Alt\+/g, '⌥');
  }
  return keys
    .replace(/Mod\+/g, 'Ctrl ')
    .replace(/Shift\+/g, 'Shift ')
    .replace(/Alt\+/g, 'Alt ');
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Focusable descendants, in document order.
 *
 * Visibility is checked with `checkVisibility()` rather than `offsetParent`: an element inside
 * a `position: fixed` ancestor (every modal in this app) can report a null offsetParent in
 * some engines, which would silently empty the focus trap. Where `checkVisibility` is
 * unavailable, we include the element rather than dropping it — over-including a hidden
 * element costs a stray tab stop, whereas under-including breaks the trap entirely.
 */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
    if (el === document.activeElement) return true;
    return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
  });
}
