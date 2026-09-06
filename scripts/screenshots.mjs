#!/usr/bin/env node
/**
 * Captures the README screenshots from the running dev server.
 *
 * These used to be taken by hand, which is why they went four features stale: Atlas, Sentry and
 * Connectors all shipped without ever appearing in the README. A script means re-taking the set
 * costs one command.
 *
 * Drives Playwright's cached `chrome-headless-shell` over the DevTools protocol directly. No
 * dependency: Node 22+ has a global WebSocket, and CDP is a JSON protocol over one socket, so
 * pulling in a browser automation library for eight screenshots would be the larger cost.
 *
 * Alongside each image it writes `anchors.json`: the on-screen position of the controls worth
 * pointing at, measured in the same pass. `promo-video.mjs` aims its camera and cursor from
 * that file, so the two can never drift apart.
 *
 * Usage:
 *   npm run dev                 # in another terminal
 *   node scripts/screenshots.mjs
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ORIGIN = process.env.BREW_ORIGIN ?? 'http://localhost:1420';
const OUT_DIR = join('docs', 'screenshots');
const PORT = 9333;

/** Retina, so the images stay sharp when GitHub scales them down. */
const WIDTH = 1440;
const HEIGHT = 900;
const SCALE = 2;

const SHOTS = [
  ['01-pulse', '/pulse'],
  ['02-sentry', '/sentry'],
  ['03-atlas', '/atlas'],
  ['04-connectors', '/connectors'],
  ['05-research', '/research/crypto:cg:bitcoin'],
  ['06-screener', '/screener'],
  ['07-compare', '/compare'],
  ['08-learn', '/learn'],
  ['09-desk', '/desk'],
  ['10-notes', '/notes'],
  ['11-portfolio', '/portfolio'],
  ['12-settings', '/settings/providers'],
];

/**
 * Things worth pointing a cursor at, per route.
 *
 * Written down here, next to the capture, because anything that reads a position out of these
 * images has to be measured in the *same* run that took them. Measuring the app separately
 * looks equivalent and is not: an instance whose navigation rail happens to be collapsed
 * shifts every panel right by about 140px, and a zoom aimed with those numbers lands on the
 * sidebar. Same browser, same viewport, same seeded state, one pass.
 *
 * Each entry is `[name, selector]` or `[name, selector, text]`, where `text` picks the first
 * match whose textContent contains it. A selector that matches nothing is simply absent from
 * the output — a route can gain or lose a control without breaking the capture.
 */
const ANCHORS = {
  '/pulse': [
    ['providerBadge', '[class*="_badge_"]'],
    ['firstRow', '[role="row"]', 'BTC'],
    ['cryptoTab', 'button', 'Crypto'],
    ['newsItem', 'a[target="_blank"]'],
    ['digest', 'section[aria-label="Since you last looked"]'],
  ],
  '/sentry': [
    ['severeMarker', 'svg [data-severity="severe"]'],
    ['watchRow', 'section[aria-label="Near a chokepoint"] button'],
    ['layerToggle', 'button[role="switch"]'],
    ['map', 'svg[role="img"]'],
    ['layers', 'section[aria-label="Layers"]'],
  ],
  '/atlas': [
    ['tickerRow', 'section[aria-label="Ticker"] button'],
    ['pause', 'button', 'Pause'],
    ['route', 'section[aria-label="Route"]'],
  ],
  '/connectors': [
    ['connectorName', 'button[aria-label*="details"]'],
    ['notReviewed', '[class*="_badge_"]', 'Not reviewed'],
    ['stageFilter', '#connector-stage'],
    ['grid', '[role="grid"]'],
  ],
  '/research/crypto:cg:bitcoin': [
    ['rangeButton', 'button', 'One month'],
    ['indicator', 'button', 'EMA 20'],
    ['showNumbers', 'button', 'Show the underlying numbers'],
    ['ask', 'button', 'Ask about this'],
    ['overview', 'section[aria-label]'],
  ],
  '/screener': [
    ['minCap', '#scr-min-cap'],
    ['sort', '#scr-sort'],
    ['query', '#scr-query'],
    ['saveView', 'button', 'Save this view'],
    ['exportCsv', 'button', 'Export CSV'],
  ],
  '/compare': [
    ['addField', 'input[aria-label="Asset id to add"]'],
    ['addAsset', 'button', 'Add'],
    ['rangeTab', '#tab-1Y'],
    ['removeAsset', 'button[aria-label^="Remove"]'],
    ['showNumbers', 'button', 'Show the numbers'],
  ],
  '/learn': [
    ['firstLesson', 'main a', 'Stocks Basics'],
    ['riskLesson', 'main a', 'Risk and Scams'],
    ['glossary', 'a', 'Open the glossary'],
  ],
  '/desk': [
    ['setUp', 'button', 'Set up a model'],
    ['panel', 'main'],
  ],
  '/notes': [
    ['noteCard', 'section[aria-label="Notes"] li button'],
    ['noteBody', '#note-body'],
    ['search', 'input[aria-label="Search your notes"]'],
    ['newNote', 'button', 'New note'],
  ],
  '/portfolio': [
    ['recordTrade', 'button', 'Record a trade'],
    ['exportCsv', 'button', 'Export CSV'],
    ['position', 'tbody tr', 'BTC'],
    ['panel', 'main'],
  ],
  '/settings/providers': [
    ['saveKey', 'button', 'Save key'],
    ['keyField', 'input'],
    ['testConnection', 'button', 'Test connection'],
    ['toggle', 'button[role="switch"]'],
  ],
};

