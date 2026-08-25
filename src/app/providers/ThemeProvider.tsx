import { createContext, use, useCallback, useEffect, type ReactNode } from 'react';
import { usePreferences, useSetPreference } from '@/lib/preferences';
import type { MotionPreference, Theme } from '@/types/domain';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  motion: MotionPreference;
  setMotion: (motion: MotionPreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const THEMES: readonly Theme[] = ['dark', 'light', 'soft'] as const;

export const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  soft: 'Soft',
};

export const THEME_DESCRIPTIONS: Record<Theme, string> = {
  dark: 'Terminal focus. Near-black background, warm highlights.',
  light: 'Daylight research. Warm white surfaces, restrained accents.',
  soft: 'Eye comfort. Muted charcoal and amber, lower contrast.',
};

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    // Mirrored so index.html can paint the right background on the first frame,
    // before any IPC round trip completes. SQLite remains the source of truth.
    localStorage.setItem('brew.theme', theme);
  } catch {
    /* localStorage unavailable — the app still works, it just flashes on next launch. */
  }
}

function applyMotion(motion: MotionPreference): void {
  if (motion === 'system') {
    document.documentElement.removeAttribute('data-motion');
  } else {
    document.documentElement.setAttribute('data-motion', motion === 'never' ? 'none' : 'always');
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data: preferences } = usePreferences();
  const setPreference = useSetPreference();

  const theme = preferences?.theme ?? 'dark';
  const motion = preferences?.reducedMotion ?? 'system';

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyMotion(motion);
  }, [motion]);

  const setTheme = useCallback(
    (next: Theme) => {
      // Applied before the mutation resolves so the change is instant; the optimistic
      // update in useSetPreference keeps the query cache in step.
      applyTheme(next);
      setPreference.mutate({ key: 'theme', value: next });
    },
    [setPreference],
  );

  const setMotion = useCallback(
    (next: MotionPreference) => {
      applyMotion(next);
      setPreference.mutate({ key: 'reducedMotion', value: next });
    },
    [setPreference],
  );

  return <ThemeContext value={{ theme, setTheme, motion, setMotion }}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside a ThemeProvider.');
  }
  return context;
}
