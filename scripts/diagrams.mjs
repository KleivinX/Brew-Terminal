#!/usr/bin/env node
/**
 * Generates the README diagrams, one light and one dark variant each.
 *
 * Two variants rather than one file with a `prefers-color-scheme` media query: GitHub renders
 * README images through `<img>`, where media-query support inside the SVG is inconsistent — and
 * the failure mode is a white card on a dark page. `<picture>` with two sources is the thing
 * GitHub actually documents, and the repo already does it for the logo.
 *
 * The palettes below are lifted from `src/styles/tokens.css`, so a diagram cannot drift into
 * colours the app does not use.
 *
 *   node scripts/diagrams.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join('docs', 'diagrams');

const THEMES = {
  dark: {
    bg: '#0b0d10',
    surface: '#15191f',
    inset: '#0e1116',
    border: '#232a33',
    borderStrong: '#667485',
    text: '#f7f7f2',
    secondary: '#aab3bf',
    muted: '#79838f',
    accent: '#f97316',
    positive: '#3fb950',
    negative: '#f85149',
  },
  light: {
    bg: '#f8f6f1',
    surface: '#ffffff',
    inset: '#f1eee7',
    border: '#e2ddd3',
    borderStrong: '#8b8371',
    text: '#0b0d10',
    secondary: '#454c55',
    muted: '#63696f',
    accent: '#c2410c',
    positive: '#0b4f1f',
    negative: '#b3261e',
  },
};

const FONT =
  "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, Consolas, monospace";

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function box(x, y, w, h, { fill, stroke, dash }) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${
    dash ? ` stroke-dasharray="${dash}"` : ''
  }/>`;
}

function text(x, y, content, { size = 14, fill, weight = 400, anchor = 'start', mono = false }) {
  return `<text x="${x}" y="${y}" font-family="${mono ? MONO : FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(
    content,
  )}</text>`;
}

/** An arrow with a label above it. */
function arrow(x1, x2, y, label, t) {
  const mid = (x1 + x2) / 2;
  return [
    `<line x1="${x1}" y1="${y}" x2="${x2 - 9}" y2="${y}" stroke="${t.borderStrong}" stroke-width="1.5"/>`,
    `<path d="M${x2},${y} L${x2 - 9},${y - 4.5} L${x2 - 9},${y + 4.5} Z" fill="${t.borderStrong}"/>`,
    label ? text(mid, y - 10, label, { size: 11, fill: t.muted, anchor: 'middle' }) : '',
  ].join('');
}

/* ------------------------------------------------------------------ provenance */

