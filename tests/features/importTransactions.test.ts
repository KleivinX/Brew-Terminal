import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '@/lib/csv';
import { parseTransactions } from '@/features/portfolio/ImportTransactions';

describe('transaction CSV import', () => {
  it('parses what toCsv writes, including quotes, commas and newlines', () => {
    const rows = [{ a: 'plain', b: 'has, comma and "quotes"\nand a newline' }];
    const csv = toCsv(
      [
        { header: 'a', value: (r: (typeof rows)[number]) => r.a },
        { header: 'b', value: (r: (typeof rows)[number]) => r.b },
      ],
      rows,
    );
    expect(parseCsv(csv)).toEqual([
      ['a', 'b'],
      ['plain', rows[0]!.b],
    ]);
  });

  it('builds the same payload the dialog does, and reports bad rows by number', () => {
    const file =
      '﻿Date,Asset ID,Kind,Quantity,Unit Price,Currency,Fee,Note\r\n' +
      '2026-03-14,stock:us:AAPL,BUY,2,150.5,usd,,"bought, finally"\r\n' +
      '\r\n' +
      '2026-03-15,crypto:cg:bitcoin,sell,-1,60000,USD,1,\r\n' +
      '14/03/2026,stock:us:AAPL,buy,1,1,USD,0,\r\n' +
      '2026-03-16,stock:us:MSFT,buy,"1,000",1,USD,0,\r\n';

    const { ready, problems } = parseTransactions(file);

    expect(ready).toHaveLength(1);
    expect(ready[0]!.tx).toMatchObject({
      assetId: 'stock:us:AAPL',
      symbol: 'AAPL',
      kind: 'buy',
      quantity: 2,
      unitPrice: 150.5,
      fee: 0,
      currency: 'USD',
      executedAt: Date.parse('2026-03-14T12:00:00Z') / 1000,
      note: 'bought, finally',
    });
    expect(problems).toEqual([
      { row: 2, message: 'Quantity must be positive.' },
      { row: 3, message: 'Date must be YYYY-MM-DD.' },
      { row: 4, message: 'Quantity must be positive.' },
    ]);
  });

  it('refuses a file missing a required column before reading any row', () => {
    expect(parseTransactions('date,asset_id,kind,quantity\n2026-01-01,x,buy,1').problems).toEqual([
      { row: 0, message: 'Missing column: unit_price, currency.' },
    ]);
  });
});
