import { direction, directionGlyph, directionLabel, formatPercent } from '@/lib/format';
import styles from './ChangeValue.module.css';

interface ChangeValueProps {
  value: number | null;
  /** Used in the accessible label: "24 hour change up 2.41 percent". */
  period: string;
  className?: string | undefined;
}

/**
 * Direction on four channels: colour, glyph, sign, and an accessible label. Colour is never
 * load-bearing on its own — red/green alone fails for a large share of users and looks
 * identical in the Soft theme's muted palette. See UI_MAP.md §6.
 */
export function ChangeValue({ value, period, className }: ChangeValueProps) {
  const dir = direction(value);

  return (
    <span
      className={[styles.change, styles[dir], 'tabular', className].filter(Boolean).join(' ')}
      data-direction={dir}
    >
      <span aria-hidden="true" className={styles.glyph}>
        {directionGlyph(dir)}
      </span>
      <span aria-hidden="true">{formatPercent(value)}</span>
      <span className="visually-hidden">{directionLabel(value, period)}</span>
    </span>
  );
}