function provenance(t) {
  const W = 1280;
  const H = 356;
  const p = [];

  p.push(`<rect width="${W}" height="${H}" rx="14" fill="${t.bg}"/>`);
  p.push(
    text(32, 44, 'No number renders without its provider and its age', {
      size: 19,
      weight: 600,
      fill: t.text,
    }),
  );
  p.push(
    text(32, 68, 'Every data-returning command replies with an Envelope, not a bare value.', {
      size: 13,
      fill: t.secondary,
    }),
  );

  const y = 112;
  const h = 112;
  const mid = y + h / 2;

  /*
   * Laid out by hand rather than by a flow algorithm, and the gaps are the reason: an arrow
   * label has to fit between two boxes without overlapping either, which a naive equal-split
   * does not guarantee at these string lengths.
   */
  p.push(box(32, y, 196, h, { fill: t.surface, stroke: t.border }));
  p.push(text(52, y + 30, 'Public API', { size: 13, weight: 600, fill: t.text }));
  p.push(text(52, y + 54, 'CoinGecko, FRED, USGS,', { size: 11.5, fill: t.secondary }));
  p.push(text(52, y + 72, 'World Bank, Frankfurter…', { size: 11.5, fill: t.secondary }));
  p.push(text(52, y + 96, 'terms reviewed first', { size: 11, fill: t.muted }));

  p.push(arrow(228, 320, mid, 'HTTPS', t));

  p.push(box(320, y, 236, h, { fill: t.surface, stroke: t.border }));
  p.push(text(340, y + 30, 'Rust core', { size: 13, weight: 600, fill: t.text }));
  p.push(text(340, y + 54, 'validate → normalise', { size: 11.5, fill: t.secondary }));
  p.push(text(340, y + 72, 'cache → rate-limit', { size: 11.5, fill: t.secondary }));
  p.push(text(340, y + 96, 'a failure degrades, never blanks', { size: 11, fill: t.muted }));

  p.push(arrow(556, 648, mid, 'typed IPC', t));

  // The envelope card is taller than the others on purpose: it is the point of the diagram.
  p.push(box(648, y - 18, 286, h + 52, { fill: t.inset, stroke: t.accent }));
  p.push(text(668, y + 10, 'Envelope<T>', { size: 13, weight: 600, fill: t.accent, mono: true }));
  const fields = [
    ['data', 'the payload'],
    ['providerId', 'who served it'],
    ['fetchedAt', 'how old it is'],
    ['source', 'live · cache · mock'],
    ['stale, degraded', 'and why'],
  ];
  fields.forEach(([k, v], i) => {
    const fy = y + 38 + i * 21;
    p.push(text(668, fy, k, { size: 11.5, fill: t.text, mono: true }));
    p.push(text(812, fy, v, { size: 11, fill: t.muted }));
  });

  p.push(arrow(934, 1016, mid, 'render', t));

  p.push(box(1016, y, 232, h, { fill: t.surface, stroke: t.border }));
  p.push(text(1036, y + 36, '$67,412.08', { size: 19, weight: 600, fill: t.text, mono: true }));
  p.push(text(1036, y + 60, '▲ +2.41%', { size: 12, fill: t.positive, mono: true }));
  p.push(
    `<rect x="1036" y="${y + 74}" width="176" height="24" rx="12" fill="none" stroke="${t.border}"/>`,
  );
  p.push(text(1048, y + 90, 'CoinGecko · 12s ago', { size: 10.5, fill: t.secondary }));

  p.push(
    text(
      32,
      316,
      'Dropping provenance would take deliberate effort — the type does not allow it.',
      {
        size: 12,
        fill: t.muted,
      },
    ),
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Data flows from a public API through the Rust core, which stamps every payload with its provider, timestamp and freshness, to a UI that always renders the number beside its source and age.">${p.join(
    '',
  )}</svg>`;
}

/* --------------------------------------------------------------- architecture */

function architecture(t) {
  const W = 1200;
  const H = 420;
  const p = [];

  p.push(`<rect width="${W}" height="${H}" rx="14" fill="${t.bg}"/>`);
  p.push(
    text(32, 44, 'One trust boundary, enforced by the build', {
      size: 19,
      weight: 600,
      fill: t.text,
    }),
  );
  p.push(
    text(32, 68, 'The webview cannot reach the network. A lint rule fails the build if it tries.', {
      size: 13,
      fill: t.secondary,
    }),
  );

  const top = 100;
  const colH = 250;

  // Webview
  p.push(box(32, top, 330, colH, { fill: t.surface, stroke: t.border }));
  p.push(
    text(56, top + 30, 'Webview — React + TypeScript', { size: 13, weight: 600, fill: t.text }),
  );
  [
    '12 routes, lazily loaded',
    'TanStack Query for cache and retry',
    'Design tokens, three themes',
    'No fetch. No XHR. No WebSocket.',
  ].forEach((line, i) =>
    p.push(
      text(56, top + 62 + i * 24, line, {
        size: 11.5,
        fill: i === 3 ? t.negative : t.secondary,
      }),
    ),
  );
  p.push(text(56, top + 176, '200 KB gzipped entry budget,', { size: 11, fill: t.muted }));
  p.push(text(56, top + 194, 'checked on every build', { size: 11, fill: t.muted }));
  p.push(text(56, top + 224, 'Untrusted input is rendered as text —', { size: 11, fill: t.muted }));
  p.push(text(56, top + 240, 'no innerHTML, anywhere', { size: 11, fill: t.muted }));

  // Boundary
  p.push(
    `<line x1="404" y1="${top - 8}" x2="404" y2="${top + colH + 8}" stroke="${t.accent}" stroke-width="1.5" stroke-dasharray="6 6"/>`,
  );
  p.push(
    `<rect x="366" y="${top + 96}" width="76" height="58" rx="10" fill="${t.bg}" stroke="${t.accent}" stroke-width="1.5"/>`,
  );
  p.push(
    text(404, top + 120, 'typed', { size: 11, fill: t.accent, anchor: 'middle', weight: 600 }),
  );
  p.push(text(404, top + 136, 'IPC', { size: 11, fill: t.accent, anchor: 'middle', weight: 600 }));

  // Rust core
  p.push(box(446, top, 400, colH, { fill: t.surface, stroke: t.border }));
  p.push(text(470, top + 30, 'Rust core — Tauri 2', { size: 13, weight: 600, fill: t.text }));
  [
    ['Provider registry', 'routes each request to a reviewed source'],
    ['HTTPS client', 'https-only, timeouts, capped bodies'],
    ['SQLite (WAL)', 'watchlists, notes, portfolio, cache'],
    ['OS keychain', 'API keys — never in the database or IPC'],
    ['Rate-limit manager', 'counts calls, backs off, reports what is left'],
  ].forEach(([k, v], i) => {
    const y = top + 62 + i * 36;
    p.push(text(470, y, k, { size: 12, weight: 600, fill: t.text }));
    p.push(text(470, y + 17, v, { size: 11, fill: t.muted }));
  });

  // Outside
  p.push(box(888, top, 280, colH, { fill: t.inset, stroke: t.borderStrong, dash: '6 6' }));
  p.push(text(912, top + 30, 'Outside', { size: 13, weight: 600, fill: t.text }));
  [
    ['11 wired providers', t.secondary],
    ['reviewed, recorded, attributed', t.muted],
    ['', t.muted],
    ['Optional AI endpoint', t.secondary],
    ['off until you configure it, and', t.muted],
    ['you see what is sent, first', t.muted],
    ['', t.muted],
    ['No telemetry. No account.', t.positive],
    ['No server of ours, anywhere.', t.positive],
  ].forEach(([line, fill], i) => {
    if (!line) return;
    p.push(text(912, top + 62 + i * 20, line, { size: 11.5, fill }));
  });

  p.push(
    text(
      32,
      388,
      'Everything the app knows lives in one SQLite file on your computer. Delete it and nothing of yours remains.',
      {
        size: 12,
        fill: t.muted,
      },
    ),
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="The React webview makes no network requests; it calls typed IPC commands, and the Rust core owns every outbound request, the SQLite database and the OS keychain.">${p.join(
    '',
  )}</svg>`;
}

mkdirSync(OUT, { recursive: true });
for (const [name, build] of [
  ['provenance', provenance],
  ['architecture', architecture],
]) {
  for (const [theme, palette] of Object.entries(THEMES)) {
    const file = join(OUT, `${name}-${theme}.svg`);
    writeFileSync(file, build(palette));
    process.stdout.write(`${file}\n`);
  }
}