/**
 * Run after arriving at a route, before the shutter.
 *
 * A route that lands on a chooser — Notes opens with the editor empty until a note is picked —
 * photographs as an empty state even when the data is there. One click puts the page in the
 * state a person would actually be looking at.
 */
const PREPARE = {
  '/notes': `__seed.click('section[aria-label="Notes"] li button')`,
};

const shellPath = join(
  homedir(),
  'Library/Caches/ms-playwright/chromium_headless_shell-1228',
  'chrome-headless-shell-mac-x64/chrome-headless-shell',
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function browserSocket() {
  // The shell needs a moment to write its port file; poll rather than guess a delay.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const body = await response.json();
      if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('the headless shell never opened its debugging port');
}

/** A minimal CDP client: one socket, one id counter, promises keyed by id. */
function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  return { ready, send, close: () => socket.close() };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const shell = spawn(shellPath, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--hide-scrollbars',
    '--disable-gpu',
    `--window-size=${WIDTH},${HEIGHT}`,
    // A throwaway profile, so a previous run's localStorage cannot leak into this one.
    `--user-data-dir=${join(process.env.TMPDIR ?? '/tmp', `brew-shots-${Date.now()}`)}`,
    'about:blank',
  ]);
  shell.on('error', (error) => {
    process.stderr.write(`could not start the headless shell: ${error.message}\n`);
    process.exit(1);
  });

  const cdp = connect(await browserSocket());
  await cdp.ready;

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false },
    sessionId,
  );

  const go = async (hash) => {
    await cdp.send('Page.navigate', { url: `${ORIGIN}/#${hash}` }, sessionId);
    // The hash router does not fire a load event on an in-page change, so settle on time.
    await sleep(2500);
  };

  // `returnByValue` matters: without it CDP hands back an object *reference*, and every
  // measurement comes home as undefined while the page itself looks perfectly fine.
  const evaluate = (expression) =>
    cdp.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );

  // Let the harness write its default state, then mark onboarding done and open the rail —
  // otherwise every screenshot is of the welcome dialog behind a collapsed sidebar.
  await go('/pulse');
  await evaluate(`
    (() => {
      const key = 'brew.harness.state';
      const state = JSON.parse(localStorage.getItem(key) ?? '{}');
      state.preferences = {
        ...(state.preferences ?? {}),
        onboardingCompleted: true,
        navRailExpanded: true,
      };
      localStorage.setItem(key, JSON.stringify(state));
      return true;
    })()
  `);
  await cdp.send('Page.reload', {}, sessionId);
  await sleep(2500);

  // ---------------------------------------------------------------------------------------
  // Seeding.
  //
  // Portfolio positions and notes live in memory in the browser harness, so an untouched app
  // shows its empty states — honest, but a screenshot of "Record your first trade" teaches a
  // reader nothing about what the portfolio actually does. Rather than fake the fixtures, drive
  // the real forms once, here, and let the app compute what it would compute for anyone.
  //
  // Hash navigation does not reload, so what is entered now survives every later route change.
  // ---------------------------------------------------------------------------------------

  // React tracks an input's value on the DOM node; assigning `.value` updates the field and the
  // component never hears about it. Going through the prototype's setter is what makes the
  // synthetic change event fire.
  await evaluate(`
    window.__seed = {
      set(el, value) {
        const proto = el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      click(selector, text) {
        const nodes = [...document.querySelectorAll(selector)];
        const hit = text ? nodes.find((n) => (n.textContent || '').includes(text)) : nodes[0];
        if (!hit) throw new Error('no ' + selector + (text ? ' "' + text + '"' : ''));
        hit.click();
        return true;
      },
      fill(fields) {
        for (const [selector, value] of Object.entries(fields)) {
          const el = document.querySelector(selector);
          if (!el) throw new Error('no field ' + selector);
          window.__seed.set(el, value);
        }
        return true;
      },
    };
    true
  `);

  const settle = () => sleep(500);

  const TRADES = [
    { asset: 'crypto:cg:bitcoin', symbol: 'BTC', quantity: '0.4', price: '52180', fee: '11.40' },
    { asset: 'crypto:cg:ethereum', symbol: 'ETH', quantity: '6', price: '2740', fee: '8.20' },
    { asset: 'stock:us:AAPL', symbol: 'AAPL', quantity: '35', price: '188.60', fee: '0' },
  ];

  await go('/portfolio');
  for (const trade of TRADES) {
    await evaluate(`__seed.click('button', 'Record a trade')`);
    await settle();
    await evaluate(`
      __seed.fill({
        '#tx-asset': ${JSON.stringify(trade.asset)},
        '#tx-symbol': ${JSON.stringify(trade.symbol)},
        '#tx-quantity': ${JSON.stringify(trade.quantity)},
        '#tx-price': ${JSON.stringify(trade.price)},
        '#tx-fee': ${JSON.stringify(trade.fee)},
        '#tx-date': '2026-03-18',
      })
    `);
    await evaluate(`__seed.click('button', 'Record trade')`);
    await settle();
  }

  const NOTES = [
    {
      title: 'Why I trimmed the ETH position',
      body: [
        'Sold a third on the way up, not because of a view on the chart but because the',
        'position had drifted to 40% of the book and I had no plan for that.',
        '',
        'Cost basis is in Portfolio. The 2026-03-18 fill is the one to compare against.',
      ].join('\n'),
    },
    {
      title: 'Questions to ask before I believe a headline',
      body: [
        '1. Who published it, and when did Brew last fetch it?',
        '2. Is the number a level or a change?',
        '3. What would have to be true for the opposite reading?',
      ].join('\n'),
    },
  ];

  await go('/notes');
  for (const note of NOTES) {
    await evaluate(`__seed.click('button', 'New note')`);
    await settle();
    await evaluate(`
      __seed.fill({
        '#note-title': ${JSON.stringify(note.title)},
        '#note-body': ${JSON.stringify(note.body)},
      })
    `);
    await evaluate(`__seed.click('button', 'Save note')`);
    await settle();
  }

  const anchors = {};

  for (const [name, route] of SHOTS) {
    await go(route);
    if (PREPARE[route]) {
      await evaluate(PREPARE[route]);
      await sleep(700);
    }
    const { data } = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
      sessionId,
    );
    const file = join(OUT_DIR, `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));

    // Measured against the very frame that was just captured.
    const wanted = ANCHORS[route] ?? [];
    const { result } = await evaluate(`
      (() => {
        const wanted = ${JSON.stringify(wanted)};
        // An anchor below the fold measures fine and is not in the picture, which is exactly
        // the kind of near-miss that reads as a bug in whatever aims at it later. Only points
        // inside the captured frame are recorded.
        const centre = (el) => {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) return null;
          const x = Math.round(b.x + b.width / 2);
          const y = Math.round(b.y + b.height / 2);
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
          return [x, y, Math.round(b.width), Math.round(b.height)];
        };
        const out = {};
        for (const [key, selector, text] of wanted) {
          const nodes = [...document.querySelectorAll(selector)];
          const hit = text
            ? nodes.find((n) => (n.textContent || '').includes(text))
            : nodes[0];
          const box = hit ? centre(hit) : null;
          if (box) out[key] = box;
        }
        return out;
      })()
    `);
    anchors[name] = result?.value ?? {};

    const found = Object.keys(anchors[name]).length;
    process.stdout.write(`${file}  (${found} anchor${found === 1 ? '' : 's'})\n`);
  }

  // Written the way Prettier would write it — each box on one line — because the repository
  // checks formatting before anything else, and a generated file that fails that check turns
  // every re-capture into a second manual step.
  const anchorFile = join(OUT_DIR, 'anchors.json');
  const body = Object.entries(anchors)
    .map(([shotName, found]) => {
      const rows = Object.entries(found)
        .map(([anchor, b]) => `    "${anchor}": [${b.join(', ')}]`)
        .join(',\n');
      return `  "${shotName}": {\n${rows}\n  }`;
    })
    .join(',\n');
  writeFileSync(anchorFile, `{\n${body}\n}\n`);
  process.stdout.write(`${anchorFile}\n`);

  cdp.close();
  shell.kill();
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
