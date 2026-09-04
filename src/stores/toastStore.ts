import { create } from 'zustand';

/**
 * Transient messages: a save confirmed, a feed that failed, an action that can be undone.
 *
 * Before this existed every panel grew its own inline confirmation state, and each one got the
 * lifecycle slightly wrong. The notes editor is the cautionary tale — its "Saved" flag was
 * cleared by an unrelated re-seed effect, so the confirmation never appeared and the bug was
 * invisible until someone watched the frames. One store with one set of rules replaces nine
 * hand-rolled booleans.
 *
 * The store is deliberately inert: it holds toasts and nothing else. Timers live in the
 * component that renders a toast, because a timer needs to pause when the pointer is over the
 * thing it is about to remove, and that is a rendering concern rather than a state one.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

/** A single button on a toast. `Undo` is the reason this exists, but not the only use. */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface Toast {
  id: string;
  tone: ToastTone;
  /** One line, sentence case, no trailing period. The subject of the message, not a title. */
  message: string;
  /** Optional second line for the part that would make `message` too long to scan. */
  detail?: string | undefined;
  action?: ToastAction | undefined;
  /** Milliseconds before it removes itself. `null` means it stays until dismissed. */
  duration: number | null;
  /**
   * Collapses repeats. A second toast with the same key replaces the first rather than
   * stacking under it, which is what keeps eight simultaneously failing feeds from producing
   * eight identical rows.
   */
  key?: string | undefined;
}

export type ToastInput = Omit<Toast, 'id' | 'duration'> & { duration?: number | null | undefined };

/**
 * How long each tone lives when the caller does not say.
 *
 * An error never auto-dismisses. A failure the user did not happen to be looking at is a
 * failure they do not know about, and this app's whole position is that degraded state gets
 * said out loud rather than swallowed.
 */
const DEFAULT_DURATION: Record<ToastTone, number | null> = {
  info: 5_000,
  success: 4_000,
  warning: 8_000,
  error: null,
};

/**
 * A toast carrying an action gets longer regardless of tone: the countdown is now a deadline
 * for the user to reach the button, not just a reading time. Five seconds is the usual figure
 * for an undo and it is tight for anyone who has to move a pointer across a 27-inch display.
 */
const ACTION_DURATION = 10_000;

/** More than this on screen at once is a wall of text, not a notification. */
export const MAX_TOASTS = 4;

let counter = 0;

function nextId(): string {
  counter += 1;
  return `toast-${counter}`;
}

/**
 * Drops the oldest toast that would go away on its own, and only falls back to the oldest
 * overall when every one on screen is sticky.
 *
 * Without the first pass a burst of routine confirmations would push an error off the top —
 * the one message here that has no other way of being seen.
 */
function makeRoom(toasts: Toast[]): Toast[] {
  if (toasts.length < MAX_TOASTS) return toasts;

  const index = toasts.findIndex((toast) => toast.duration !== null);
  const victim = index === -1 ? 0 : index;
  return toasts.filter((_, i) => i !== victim);
}

interface ToastState {
  toasts: Toast[];
  /** Returns the id, so a caller can dismiss its own toast early. */
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push: (input) => {
    const id = nextId();
    const duration =
      input.duration !== undefined
        ? input.duration
        : input.action
          ? ACTION_DURATION
          : DEFAULT_DURATION[input.tone];

    set((state) => {
      // A keyed repeat replaces its predecessor in place rather than appending, so a feed that
      // fails on every poll updates one row instead of growing a column of identical ones.
      const withoutRepeat = input.key
        ? state.toasts.filter((toast) => toast.key !== input.key)
        : state.toasts;

      return { toasts: [...makeRoom(withoutRepeat), { ...input, id, duration }] };
    });

    return id;
  },

  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),

  clear: () => set({ toasts: [] }),
}));

/**
 * The shorthand callers actually use.
 *
 * Deliberately not a hook: a toast is usually raised from inside a mutation callback or an
 * event handler, where a hook cannot be called, and forcing every caller to hold a
 * `useToast()` result meant threading it through props to reach the place that needed it.
 */
export const toast = {
  info: (message: string, rest: Partial<ToastInput> = {}) =>
    useToastStore.getState().push({ ...rest, tone: 'info', message }),
  success: (message: string, rest: Partial<ToastInput> = {}) =>
    useToastStore.getState().push({ ...rest, tone: 'success', message }),
  warning: (message: string, rest: Partial<ToastInput> = {}) =>
    useToastStore.getState().push({ ...rest, tone: 'warning', message }),
  error: (message: string, rest: Partial<ToastInput> = {}) =>
    useToastStore.getState().push({ ...rest, tone: 'error', message }),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
};
