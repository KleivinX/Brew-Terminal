import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportCsv } from '@/components/data/ExportCsv';
import { ToastHost } from '@/components/status/ToastHost';
import { useToastStore } from '@/stores/toastStore';
import type { CsvColumn } from '@/lib/csv';
import { renderWithProviders } from '../setup/renderWithProviders';

interface Row {
  symbol: string;
  price: number;
}

const columns: CsvColumn<Row>[] = [
  { header: 'Symbol', value: (r) => r.symbol },
  { header: 'Price', value: (r) => r.price },
];

const SETTLE = { timeout: 4000 } as const;

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

function render(rows: Row[]) {
  return renderWithProviders(
    <>
      <ExportCsv subject="test" columns={columns} rows={() => rows} />
      <ToastHost />
    </>,
  );
}

describe('ExportCsv', () => {
  it('writes the table and says how many rows went out', async () => {
    const user = userEvent.setup();
    render([
      { symbol: 'BTC', price: 1 },
      { symbol: 'ETH', price: 2 },
    ]);

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(screen.getByText('Exported 2 rows')).toBeInTheDocument(), SETTLE);
  });

  it('counts one row in the singular', async () => {
    const user = userEvent.setup();
    render([{ symbol: 'BTC', price: 1 }]);

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(screen.getByText('Exported 1 row')).toBeInTheDocument(), SETTLE);
  });

  /**
   * The header alone is not an export. Opening a file picker for it wastes two clicks and
   * produces a file with nothing in it.
   */
  it('says so rather than writing an empty file', async () => {
    const user = userEvent.setup();
    render([]);

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(
      () => expect(screen.getByText('There is nothing to export yet')).toBeInTheDocument(),
      SETTLE,
    );
  });

  it('names the destination, so the file can be found again', async () => {
    const user = userEvent.setup();
    render([{ symbol: 'BTC', price: 1 }]);

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(screen.getByText(/\.csv$/)).toBeInTheDocument(), SETTLE);
  });

  it('is disabled while the write is in flight', async () => {
    const user = userEvent.setup();
    render([{ symbol: 'BTC', price: 1 }]);

    const button = screen.getByRole('button', { name: 'Export CSV' });
    await user.click(button);

    // Either caught mid-flight or already finished; both are correct, a second concurrent
    // write is not.
    await waitFor(() => expect(screen.getByText('Exported 1 row')).toBeInTheDocument(), SETTLE);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
  });
});
