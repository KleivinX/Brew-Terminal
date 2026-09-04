import { describe, expect, it } from 'vitest';
import { csvFilename, toCsv, type CsvColumn } from '@/lib/csv';

interface Row {
  symbol: string;
  price: number | null;
  note: string;
}

const columns: CsvColumn<Row>[] = [
  { header: 'Symbol', value: (r) => r.symbol },
  { header: 'Price', value: (r) => r.price },
  { header: 'Note', value: (r) => r.note },
];

function lines(rows: Row[]): string[] {
  return toCsv(columns, rows).split('\r\n');
}

describe('toCsv', () => {
  it('writes a header and one line per row', () => {
    const out = lines([
      { symbol: 'BTC', price: 77431, note: 'held' },
      { symbol: 'ETH', price: 4120, note: 'watching' },
    ]);

    expect(out[0]).toBe('Symbol,Price,Note');
    expect(out[1]).toBe('BTC,77431,held');
    expect(out).toHaveLength(3);
  });

  it('leaves a missing figure as an empty cell rather than inventing a zero', () => {
    // The same rule the app follows on screen: a provider that did not report a number has
    // not reported zero.
    expect(lines([{ symbol: 'X', price: null, note: '' }])[1]).toBe('X,,');
  });

  it('quotes a cell containing a comma, a quote or a newline', () => {
    const out = lines([{ symbol: 'A', price: 1, note: 'one, two' }]);
    expect(out[1]).toBe('A,1,"one, two"');

    expect(lines([{ symbol: 'A', price: 1, note: 'he said "no"' }])[1]).toBe(
      'A,1,"he said ""no"""',
    );
    expect(lines([{ symbol: 'A', price: 1, note: 'line\nbreak' }])[1]).toBe('A,1,"line\nbreak"');
  });

  it('uses CRLF, which is what RFC 4180 and Excel expect', () => {
    expect(toCsv(columns, [{ symbol: 'A', price: 1, note: 'b' }])).toContain('\r\n');
  });
});

describe('formula injection', () => {
  /**
   * The reason this guard exists. Headlines come from news feeds and note bodies are whatever
   * was typed; either can begin with `=`, and a spreadsheet will run it on open.
   */
  it('neutralises a cell a spreadsheet would evaluate', () => {
    expect(lines([{ symbol: 'A', price: 1, note: '=HYPERLINK("http://x","click")' }])[1]).toContain(
      "'=HYPERLINK",
    );
    expect(lines([{ symbol: 'A', price: 1, note: '@SUM(1,2)' }])[1]).toContain("'@SUM");
  });

  /**
   * The other half, and the one a naive guard gets wrong: prefixing every cell that starts
   * with a minus corrupts every loss in a finance export.
   */
  it('leaves a negative number alone', () => {
    expect(lines([{ symbol: 'A', price: -412.5, note: '-8.4%' }])[1]).toBe('A,-412.5,-8.4%');
    expect(lines([{ symbol: 'A', price: 1, note: '-0.00031' }])[1]).toBe('A,1,-0.00031');
  });

  it('still guards a leading minus that is not a number', () => {
    expect(lines([{ symbol: 'A', price: 1, note: '-1+cmd|calc' }])[1]).toContain("'-1+cmd");
  });

  it('leaves a signed percentage alone', () => {
    expect(lines([{ symbol: 'A', price: 1, note: '+2.5' }])[1]).toBe('A,1,+2.5');
  });

  it('does not guard a number that merely renders negative', () => {
    // Numbers never pass through the guard at all — the type is the signal.
    expect(lines([{ symbol: 'A', price: -1, note: 'x' }])[1]).toBe('A,-1,x');
  });
});

describe('csvFilename', () => {
  it('dates the file so successive exports do not overwrite', () => {
    expect(csvFilename('portfolio', new Date('2026-09-04T10:00:00Z'))).toBe(
      'brew-portfolio-2026-09-04.csv',
    );
  });
});
