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
  // Zero is not a small number that needs precision — it is nothing. Without this it falls
  // through to the sub-0.0001 branch, and a realised gain of nothing renders as $0.00000000.
  //
  // Formatting a literal 0 rather than `value` also collapses negative zero, which arithmetic
  // on a closed position produces easily enough and which `Intl` faithfully renders as -$0.00.
  if (abs === 0)
    return formatter(
      `price:${currency}:2:${locale ?? ''}`,
      () =>
        new Intl.NumberFormat(locale, {
          style: 'currency',
          currency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
    ).format(0);
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

/**
 * A holding size, without the floating-point noise.
 *
 * Quantities are sums of what the user typed in, and binary floating point does not hold
 * decimal fractions exactly: buying 0.25 BTC and then 0.1 more leaves 0.35000000000000003 in
 * an f64. Rendered raw — which is what the positions table did — that lands in front of
 * someone as their holding, and it reads as a bug in their money.
 *
 * Capped at eight decimals because that is the smallest unit Bitcoin has, so nothing a crypto
 * position can legitimately hold is lost, and trailing zeros are dropped so a round 18 ETH
 * does not render as 18.00000000.
 */
export function formatQuantity(value: number, locale?: string): string {
  if (!Number.isFinite(value)) return '—';
  return formatter(
    `qty:${locale ?? ''}`,
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 8 }),
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

/**
 * A date with no time of day.
 *
 * Distinct from `formatAbsoluteTime`, which is for a moment something was fetched. This is for
 * a day something is *about* — a daily index's reading, the boundary between two sources — and
 * appending "14:32" to one of those implies a precision the figure does not have.
 */
export function formatDate(epochSeconds: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(epochSeconds * 1000),
  );
}

export function formatVolume(value: number | null, locale?: string): string {
  return formatCompact(value, locale);
}
