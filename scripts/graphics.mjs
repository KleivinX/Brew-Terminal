#!/usr/bin/env node
/**
 * Renders the README's marketing graphics.
 *
 * Lays out HTML and captures it with the same headless Chrome `scripts/screenshots.mjs` uses.
 * That is the point: CSS gives real gradients, real shadows and real font rendering, which an
 * SVG written by hand does not, and the result is a PNG that GitHub displays anywhere.
 *
 * Fonts and screenshots are inlined as data URIs. A headless render has no font stack worth
 * relying on and cannot fetch siblings from a `data:` document, so anything the page needs has
 * to travel inside it.
 *
 * Requires `docs/screenshots/*.png` to exist — run `node scripts/screenshots.mjs` first.
 *
 *   node scripts/graphics.mjs
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OUT = join('docs', 'graphics');
const SHOTS = join('docs', 'screenshots');
const PORT = 9334;

/** The app's own tokens. A marketing image in colours the product does not use is a lie. */
const C = {
  bg: '#08090b',
  surface: '#15191f',
  text: '#f7f7f2',
  secondary: '#aab3bf',
  muted: '#79838f',
  accent: '#f97316',
  positive: '#3fb950',
};

const shellPath = join(
  homedir(),
  'Library/Caches/ms-playwright/chromium_headless_shell-1228',
  'chrome-headless-shell-mac-x64/chrome-headless-shell',
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataUri = (path, mime) => `data:${mime};base64,${readFileSync(path).toString('base64')}`;

const inter = dataUri(
  'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'font/woff2',
);
const mono = dataUri(
  'node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  'font/woff2',
);
const shot = (name) => dataUri(join(SHOTS, `${name}.png`), 'image/png');
const mark = dataUri('src/assets/brand/mark-on-dark.png', 'image/png');

const head = (title) => `<meta charset="utf-8"><title>${title}</title>`;

const BASE = `
  @font-face { font-family: 'Inter'; src: url(${inter}) format('woff2-variations');
               font-weight: 100 900; font-display: block; }
  @font-face { font-family: 'JB Mono'; src: url(${mono}) format('woff2-variations');
               font-weight: 100 800; font-display: block; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', system-ui, sans-serif; background: ${C.bg}; color: ${C.text};
         -webkit-font-smoothing: antialiased; overflow: hidden; }

  /*
   * The glow is one wide, very low-opacity radial. Two or three stacked reads as a gradient
   * mesh, which is a different and much busier aesthetic than the one this is going for.
   */
  .glow { position: absolute; inset: 0;
          background: radial-gradient(120% 90% at 50% -20%, ${C.accent}22 0%, transparent 60%); }

  /* A hairline grid, barely visible — a nod to the terminal without becoming a pattern. */
  .grid { position: absolute; inset: 0; opacity: 0.35;
          background-image: linear-gradient(${C.text}06 1px, transparent 1px),
                            linear-gradient(90deg, ${C.text}06 1px, transparent 1px);
          background-size: 64px 64px;
          mask-image: radial-gradient(80% 60% at 50% 30%, #000 0%, transparent 75%); }

  /* macOS window chrome. The shadow does most of the work; the border stops it muddying. */
  .window { border-radius: 16px; overflow: hidden; background: ${C.surface};
            border: 1px solid #ffffff14;
            box-shadow: 0 2px 4px #0006, 0 24px 48px -12px #000a, 0 64px 120px -32px #000c; }
  .bar { height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 16px;
         background: #ffffff08; border-bottom: 1px solid #ffffff0f; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .window img { display: block; width: 100%; }

  h1 { font-weight: 700; letter-spacing: -0.045em; line-height: 1.02; }
  .sub { color: ${C.secondary}; font-weight: 400; letter-spacing: -0.011em; }
  .eyebrow { color: ${C.accent}; font-family: 'JB Mono', monospace; font-weight: 500;
             letter-spacing: 0.14em; text-transform: uppercase; }
`;

const chrome = (body) => `
  <div class="window">
    <div class="bar">
      <span class="dot" style="background:#ff5f57"></span>
      <span class="dot" style="background:#febc2e"></span>
      <span class="dot" style="background:#28c840"></span>
    </div>
    ${body}
  </div>`;

/* ------------------------------------------------------------------------- hero */

const hero = {
  name: 'hero',
  width: 1280,
  height: 720,
  html: `${head('hero')}<style>${BASE}
    .wrap { position: relative; width: 1280px; height: 720px; overflow: hidden; }
    .copy { position: absolute; inset: 0; padding: 76px 80px 0; text-align: center; }
    .logo { width: 56px; margin: 0 auto 26px; display: block; opacity: 0.95; }
    h1 { font-size: 62px; margin-bottom: 20px; }
    .sub { font-size: 21px; max-width: 860px; margin: 0 auto; line-height: 1.5; }
    .frame { position: absolute; left: 50%; top: 330px; transform: translateX(-50%);
             width: 1030px; }
    /* Cropped, not scaled: the top of the app is what identifies it. */
    .frame .clip { height: 400px; overflow: hidden; }
  </style>
  <div class="wrap" data-graphic-root>
    <div class="glow"></div><div class="grid"></div>
    <div class="copy">
      <img class="logo" src="${mark}" alt="">
      <h1>Markets, minus the gatekeeping.</h1>
      <p class="sub">A local-first research terminal for crypto and stocks. No account, no server,
        no telemetry — and every number tells you where it came from.</p>
    </div>
    <div class="frame">${chrome(`<div class="clip"><img src="${shot('02-sentry')}" alt=""></div>`)}</div>
  </div>`,
};

/* --------------------------------------------------------------------- triptych */

const cards = [
  ['01-pulse', 'Pulse', 'What moved, and what changed since you last looked.'],
  ['02-sentry', 'Sentry', 'Trade chokepoints, hazards and economies on one map.'],
  ['04-connectors', 'Connectors', 'Every source, and how much is actually known about it.'],
];

const triptych = {
  name: 'triptych',
  width: 1280,
  height: 516,
  html: `${head('triptych')}<style>${BASE}
    .wrap { position: relative; width: 1280px; height: 516px; overflow: hidden;
            padding: 56px 48px; }
    .head { text-align: center; margin-bottom: 40px; }
    .eyebrow { font-size: 12px; }
    h1 { font-size: 34px; margin-top: 12px; }
    .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }
    .card .clip { height: 208px; overflow: hidden; }
    /*
     * Anchored at the left edge, not centred. A negative margin cropped straight through the
     * nav rail's labels — "Pulse" arriving as "ulse" — and the rail is the part that says what
     * the app is. Showing the left half at 2x keeps it whole and readable.
     */
    .card img { width: 200%; margin-left: 0; }
    .label { margin-top: 16px; }
    .label b { display: block; font-size: 16px; font-weight: 600; letter-spacing: -0.02em; }
    .label span { display: block; font-size: 13px; color: ${C.muted}; line-height: 1.45;
                  margin-top: 4px; }
  </style>
  <div class="wrap" data-graphic-root>
    <div class="glow"></div><div class="grid"></div>
    <div class="head">
      <div class="eyebrow">Twelve screens</div>
      <h1>Built to be read, not just looked at.</h1>
    </div>
    <div class="row">
      ${cards
        .map(
          ([file, title, line]) => `
        <div class="card">
          ${chrome(`<div class="clip"><img src="${shot(file)}" alt=""></div>`)}
          <div class="label"><b>${title}</b><span>${line}</span></div>
        </div>`,
        )
        .join('')}
    </div>
  </div>`,
};

/* ------------------------------------------------------------------------ render */

async function browserSocket() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const b = await r.json();
      if (b.webSocketDebuggerUrl) return b.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('the headless shell never opened its debugging port');
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let id = 0;

  const ready = new Promise((res, rej) => {
    socket.addEventListener('open', res, { once: true });
    socket.addEventListener('error', rej, { once: true });
  });

  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);

    const entry = pending.get(m.id);
    if (!entry) return;
    pending.delete(m.id);
    if (m.error) entry.reject(new Error(m.error.message));
    else entry.resolve(m.result);
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = (id += 1);
      pending.set(n, { resolve, reject });
      socket.send(JSON.stringify({ id: n, method, params, sessionId }));
    });

  return { ready, send, close: () => socket.close() };
}

