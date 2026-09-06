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
  ['05-research', '/research'],
  ['06-screener', '/screener'],
  ['07-compare', '/compare'],
  ['08-learn', '/learn'],
  ['09-desk', '/desk'],
  ['10-notes', '/notes'],
];

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

  const evaluate = (expression) =>
    cdp.send('Runtime.evaluate', { expression, awaitPromise: true }, sessionId);

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

  for (const [name, route] of SHOTS) {
    await go(route);
    const { data } = await cdp.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false },
      sessionId,
    );
    const file = join(OUT_DIR, `${name}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    process.stdout.write(`${file}\n`);
  }

  cdp.close();
  shell.kill();
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
