/**
 * CSV encoding for the export buttons.
 *
 * RFC 4180 quoting, plus a guard against the thing CSV exports are famous for: a cell that a
 * spreadsheet reads as a formula rather than as text. A headline beginning `=` is not
 * hypothetical — it arrives from news feeds, and note bodies are whatever the user typed.
 */

export interface CsvColumn<T> {
  header: string;
  /** Numbers are written unquoted and unguarded; `null` and `undefined` become empty cells. */
  value: (row: T) => string | number | null | undefined;
}

/**
 * Characters a spreadsheet treats as the start of a formula.
 *
 * `+` and `-` are deliberately not in this set. They are formula triggers too, but in a
 * finance export the overwhelming majority of cells starting with one are ordinary negative
 * numbers and signed percentages, and prefixing those would corrupt every loss in the file to
 * fix a risk that `=` already covers. A leading `-` followed by anything non-numeric is caught
 * by the check below instead.
 */
const FORMULA_STARTS = ['=', '@', '\t', '\r'];

/**
 * Whether a cell is a figure rather than text that merely starts like one.
 *
 * Thousands separators and a trailing percent are stripped first, because the shapes this
 * export actually produces are `-412.50`, `-8.4%` and `+2.5` — and a plain `Number()` call
 * rejects two of the three, which would put an apostrophe in front of every percentage change
 * in the file.
 */
function looksNumeric(value: string): boolean {
  const bare = value.trim().replace(/,/g, '').replace(/%$/, '');
  return bare !== '' && Number.isFinite(Number(bare));
}

/**
 * Neutralises a cell a spreadsheet would evaluate.
 *
 * The leading apostrophe is the conventional escape: Excel and Sheets both read it as "this is
 * text" and do not display it. It changes the bytes on disk, which is the trade — a file that
 * round-trips perfectly and runs `=HYPERLINK(...)` on open is the worse outcome.
 */
function guardFormula(value: string): string {
  if (value === '') return value;

  const dangerous =
    FORMULA_STARTS.some((start) => value.startsWith(start)) ||
    ((value.startsWith('+') || value.startsWith('-')) && !looksNumeric(value));

  return dangerous ? `'${value}` : value;
}

/** RFC 4180: quote when the cell contains a delimiter, a quote or a newline; double the quotes. */
function quote(value: string): string {
  if (!/[",\r\n]/.test(value) && value.trim() === value) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function cell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  // A number is emitted as-is. Routing it through the formula guard would put an apostrophe in
  // front of every negative figure in the file.
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : '';
  return quote(guardFormula(raw));
}

/**
 * Rows and a header, joined with CRLF.
 *
 * CRLF rather than LF because that is what RFC 4180 specifies and what Excel on Windows
 * expects; every tool that reads LF reads CRLF too.
 */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const lines = [columns.map((column) => cell(column.header)).join(',')];

  for (const row of rows) {
    lines.push(columns.map((column) => cell(column.value(row))).join(','));
  }

  return lines.join('\r\n');
}

/** `brew-portfolio-2026-09-04.csv` — dated, so successive exports do not overwrite. */
export function csvFilename(subject: string, at: Date = new Date()): string {
  const date = at.toISOString().slice(0, 10);
  return `brew-${subject}-${date}.csv`;
}
