import { useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { isPrimaryModifier, isTypingTarget } from '@/lib/keyboard';
import { usePaletteStore } from '@/stores/paletteStore';

const GO_TO_ROUTES: Record<string, string> = {
  p: '/pulse',
  r: '/research',
  l: '/learn',
  d: '/desk',
  s: '/settings',
};

const NUMBER_ROUTES: Record<string, string> = {
  '1': '/pulse',
  '2': '/research',
  '3': '/learn',
  '4': '/desk',
  '5': '/settings',
};

/** How long a `g` prefix stays armed before it is forgotten. */
const SEQUENCE_TIMEOUT_MS = 900;

/**
 * Global keyboard shortcuts.
 *
 * Single-letter bindings are suppressed while a text input has focus — otherwise typing "go"
 * into a search box would navigate away mid-word.
 */
export function KeyboardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const togglePalette = usePaletteStore((s) => s.togglePalette);
  const pendingSequence = useRef<string | null>(null);
  const sequenceTimer = useRef<number | null>(null);

  useEffect(() => {
    const clearSequence = (): void => {
      pendingSequence.current = null;
      if (sequenceTimer.current !== null) {
        window.clearTimeout(sequenceTimer.current);
        sequenceTimer.current = null;
      }
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const typing = isTypingTarget(event.target);

      // Mod+K works everywhere, including inside inputs — it is the way out of anywhere.
      if (isPrimaryModifier(event) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        togglePalette();
        return;
      }

      if (isPrimaryModifier(event) && event.key.toLowerCase() === 'r') {
        // Refresh visible data, never a full webview reload.
        event.preventDefault();
        void queryClient.invalidateQueries();
        return;
      }

      if (isPrimaryModifier(event) && NUMBER_ROUTES[event.key]) {
        event.preventDefault();
        void navigate(NUMBER_ROUTES[event.key] as string);
        return;
      }

      if (typing) return;

      if (pendingSequence.current === 'g') {
        const target = GO_TO_ROUTES[event.key.toLowerCase()];
        clearSequence();
        if (target) {
          event.preventDefault();
          void navigate(target);
        }
        return;
      }

      if (event.key === 'g' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        pendingSequence.current = 'g';
        sequenceTimer.current = window.setTimeout(clearSequence, SEQUENCE_TIMEOUT_MS);
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        void navigate('/settings/about');
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearSequence();
    };
  }, [navigate, queryClient, togglePalette]);

  return <>{children}</>;
}
