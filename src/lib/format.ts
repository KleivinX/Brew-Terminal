/**
 * Formatting helpers.
 *
 * Built on `Intl` rather than a date/number library — see DEPENDENCIES.md. Formatters are
 * memoised because constructing an `Intl.NumberFormat` is comparatively expensive and a table
 * re-render calls these hundreds of times.
 */

const numberFormatters = new Map<string, Intl.NumberFormat>();

function formatter(key: string, build: () => Intl.NumberFormat): Intl.NumberFormat {
  let f = numberFormatters.get(key);
  if (!f) {
    f = build();
    numberFormatters.set(key, f);
  }
  return f;
}

/**
 * Prices need adaptive precision: $61,240.55 and $0.000042 are both legitimate.
 * Fixed decimal places would render one of them useless.
 */
export function formatPrice(value: number, currency = 'USD', locale?: string): string {
  if (!Number.isFinite(value)) return '—';

  const abs = Math.abs(value);
  let digits: number;
  if (abs >= 1000) digits = 2;
  else if (abs >= 1) digits = 2;
  else if (abs >= 0.01) digits = 4;
  else if (abs >= 0.0001) digits = 6;
  else digits = 8;

  return formatter(
    `price:${currency}:${digits}:${locale ?? ''}`,
    () =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }),
  ).format(value);
}

/** Compact notation for market cap and volume: 1.21T, 28.4B, 412M. */
export function formatCompact(value: number | null, locale?: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return formatter(
    `compact:${locale ?? ''}`,
    () =>
      new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 2,
      }),
  ).format(value);
}

/**
 * Percent change, always signed. The sign is not decoration — it is one of the
 * non-colour channels carrying direction. See UI_MAP.md §6.
 */
export function formatPercent(value: number | null, locale?: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const formatted = formatter(
    `pct:${locale ?? ''}`,
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        signDisplay: 'always',
      }),
  ).format(value);
  return `${formatted}%`;
}

export type Direction = 'up' | 'down' | 'flat';

export function direction(value: number | null): Direction {
  if (value === null || !Number.isFinite(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

/** The glyph channel. Paired with sign and label so colour is never the only signal. */
export function directionGlyph(dir: Direction): string {
  return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';
}

/** The screen-reader channel. "up 2.41 percent" reads better than "▲ +2.41%". */
export function directionLabel(value: number | null, period: string): string {
  // `period` already reads as a full phrase ("24 hour change"), so appending "change"
  // here produced "24 hour change change unavailable".
  if (value === null || !Number.isFinite(value)) return `${period} unavailable`;
  const dir = direction(value);
  const word = dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'unchanged';
  if (dir === 'flat') return `${period} unchanged`;
  return `${period} ${word} ${Math.abs(value).toFixed(2)} percent`;
}

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

/**
 * Relative time from a Unix-seconds timestamp. `now` is injectable so tests run against a
 * frozen clock instead of racing the real one.
 */
export function formatRelativeTime(
  epochSeconds: number,
  now: number = Date.now(),
  locale?: string,
): string {
  const key = locale ?? '';
  let rtf = relativeFormatters.get(key);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'narrow' });
    relativeFormatters.set(key, rtf);
  }

  const deltaSeconds = Math.round(epochSeconds - now / 1000);
  const abs = Math.abs(deltaSeconds);

  if (abs < 45) return rtf.format(deltaSeconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(deltaSeconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(deltaSeconds / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(deltaSeconds / 86400), 'day');
  if (abs < 31536000) return rtf.format(Math.round(deltaSeconds / 2592000), 'month');
  return rtf.format(Math.round(deltaSeconds / 31536000), 'year');
}

/** Absolute timestamp for tooltips — the precise value behind a relative label. */
export function formatAbsoluteTime(epochSeconds: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(epochSeconds * 1000));
}

export function formatVolume(value: number | null, locale?: string): string {
  return formatCompact(value, locale);
}
