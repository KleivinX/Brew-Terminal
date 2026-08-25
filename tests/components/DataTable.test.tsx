import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from '@/components/data/DataTable';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

interface Row {
  id: string;
  symbol: string;
  price: number;
}

const rows: Row[] = [
  { id: 'a', symbol: 'BTC', price: 61240 },
  { id: 'b', symbol: 'ETH', price: 3128 },
  { id: 'c', symbol: 'SOL', price: 142 },
];

const columns: Column<Row>[] = [
  {
    id: 'symbol',
    header: 'Asset',
    width: '1fr',
    sortable: true,
    sortValue: (row) => row.symbol,
    render: (row) => <span>{row.symbol}</span>,
  },
  {
    id: 'price',
    header: 'Price',
    width: '1fr',
    align: 'right',
    sortable: true,
    sortValue: (row) => row.price,
    render: (row) => <span>{row.price}</span>,
    cellLabel: (row) => `Price ${row.price}`,
  },
];

function setup(overrides: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      label="Test table"
      {...overrides}
    />,
  );
}

describe('DataTable', () => {
  it('renders as a grid with the full row count', () => {
    setup();
    const grid = screen.getByRole('grid', { name: 'Test table' });
    // aria-rowcount reports the real total even though only the visible window is in the DOM.
    expect(grid).toHaveAttribute('aria-rowcount', '3');
  });

  it('renders the empty state instead of an empty grid', () => {
    setup({ rows: [], emptyState: <p>Nothing here yet</p> });
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('sorts on header click and reports the direction to assistive tech', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: /Price/ }));
    const header = screen.getByRole('columnheader', { name: /Price/ });
    expect(header).toHaveAttribute('aria-sort', 'descending');

    await user.click(screen.getByRole('button', { name: /Price/ }));
    expect(screen.getByRole('columnheader', { name: /Price/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('moves selection with arrow keys and vim keys', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    setup({ onSelectedKeyChange: onSelect });

    const grid = screen.getByRole('grid');
    grid.focus();

    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenCalledWith('a');

    await user.keyboard('j');
    expect(onSelect).toHaveBeenCalled();
  });

  it('activates the selected row on Enter', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    setup({ selectedKey: 'b', onActivate });

    screen.getByRole('grid').focus();
    await user.keyboard('{Enter}');

    expect(onActivate).toHaveBeenCalledWith(rows[1]);
  });

  it('does not hijack single-letter keys while typing in an input', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <div>
        <input aria-label="search" />
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          label="Test table"
          onSelectedKeyChange={onSelect}
        />
      </div>,
    );

    // Typing "jk" into a search box must not scroll the table.
    await user.click(screen.getByLabelText('search'));
    await user.keyboard('jk');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('provides text alternatives for visually-rendered cells', () => {
    setup();
    expect(screen.getByText('Price 61240')).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = setup();
    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
