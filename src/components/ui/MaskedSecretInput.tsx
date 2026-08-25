import { useId, useState } from 'react';
import { Button } from './Button';
import { Input } from './Input';
import styles from './MaskedSecretInput.module.css';

interface MaskedSecretInputProps {
  label: string;
  /** Shown instead of the field once a key is stored. Never the key itself. */
  storedHint: string | null;
  placeholder?: string;
  helpText?: string;
  saving?: boolean;
  onSave: (value: string) => void;
  onRemove: () => void;
}

/**
 * Entry field for an API key.
 *
 * Once saved, the value is gone from the UI for good: the app can only ever retrieve a masked
 * hint, so there is nothing to reveal. The field is `type="password"` with autocomplete off so
 * a password manager does not offer to store it and a screen recording does not capture it.
 */
export function MaskedSecretInput({
  label,
  storedHint,
  placeholder,
  helpText,
  saving,
  onSave,
  onRemove,
}: MaskedSecretInputProps) {
  const id = useId();
  const [value, setValue] = useState('');

  if (storedHint) {
    return (
      <div className={styles.stored}>
        <div className={styles.storedText}>
          <span className={styles.label}>{label}</span>
          <code className={styles.hint}>{storedHint}</code>
          <span className={styles.note}>
            Stored in your system keychain. It cannot be shown again — replace it by removing this
            one and entering a new key.
          </span>
        </div>
        <Button variant="danger" size="sm" onClick={onRemove}>
          Remove key
        </Button>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (!trimmed) return;
        onSave(trimmed);
        setValue('');
      }}
    >
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <div className={styles.row}>
        <Input
          id={id}
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder ?? 'Paste your API key'}
          autoComplete="off"
          spellCheck={false}
          data-1p-ignore
        />
        <Button variant="primary" type="submit" disabled={!value.trim() || saving}>
          {saving ? 'Saving…' : 'Save key'}
        </Button>
      </div>
      {helpText ? <p className={styles.help}>{helpText}</p> : null}
    </form>
  );
}
