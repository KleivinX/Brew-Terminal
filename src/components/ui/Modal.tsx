import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { focusableWithin } from '@/lib/keyboard';
import { IconButton } from './IconButton';
import styles from './Modal.module.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Wider variant for the command palette. */
  size?: 'sm' | 'md' | 'lg' | undefined;
  /** Hide the visible header when the content provides its own (palette). */
  hideHeader?: boolean | undefined;
}

/**
 * Focus is trapped while open and restored to the trigger on close — otherwise keyboard users
 * are dropped at the top of the document every time a dialog closes.
 */
export function Modal({ open, onClose, title, children, size = 'md', hideHeader }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  /*
   * `onClose` is almost always an inline arrow from the caller, so its identity changes on
   * every render. Depending on it directly made the effect below tear down and re-run on each
   * keystroke: the cleanup restored focus to the element that opened the dialog, so typing a
   * space into a form field activated the trigger button and closed the dialog. Holding it in
   * a ref lets the effect depend on `open` alone and run exactly once per open.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    /*
     * Focus synchronously rather than on the next animation frame. Deferring it opens a
     * window where the dialog is visible but nothing is focused, so a user who presses ⌘K
     * and immediately starts typing loses the first character. The effect already runs after
     * the portal content is in the DOM, so there is nothing to wait for.
     *
     * A form control wins over the plain first focusable: in a dialog with a header close
     * button, "first focusable" is that close button, so opening a form would put Enter on
     * "dismiss" and make the user tab to reach the field they came for.
     */
    const dialog = dialogRef.current;
    if (dialog) {
      const focusable = focusableWithin(dialog);
      const firstField = focusable.find((el) =>
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName),
      );
      (firstField ?? focusable[0] ?? dialog).focus();
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const current = dialogRef.current;
      if (!current) return;
      const focusable = focusableWithin(current);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    /*
      The backdrop is a convenience: Escape closes the dialog and focus is trapped inside it,
      so no interaction depends on clicking here. It carries no role and no accessible content.
    */
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className={styles.overlay} onMouseDown={onClose}>
      {/* Stops a click inside the dialog from reaching the backdrop's close handler. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={[styles.dialog, styles[size]].join(' ')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {hideHeader ? null : (
          <header className={styles.header}>
            <h2 className={styles.title}>{title}</h2>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </header>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
