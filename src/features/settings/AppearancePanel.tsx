import { Panel } from '@/components/ui/Panel';
import { Toggle } from '@/components/ui/Toggle';
import { Icon } from '@/components/ui/Icon';
import { THEMES, THEME_DESCRIPTIONS, THEME_LABELS, useTheme } from '@/app/providers/ThemeProvider';
import { usePreferences, useSetPreference } from '@/lib/preferences';
import styles from './AppearancePanel.module.css';

export function AppearancePanel() {
  const { theme, setTheme, motion, setMotion } = useTheme();
  const { data: preferences } = usePreferences();
  const setPreference = useSetPreference();

  return (
    <div className={styles.stack}>
      <Panel title="Theme">
        <div className={styles.themes} role="radiogroup" aria-label="Theme">
          {THEMES.map((option) => {
            const selected = option === theme;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setTheme(option)}
                className={[styles.theme, selected ? styles.themeSelected : null]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className={styles.swatchRow} aria-hidden="true">
                  <span className={[styles.swatch, styles[`swatch_${option}_bg`]].join(' ')} />
                  <span className={[styles.swatch, styles[`swatch_${option}_surface`]].join(' ')} />
                  <span className={[styles.swatch, styles[`swatch_${option}_accent`]].join(' ')} />
                </span>
                <span className={styles.themeName}>
                  {THEME_LABELS[option]}
                  {selected ? <Icon name="check" size={13} /> : null}
                </span>
                <span className={styles.themeDescription}>{THEME_DESCRIPTIONS[option]}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="Motion and layout">
        <div className={styles.settings}>
          <Toggle
            label="Reduce motion"
            description="Removes transitions and the loading shimmer. Your system setting is respected by default; this forces it on."
            checked={motion === 'never'}
            onChange={(checked) => setMotion(checked ? 'never' : 'system')}
          />
          <Toggle
            label="Expand the navigation rail"
            description="Show labels beside the navigation icons."
            checked={preferences?.navRailExpanded ?? false}
            onChange={(checked) => setPreference.mutate({ key: 'navRailExpanded', value: checked })}
          />
        </div>
      </Panel>
    </div>
  );
}
