import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './IconButton.module.css';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required: an icon-only control always needs an accessible name. */
  label: string;
  size?: number | undefined;
}

export function IconButton({ icon, label, size = 16, className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={[styles.iconButton, className].filter(Boolean).join(' ')}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
