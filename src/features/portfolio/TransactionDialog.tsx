import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ipc } from '@/lib/ipc';
import type { Transaction, TransactionKind } from '@/types/domain';
import styles from './PortfolioRoute.module.css';

interface TransactionDialogProps {
  /** Present when editing; absent when recording a new trade. */
  transaction?: Transaction | undefined;
  onClose: () => void;
  onSaved: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'That could not be saved.';
}

export function TransactionDialog({ transaction, onClose, onSaved }: TransactionDialogProps) {
  const editing = transaction !== undefined;

  const [assetId, setAssetId] = useState(transaction?.assetId ?? '');
  const [symbol, setSymbol] = useState(transaction?.symbol ?? '');
  const [kind, setKind] = useState<TransactionKind>(transaction?.kind ?? 'buy');
  const [quantity, setQuantity] = useState(transaction ? String(transaction.quantity) : '');
  const [unitPrice, setUnitPrice] = useState(transaction ? String(transaction.unitPrice) : '');
  const [fee, setFee] = useState(transaction ? String(transaction.fee) : '0');
  const [currency, setCurrency] = useState(transaction?.currency ?? 'USD');
  const [date, setDate] = useState(
    transaction ? new Date(transaction.executedAt * 1000).toISOString().slice(0, 10) : todayIso(),
  );
  const [note, setNote] = useState(transaction?.note ?? '');
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (payload: Transaction) =>
      editing
        ? ipc('update_transaction', { transaction: payload })
        : ipc('add_transaction', { transaction: payload }),
    onSuccess: onSaved,
    onError: (error) => setFormError(errorMessage(error)),
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setFormError(null);

    const payload: Transaction = {
      id: transaction?.id ?? '',
      assetId: assetId.trim(),
      // Falling back to the id keeps a row renderable even if the label is left blank.
      symbol: symbol.trim() || assetId.trim().split(':').pop() || assetId.trim(),
      kind,
      quantity: Number(quantity),
      unitPrice: Number(unitPrice),
      fee: Number(fee || 0),
      currency: currency.trim().toUpperCase(),
      // Midday UTC, so a date does not slide to the previous day in western timezones.
      executedAt: Math.floor(new Date(`${date}T12:00:00Z`).getTime() / 1000),
      note: note.trim() === '' ? null : note.trim(),
      createdAt: transaction?.createdAt ?? 0,
    };

    if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) {
      setFormError('Quantity must be a positive number.');
      return;
    }
    if (!Number.isFinite(payload.unitPrice) || payload.unitPrice < 0) {
      setFormError('Price cannot be negative.');
      return;
    }

    save.mutate(payload);
  };

  return (
    <Modal open onClose={onClose} title={editing ? 'Edit trade' : 'Record a trade'}>
      <form className={styles.form} onSubmit={onSubmit}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Direction</legend>
          <div className={styles.radios}>
            {(['buy', 'sell'] as const).map((option) => (
              <label key={option} className={styles.radio}>
                <input
                  type="radio"
                  name="tx-kind"
                  value={option}
                  checked={kind === option}
                  onChange={() => setKind(option)}
                />
                {option === 'buy' ? 'Buy' : 'Sell'}
              </label>
            ))}
          </div>
        </fieldset>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="tx-asset">
            Asset id
          </label>
          <Input
            id="tx-asset"
            value={assetId}
            onChange={(e) => setAssetId(e.target.value)}
            placeholder="crypto:cg:bitcoin"
            spellCheck={false}
            autoComplete="off"
            required
          />
          <p className={styles.hint}>
            The canonical id, as shown on an asset page. Copy it from Research.
          </p>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="tx-symbol">
            Label (optional)
          </label>
          <Input
            id="tx-symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="BTC"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tx-quantity">
              Quantity
            </label>
            <Input
              id="tx-quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              placeholder="0.5"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="tx-price">
              Price per unit
            </label>
            <Input
              id="tx-price"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              inputMode="decimal"
              placeholder="43000"
              required
            />
          </div>
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tx-fee">
              Fee
            </label>
            <Input
              id="tx-fee"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              inputMode="decimal"
            />
            <p className={styles.hint}>Added to cost on a buy, deducted from proceeds on a sell.</p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="tx-currency">
              Currency
            </label>
            <Input
              id="tx-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              maxLength={3}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="tx-date">
            Date
          </label>
          <Input
            id="tx-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="tx-note">
            Note (optional)
          </label>
          <Input
            id="tx-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why you made this trade"
          />
        </div>

        {formError ? (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        ) : null}

        <div className={styles.formActions}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Record trade'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
