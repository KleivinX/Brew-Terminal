import { useState, type ChangeEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ipc } from '@/lib/ipc';
import { parseCsv } from '@/lib/csv';
import type { Transaction, TransactionKind } from '@/types/domain';
import { errorMessage } from './TransactionDialog';
import styles from './PortfolioRoute.module.css';

/**
 * Many trades at once, from a CSV file.
 *
 * Each row becomes exactly the payload the "Record a trade" dialog builds, and goes through the
 * same `add_transaction` command — so the Rust validation that guards one trade guards every
 * imported one too. Nothing here is a second path into the ledger.
 */

export const IMPORT_COLUMNS = 'date,asset_id,kind,quantity,unit_price,currency,fee,symbol,note';
const REQUIRED = ['date', 'asset_id', 'kind', 'quantity', 'unit_price', 'currency'];
const MAX_ROWS = 2_000;
const MAX_BYTES = 1024 * 1024;

export interface ImportProblem {
  /** Data row, 1-based, not counting the header. */
  row: number;
  message: string;
}

export interface ParsedImport {
  ready: { row: number; tx: Transaction }[];
  problems: ImportProblem[];
}

function rowProblem(tx: Transaction, date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(tx.executedAt)) {
    return 'Date must be YYYY-MM-DD.';
  }
  if (tx.assetId === '') return 'Asset id is empty.';
  if (tx.kind !== 'buy' && tx.kind !== 'sell') return 'Kind must be buy or sell.';
  if (!Number.isFinite(tx.quantity) || tx.quantity <= 0) return 'Quantity must be positive.';
  if (!Number.isFinite(tx.unitPrice) || tx.unitPrice < 0) return 'Price cannot be negative.';
  if (!Number.isFinite(tx.fee) || tx.fee < 0) return 'Fee cannot be negative.';
  if (!/^[A-Z]{3}$/.test(tx.currency)) return 'Currency must be a three-letter code.';
  return null;
}

/**
 * Reads the file into trades and per-row problems, without touching the ledger.
 *
 * Numbers are read with `Number()` and nothing cleverer: `1,234.50` is reported, not guessed
 * at, because a locale guessed wrong turns a thousand into one.
 */
export function parseTransactions(text: string): ParsedImport {
  const [header, ...rows] = parseCsv(text);
  if (!header) return { ready: [], problems: [{ row: 0, message: 'The file is empty.' }] };

  const index = new Map(
    header.map((name, i) => [
      name
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_'),
      i,
    ]),
  );
  const missing = REQUIRED.filter((name) => !index.has(name));
  if (missing.length > 0) {
    return { ready: [], problems: [{ row: 0, message: `Missing column: ${missing.join(', ')}.` }] };
  }
  if (rows.length > MAX_ROWS) {
    return {
      ready: [],
      problems: [{ row: 0, message: `More than ${MAX_ROWS} rows — split the file.` }],
    };
  }

  const out: ParsedImport = { ready: [], problems: [] };
  rows.forEach((cells, i) => {
    const get = (name: string): string => (cells[index.get(name) ?? -1] ?? '').trim();
    const date = get('date');
    const assetId = get('asset_id');
    const fee = get('fee');
    const tx: Transaction = {
      id: '',
      assetId,
      symbol: get('symbol') || assetId.split(':').pop() || assetId,
      kind: get('kind').toLowerCase() as TransactionKind,
      quantity: Number(get('quantity')),
      unitPrice: Number(get('unit_price')),
      fee: fee === '' ? 0 : Number(fee),
      currency: get('currency').toUpperCase(),
      // Midday UTC, as the dialog does, so a date does not slide a day in western timezones.
      executedAt: Math.floor(Date.parse(`${date}T12:00:00Z`) / 1000),
      note: get('note') || null,
      createdAt: 0,
    };
    const problem = rowProblem(tx, date);
    if (problem) out.problems.push({ row: i + 1, message: problem });
    else out.ready.push({ row: i + 1, tx });
  });
  return out;
}

interface ImportTransactionsProps {
  onClose: () => void;
  onImported: () => void;
}

export function ImportTransactions({ onClose, onImported }: ImportTransactionsProps) {
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [result, setResult] = useState<{ imported: number; failed: ImportProblem[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    setResult(null);
    if (!file) return setParsed(null);
    if (file.size > MAX_BYTES) {
      setParsed({ ready: [], problems: [{ row: 0, message: 'That file is larger than 1 MB.' }] });
      return;
    }
    setParsed(parseTransactions(await file.text()));
  };

  const run = async (): Promise<void> => {
    if (!parsed) return;
    setBusy(true);
    const failed: ImportProblem[] = [];
    let imported = 0;
    // One at a time, so a partial failure still says exactly which rows landed.
    for (const { row, tx } of parsed.ready) {
      try {
        await ipc('add_transaction', { transaction: tx });
        imported++;
      } catch (error) {
        failed.push({ row, message: errorMessage(error) });
      }
    }
    setBusy(false);
    setResult({ imported, failed });
    if (imported > 0) onImported();
  };

  const problems = result ? result.failed : (parsed?.problems ?? []);

  return (
    <Modal open onClose={onClose} title="Import trades from CSV">
      <div className={styles.form}>
        <p className={styles.hint}>
          One trade per row, with a header row. Required columns: date (YYYY-MM-DD), asset_id, kind
          (buy or sell), quantity, unit_price, currency. Optional: fee, symbol, note.
        </p>
        <code className={styles.hint}>{IMPORT_COLUMNS}</code>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="tx-import-file">
            CSV file
          </label>
          <input
            id="tx-import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void onFile(event)}
          />
        </div>

        <p role="status" className={styles.hint}>
          {result
            ? `Imported ${result.imported} of ${parsed?.ready.length ?? 0} trades.`
            : parsed
              ? `${parsed.ready.length} ready · ${parsed.problems.length} with problems. Importing the same file twice records its trades twice.`
              : null}
        </p>

        {problems.length > 0 ? (
          <ul className={styles.formError} aria-label="Rows with problems">
            {problems.slice(0, 20).map((p) => (
              <li key={`${p.row}-${p.message}`}>
                {p.row > 0 ? `Row ${p.row}: ` : ''}
                {p.message}
              </li>
            ))}
            {problems.length > 20 ? <li>…and {problems.length - 20} more.</li> : null}
          </ul>
        ) : null}

        <div className={styles.formActions}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {result ? 'Done' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void run()}
            disabled={busy || result !== null || !parsed || parsed.ready.length === 0}
          >
            {busy ? 'Importing…' : `Import ${parsed?.ready.length ?? 0} trades`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
