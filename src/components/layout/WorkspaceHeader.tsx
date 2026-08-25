import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { shortcutLabel } from '@/lib/keyboard';
import { usePaletteStore } from '@/stores/paletteStore';
import styles from './WorkspaceHeader.module.css';

interface WorkspaceHeaderProps {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode | undefined;
}

export function WorkspaceHeader({ title, subtitle, actions }: WorkspaceHeaderProps) {
  const openPalette = usePaletteStore((s) => s.openPalette);

  return (
    <header className={styles.header}>
      <div className={styles.titles}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </div>

      <div className={styles.actions}>
        {actions}
        <button type="button" className={styles.paletteHint} onClick={() => openPalette()}>
          <Icon name="search" size={13} />
          <span>Search or run a command</span>
          <kbd className={styles.kbd}>{shortcutLabel('Mod+K')}</kbd>
        </button>
      </div>
    </header>
  );
}