/**
 * Waits until the page is genuinely ready to photograph.
 *
 * Asks the page itself rather than waiting for `Page.loadEventFired`. Two reasons, one of which
 * cost an hour: the load event did not fire for the second `data:` navigation in this target, so
 * the run hung — and even when it does fire, "loaded" is not "painted". A variable font that has
 * not decoded renders in a fallback, and a screenshot that has not decoded renders as nothing.
 * `document.fonts.ready` and `img.complete` are the conditions that actually matter.
 */
async function settled(cdp, sessionId, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const { result } = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(async () => {
          if (document.readyState !== 'complete') return false;
          if (document.title !== ${JSON.stringify(label)}) return false;
          await document.fonts.ready;
          return [...document.images].every((img) => img.complete && img.naturalWidth > 0);
        })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    );
    if (result?.value === true) {
      // One more frame, so the compositor has drawn what the DOM says is ready.
      await sleep(250);
      return;
    }
    await sleep(250);
  }
  throw new Error(`${label} never finished loading its fonts and images`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const shell = spawn(shellPath, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--hide-scrollbars',
    '--disable-gpu',
    `--user-data-dir=${join(process.env.TMPDIR ?? '/tmp', `brew-graphics-${Date.now()}`)}`,
    'about:blank',
  ]);
  shell.on('error', (e) => {
    process.stderr.write(`could not start the headless shell: ${e.message}\n`);
    process.exit(1);
  });

  const cdp = connect(await browserSocket());
  await cdp.ready;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
  const frameId = frameTree.frame.id;

  for (const graphic of [hero, triptych]) {
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: graphic.width, height: graphic.height, deviceScaleFactor: 2, mobile: false },
      sessionId,
    );
    /*
     * `Page.setDocumentContent`, not `Page.navigate` to a `data:` URL.
     *
     * Chrome blocks top-level navigation to `data:` URLs. The first one slipped through from
     * `about:blank`; the second was silently refused, leaving the previous document on screen —
     * so the triptych came out as a second copy of the hero, twice, at the right dimensions and
     * with every readiness check passing. Setting the content directly cannot fail that way.
     */
    await cdp.send('Page.setDocumentContent', { frameId, html: graphic.html }, sessionId);
    await settled(cdp, sessionId, graphic.name);

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const file = join(OUT, `${graphic.name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    process.stdout.write(`${file}\n`);
  }

  cdp.close();
  shell.kill();
}

main().catch((e) => {
  process.stderr.write(`${e.stack ?? e}\n`);
  process.exit(1);
});
