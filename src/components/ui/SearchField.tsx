import { forwardRef, type InputHTMLAttributes } from 'react';
import { Icon } from './Icon';
import styles from './SearchField.module.css';

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { label, className, ...rest },
  ref,
) {
  return (
    <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
      <Icon name="search" size={14} className={styles.icon} />
      <input ref={ref} type="search" aria-label={label} className={styles.input} {...rest} />
    </div>
  );
});
