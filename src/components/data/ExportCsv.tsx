import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ipc } from '@/lib/ipc';
import { pickCsvLocation } from '@/lib/dialog';
import { csvFilename, toCsv, type CsvColumn } from '@/lib/csv';
import { toast } from '@/stores/toastStore';

/**
 * "Export CSV" for any table on screen.
 *
 * The rows are encoded here rather than in Rust because the column choices belong to the
 * screen showing them — the file should hold what the reader is looking at, not a backend's
 * idea of the same table. The Rust side only writes the text and checks the destination.
 *
 * Callers pass a `rows` thunk instead of the array itself. Building the export is only worth
 * doing when the button is actually pressed, and a screener over a few hundred rows re-mapping
 * every column on every render is exactly the kind of work that never shows up in a profile
 * because it is spread across every keystroke in the filter box.
 */

interface ExportCsvProps<T> {
  /** Becomes `brew-<subject>-<date>.csv`. Lowercase, hyphenated. */
  subject: string;
  columns: CsvColumn<T>[];
  rows: () => T[];
  label?: string | undefined;
  disabled?: boolean | undefined;
}

export function ExportCsv<T>({ subject, columns, rows, label, disabled }: ExportCsvProps<T>) {
  const [busy, setBusy] = useState(false);

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      const data = rows();
      if (data.length === 0) {
        toast.info('There is nothing to export yet');
        return;
      }

      const path = await pickCsvLocation(csvFilename(subject));
      // Cancelling the picker is not a failure and gets no message. A toast saying "cancelled"
      // for something the user just cancelled is noise.
      if (!path) return;

      const result = await ipc('export_csv', { path, csv: toCsv(columns, data) });
      toast.success(`Exported ${result.rows} ${result.rows === 1 ? 'row' : 'rows'}`, {
        detail: result.path,
      });
    } catch {
      /*
       * Deliberately not surfacing the thrown error's text. The failures here are a bad
       * destination or a full disk, and the Rust side has already reduced those to a sentence
       * without the path in it.
       */
      toast.error('Could not write that file', {
        detail: 'Check there is room on the disk and that the folder is writable.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size="sm" variant="secondary" onClick={() => void run()} disabled={disabled || busy}>
      {busy ? 'Exporting…' : (label ?? 'Export CSV')}
    </Button>
  );
}
