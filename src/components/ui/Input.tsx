import { forwardRef, type InputHTMLAttributes } from 'react';
import styles from './Input.module.css';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={[styles.input, invalid ? styles.invalid : null, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
});
