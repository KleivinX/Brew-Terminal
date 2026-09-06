#!/usr/bin/env node
/**
 * Renders a 9:16 motion graphic for Brew Terminal.
 *
 * Animates in HTML. No editor, no timeline file, no external service — the film is source code,
 * so changing a line of copy is a one-command re-render.
 *
 * **Use `--html` unless you specifically need frames.** It writes one self-contained file that
 * plays, loops and scrubs in any browser, which is what a person actually wants, and it is what
 * to screen-record from.
 *
 * The `--out` path renders every frame and hands them to ffmpeg. It works, but the only ffmpeg
 * on a machine with Playwright installed is the minimal build Playwright uses for screen
 * recording, and that one has exactly two video encoders: png and libvpx. There is no H.264 in
 * it, and H.264 in an MP4 is what every social platform wants. So that path needs a real ffmpeg
 * on PATH; without one it renders 720 frames and then fails at the last step.
 *
 * The animation is a **pure function of time**. The page exposes `seek(t)` and every property
 * is computed from `t` alone; nothing depends on requestAnimationFrame or the wall clock. That
 * is what makes the capture deterministic: a slow frame cannot drop anything, because the
 * renderer is asked for an exact moment rather than whatever it has drawn by now.
 *
 *   node scripts/screenshots.mjs      # the app shots this composes
 *   node scripts/promo-video.mjs
 *
 * Options:
 *   --out <path>   where to write the mp4  (default: a temp directory, printed at the end)
 *   --fps <n>      frames per second       (default: 30)
 *   --preview <d>  write one still per scene into <d> and stop, for checking the design
 *                  without waiting on a full render
 *   --html <path>  write the animation as one self-contained HTML file and stop. Opens in any
 *                  browser, plays on its own, scrubs, and needs no network — fonts and
 *                  screenshots are inlined, so the file is the whole thing.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const FPS = Number(flag('fps', 30));
const DURATION = 24;
const W = 1080;
const H = 1920;
const PORT = 9335;

const shellPath = join(
  homedir(),
  'Library/Caches/ms-playwright/chromium_headless_shell-1228',
  'chrome-headless-shell-mac-x64/chrome-headless-shell',
);
// A real ffmpeg if there is one; Playwright's minimal build otherwise, which will refuse the
// H.264 options above. See the note at the top.
const ffmpegPath =
  process.env.FFMPEG ?? join(homedir(), 'Library/Caches/ms-playwright/ffmpeg-1011/ffmpeg-mac');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataUri = (p, mime) => `data:${mime};base64,${readFileSync(p).toString('base64')}`;

const inter = dataUri(
  'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  'font/woff2',
);
const mono = dataUri(
  'node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  'font/woff2',
);
const mark = dataUri('src/assets/brand/mark-on-dark.png', 'image/png');
const shot = (n) => dataUri(join('docs', 'screenshots', `${n}.png`), 'image/png');

/* ------------------------------------------------------------------------ the page */

const html = `<meta charset="utf-8"><title>promo</title>
<style>
  @font-face { font-family:'Inter'; src:url(${inter}) format('woff2-variations');
               font-weight:100 900; font-display:block; }
  @font-face { font-family:'JB'; src:url(${mono}) format('woff2-variations');
               font-weight:100 800; font-display:block; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${W}px; height:${H}px; overflow:hidden; background:#08090b; }
  body { font-family:'Inter',system-ui,sans-serif; color:#f7f7f2; -webkit-font-smoothing:antialiased; }

  .stage { position:absolute; inset:0; }
  .glow { position:absolute; inset:0;
          background:radial-gradient(70% 45% at 50% 38%, #f9731633 0%, transparent 62%); }
  .grid { position:absolute; inset:0; opacity:.5;
          background-image:linear-gradient(#f7f7f207 1px,transparent 1px),
                           linear-gradient(90deg,#f7f7f207 1px,transparent 1px);
          background-size:90px 90px;
          mask-image:radial-gradient(70% 50% at 50% 42%,#000 0%,transparent 78%); }

  .scene { position:absolute; inset:0; display:flex; flex-direction:column;
           align-items:center; justify-content:center; padding:0 96px; text-align:center;
           will-change:opacity,transform; }

  h1 { font-weight:700; letter-spacing:-.045em; line-height:1.02; font-size:104px; }
  h2 { font-weight:600; letter-spacing:-.03em; line-height:1.1; font-size:64px; }
  .sub { color:#aab3bf; font-size:36px; line-height:1.45; letter-spacing:-.01em; }
  .eyebrow { color:#f97316; font-family:'JB',monospace; font-weight:500; font-size:24px;
             letter-spacing:.2em; text-transform:uppercase; }
  .mono { font-family:'JB',monospace; }

  .mark { width:150px; }
  .word { display:inline-block; will-change:opacity,transform; }

  .price { font-family:'JB',monospace; font-weight:600; font-size:118px; letter-spacing:-.03em; }
  .badge { display:inline-flex; align-items:center; gap:16px; margin-top:44px;
           padding:20px 34px; border:2px solid #f9731655; border-radius:999px;
           background:#f9731612; font-size:30px; color:#f7f7f2; }
  .dot { width:14px; height:14px; border-radius:50%; background:#3fb950; }
  .qmark { color:#79838f; font-size:34px; margin-top:40px; }

  .card { position:absolute; left:50%; width:880px; border-radius:26px; overflow:hidden;
          background:#15191f; border:1px solid #ffffff14;
          box-shadow:0 40px 90px -20px #000c, 0 100px 180px -60px #000; will-change:transform,opacity; }
  .card .bar { height:52px; display:flex; align-items:center; gap:11px; padding:0 22px;
               background:#ffffff08; border-bottom:1px solid #ffffff0f; }
  .card .bar i { width:16px; height:16px; border-radius:50%; display:block; }
  .card .clip { height:470px; overflow:hidden; }
  .card img { display:block; width:150%; }

  .promise { font-size:44px; font-weight:600; letter-spacing:-.02em; margin:22px 0;
             will-change:opacity,transform; }
  .promise span { color:#f97316; }

  .url { font-family:'JB',monospace; font-size:30px; color:#aab3bf; margin-top:36px; }
  .fine { position:absolute; bottom:96px; left:0; right:0; text-align:center;
          font-size:22px; color:#79838f; line-height:1.5; padding:0 120px; }
</style>

<div class="stage">
  <div class="glow" id="glow"></div>
  <div class="grid" id="grid"></div>

  <!-- 1 · mark -->
  <div class="scene" id="s1">
    <img class="mark" id="s1mark" src="${mark}" alt="">
    <div style="height:52px"></div>
    <h2 id="s1name">Brew&nbsp;Terminal</h2>
  </div>

  <!-- 2 · headline -->
  <div class="scene" id="s2">
    <h1><span class="word">Markets,</span> <span class="word">minus</span>
        <span class="word">the</span> <span class="word">gatekeeping.</span></h1>
  </div>

  <!-- 3 · the problem -->
  <div class="scene" id="s3">
    <div class="eyebrow" id="s3eye">Every finance app</div>
    <div style="height:56px"></div>
    <div class="price" id="s3price">$67,412.08</div>
    <div class="qmark" id="s3q">From where? How old? Says who?</div>
  </div>

  <!-- 4 · the answer -->
  <div class="scene" id="s4">
    <div class="eyebrow" id="s4eye">This one</div>
    <div style="height:56px"></div>
    <div class="price" id="s4price">$67,412.08</div>
    <div class="badge" id="s4badge"><span class="dot"></span>
      <span class="mono">CoinGecko · 12s ago</span></div>
    <div style="height:64px"></div>
    <div class="sub" id="s4sub">Every number. Every screen. Every time.</div>
  </div>

  <!-- 5 · screens -->
  <div class="scene" id="s5" style="justify-content:flex-start; padding-top:430px">
    <div class="eyebrow" id="s5eye">Twelve screens</div>
  </div>
  <div class="card" id="c1"><div class="bar"><i style="background:#ff5f57"></i>
    <i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
    <div class="clip"><img src="${shot('01-pulse')}" alt=""></div></div>
  <div class="card" id="c2"><div class="bar"><i style="background:#ff5f57"></i>
    <i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
    <div class="clip"><img src="${shot('02-sentry')}" alt=""></div></div>
  <div class="card" id="c3"><div class="bar"><i style="background:#ff5f57"></i>
    <i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
    <div class="clip"><img src="${shot('04-connectors')}" alt=""></div></div>

  <!-- 6 · promises -->
  <div class="scene" id="s6">
    <div class="promise" id="p1">Runs on <span>your</span> machine</div>
    <div class="promise" id="p2">No account. No telemetry.</div>
    <div class="promise" id="p3">No <span>buy</span>. No <span>sell</span>. No verdicts.</div>
    <div class="promise" id="p4">Free and open source</div>
  </div>

  <!-- 7 · end -->
  <div class="scene" id="s7">
    <img class="mark" id="s7mark" src="${mark}" alt="">
    <div style="height:44px"></div>
    <h2>Brew&nbsp;Terminal</h2>
    <div class="url" id="s7url">github.com/KleivinX/Brew-Terminal</div>
  </div>
  <div class="fine" id="fine">A research tool, not an adviser. Not financial advice.<br>
    Your decisions, and their consequences, are your own.</div>
</div>

<script>
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  /* Standard ease-out. Entrances decelerate; nothing in this film needs to bounce. */
  const out = (p) => 1 - Math.pow(1 - clamp(p), 3);
  const inOut = (p) => (clamp(p) < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  /** Progress through a window that starts at \`start\` and lasts \`dur\`. */
  const seg = (t, start, dur) => clamp((t - start) / dur);
  /** 0 → 1 → 0 across a scene, with hold in the middle. */
  const band = (t, start, end, fade = 0.5) =>
    Math.min(seg(t, start, fade), 1 - seg(t, end - fade, fade));

  const SCENES = [
    ['s1', 0.0, 3.4],
    ['s2', 3.4, 7.0],
    ['s3', 7.0, 10.6],
    ['s4', 10.6, 14.6],
    ['s5', 14.6, 19.0],
    ['s6', 19.0, 22.0],
    ['s7', 22.0, 24.0],
  ];

  function seek(t) {
    // Background reacts to the whole film so the cuts do not feel like separate clips.
    $('glow').style.opacity = 0.55 + 0.45 * Math.sin((t / 24) * Math.PI);
    $('grid').style.transform = 'translateY(' + (-t * 9).toFixed(2) + 'px)';

    for (const [id, start, end] of SCENES) {
      const el = $(id);
      const a = band(t, start, end, 0.45);
      el.style.opacity = a;
      // A scene that is fully transparent must not intercept anything, and must not cost paint.
      el.style.visibility = a <= 0.001 ? 'hidden' : 'visible';
    }

    // 1 · the mark settles, the name follows
    const m = out(seg(t, 0.15, 1.1));
    $('s1mark').style.transform = 'scale(' + (0.82 + 0.18 * m) + ')';
    $('s1mark').style.opacity = m;
    const n = out(seg(t, 0.75, 0.9));
    $('s1name').style.opacity = n;
    $('s1name').style.transform = 'translateY(' + (26 - 26 * n) + 'px)';

    // 2 · the headline arrives a word at a time
    document.querySelectorAll('#s2 .word').forEach((w, i) => {
      const p = out(seg(t, 3.6 + i * 0.16, 0.85));
      w.style.opacity = p;
      w.style.transform = 'translateY(' + (54 - 54 * p) + 'px)';
    });

    // 3 · a number with nothing behind it
    const e3 = out(seg(t, 7.15, 0.6));
    $('s3eye').style.opacity = e3;
    const pr = out(seg(t, 7.4, 0.8));
    $('s3price').style.opacity = pr;
    $('s3price').style.transform = 'scale(' + (0.94 + 0.06 * pr) + ')';
    const q = out(seg(t, 8.3, 0.9));
    $('s3q').style.opacity = q;
    $('s3q').style.transform = 'translateY(' + (22 - 22 * q) + 'px)';

    // 4 · the same number, sourced
    $('s4eye').style.opacity = out(seg(t, 10.75, 0.6));
    $('s4price').style.opacity = out(seg(t, 10.9, 0.6));
    const b = out(seg(t, 11.5, 0.85));
    $('s4badge').style.opacity = b;
    $('s4badge').style.transform = 'translateY(' + (34 - 34 * b) + 'px) scale(' + (0.94 + 0.06 * b) + ')';
    const s4s = out(seg(t, 12.4, 0.8));
    $('s4sub').style.opacity = s4s;
    $('s4sub').style.transform = 'translateY(' + (24 - 24 * s4s) + 'px)';

    // 5 · three screens, each rising and settling behind the next
    $('s5eye').style.opacity = out(seg(t, 14.75, 0.6));
    const cards = [
      ['c1', 15.1],
      ['c2', 16.3],
      ['c3', 17.5],
    ];
    cards.forEach(([id, start], i) => {
      const el = $(id);
      const p = out(seg(t, start, 1.0));
      const leaving = seg(t, 18.6, 0.4);
      // Each card lands slightly higher and smaller than the one before, so the stack reads
      // as depth rather than as three things in a pile.
      const y = 1600 - 960 * p - i * 34;
      const sc = (0.9 + 0.1 * p) * (1 - i * 0.035);
      el.style.opacity = clamp(p) * (1 - leaving);
      el.style.visibility = el.style.opacity <= 0.001 ? 'hidden' : 'visible';
      el.style.transform = 'translateX(-50%) translateY(' + y.toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
      el.style.zIndex = 10 + i;
    });

    // 6 · the promises
    ['p1', 'p2', 'p3', 'p4'].forEach((id, i) => {
      const p = out(seg(t, 19.2 + i * 0.42, 0.7));
      $(id).style.opacity = p;
      $(id).style.transform = 'translateY(' + (30 - 30 * p) + 'px)';
    });

    // 7 · sign off
    const m7 = out(seg(t, 22.15, 0.9));
    $('s7mark').style.opacity = m7;
    $('s7mark').style.transform = 'scale(' + (0.9 + 0.1 * m7) + ')';
    $('s7url').style.opacity = out(seg(t, 22.7, 0.7));
    // The disclaimer holds through the last two seconds rather than flashing past.
    $('fine').style.opacity = out(seg(t, 22.9, 0.8)) * (1 - seg(t, 23.9, 0.1));
  }

  window.seek = seek;
  seek(0);
</script>`;

/**
 * The player, appended only for the standalone HTML export.
 *
 * The frame renderer needs none of this — it drives `seek(t)` itself, one exact moment at a
 * time. A person opening the file in a browser needs the opposite: something that runs, loops,
 * and can be dragged back to the bit they missed.
 */
const PLAYER = `
<style>
  html, body { width:100%; height:100%; background:#000; display:grid; place-items:center; }
  /*
   * The stage is authored at a fixed 1080x1920 so the animation maths never has to care about
   * the window. Scaling the whole thing keeps every position exact at any size.
   *
   * Centred by translate rather than by flex or grid: a scaled element still occupies its
   * *unscaled* 1080x1920 in layout, so a centring container pushes it off-screen and you get a
   * black page with a bit of glow leaking in at the edge. Taking it out of flow and offsetting
   * from the middle is the version that actually centres.
   */
  #shell { position:fixed; inset:0; overflow:hidden; }
  .stage { position:absolute; left:50%; top:50%; width:${W}px; height:${H}px;
           transform-origin:center center; }

  #bar { position:fixed; left:50%; bottom:26px; transform:translateX(-50%);
         display:flex; align-items:center; gap:16px; padding:12px 20px;
         background:#15191fe6; border:1px solid #ffffff1f; border-radius:999px;
         font-family:system-ui,sans-serif; font-size:13px; color:#aab3bf;
         backdrop-filter:blur(12px); opacity:0; transition:opacity .2s; z-index:10; }
  #shell:hover #bar, #bar:focus-within { opacity:1; }
  #bar button { background:none; border:0; color:#f7f7f2; font:inherit; cursor:pointer;
                padding:4px 8px; border-radius:6px; }
  #bar button:hover { background:#ffffff14; }
  #bar input { width:280px; accent-color:#f97316; cursor:pointer; }
  #time { font-variant-numeric:tabular-nums; min-width:74px; text-align:right; }
</style>
<div id="bar">
  <button id="play" aria-label="Play or pause">Pause</button>
  <input id="scrub" type="range" min="0" max="${DURATION}" step="0.01" value="0"
         aria-label="Scrub the timeline">
  <span id="time">0.0 / ${DURATION}s</span>
  <button id="restart" aria-label="Restart">Restart</button>
</div>
<script>
  const stage = document.querySelector('.stage');
  const shell = document.createElement('div');
  shell.id = 'shell';
  stage.parentNode.insertBefore(shell, stage);
  shell.appendChild(stage);
  shell.appendChild(document.getElementById('bar'));

  // Fit the fixed-size stage to whatever window it is opened in, without distorting it.
  const fit = () => {
    const scale = Math.min(window.innerWidth / ${W}, window.innerHeight / ${H});
    stage.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
  };
  window.addEventListener('resize', fit);
  fit();

  const play = document.getElementById('play');
  const scrub = document.getElementById('scrub');
  const time = document.getElementById('time');

  let t = 0;
  let playing = true;
  let last = performance.now();

  function frame(now) {
    if (playing) {
      // Advance by real elapsed time, so the animation runs at the right speed on any display
      // refresh rate rather than at one unit per frame.
      t = (t + (now - last) / 1000) % ${DURATION};
      scrub.value = t;
    }
    last = now;
    seek(t);
    time.textContent = t.toFixed(1) + ' / ${DURATION}s';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  play.onclick = () => {
    playing = !playing;
    play.textContent = playing ? 'Pause' : 'Play';
  };
  scrub.oninput = () => {
    t = Number(scrub.value);
    playing = false;
    play.textContent = 'Play';
  };
  document.getElementById('restart').onclick = () => {
    t = 0;
    playing = true;
    play.textContent = 'Pause';
  };
  // Space is what everyone presses.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); play.click(); }
  });
</script>`;

/* ------------------------------------------------------------------------- capture */

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

async function browserSocket() {
  for (let i = 0; i < 80; i += 1) {
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

async function main() {
  const htmlOut = flag('html', null);
  if (htmlOut) {
    mkdirSync(dirname(htmlOut), { recursive: true });
    writeFileSync(htmlOut, html + PLAYER);
    process.stdout.write(`${htmlOut}\n`);
    return;
  }

  const frameDir = mkdtempSync(join(tmpdir(), 'brew-promo-'));
  const outPath = flag('out', join(frameDir, 'brew-terminal-9x16.mp4'));
  mkdirSync(dirname(outPath), { recursive: true });

  const shell = spawn(shellPath, [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--hide-scrollbars',
    '--disable-gpu',
    `--user-data-dir=${join(tmpdir(), `brew-promo-profile-${Date.now()}`)}`,
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
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: W, height: H, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );

  const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
  await cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html }, sessionId);

  // Fonts and three inlined screenshots have to decode before the first frame, or the opening
  // seconds render in a fallback face.
  for (let i = 0; i < 80; i += 1) {
    const { result } = await cdp.send(
      'Runtime.evaluate',
      {
        expression: `(async () => {
          if (document.readyState !== 'complete') return false;
          await document.fonts.ready;
          return [...document.images].every((i) => i.complete && i.naturalWidth > 0);
        })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    );
    if (result?.value === true) break;
    await sleep(250);
  }

  /*
   * Preview mode exists because a full render is 720 frames and several minutes, and almost
   * every mistake in a piece like this — a word landing off-screen, two scenes overlapping, a
   * card cropped wrong — is visible in a single still.
   */
  const previewDir = flag('preview', null);
  if (previewDir) {
    mkdirSync(previewDir, { recursive: true });
    // Mid-scene, where everything that animates in has arrived and nothing has left yet.
    const moments = [
      ['1-mark', 2.4],
      ['2-headline', 5.4],
      ['3-problem', 9.4],
      ['4-answer', 13.4],
      ['5-screens', 18.2],
      ['6-promises', 21.2],
      ['7-end', 23.4],
    ];
    for (const [name, t] of moments) {
      await cdp.send('Runtime.evaluate', { expression: `seek(${t});` }, sessionId);
      await sleep(120);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
      const file = join(previewDir, `${name}.png`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      process.stdout.write(`${file}\n`);
    }
    cdp.close();
    shell.kill();
    return;
  }

  const total = Math.round(DURATION * FPS);
  process.stdout.write(`rendering ${total} frames at ${W}×${H}…\n`);

  for (let frame = 0; frame < total; frame += 1) {
    const t = frame / FPS;
    await cdp.send(
      'Runtime.evaluate',
      { expression: `seek(${t});`, returnByValue: true },
      sessionId,
    );
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(
      join(frameDir, `f${String(frame).padStart(5, '0')}.png`),
      Buffer.from(data, 'base64'),
    );
    if (frame % 60 === 0) process.stdout.write(`  ${frame}/${total}\n`);
  }

  cdp.close();
  shell.kill();

  process.stdout.write('encoding…\n');
  const encode = spawnSync(
    ffmpegPath,
    [
      '-y',
      '-framerate',
      String(FPS),
      '-i',
      join(frameDir, 'f%05d.png'),
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '18',
      // yuv420p and even dimensions: without both, the file plays on a desktop and shows a
      // black rectangle on the phone it was made for.
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outPath,
    ],
    { encoding: 'utf8' },
  );
  if (encode.status !== 0) {
    process.stderr.write(encode.stderr?.slice(-2000) ?? 'ffmpeg failed\n');
    process.exit(1);
  }

  // The frames are an intermediate worth hundreds of megabytes; the mp4 is the artefact.
  for (let frame = 0; frame < total; frame += 1) {
    rmSync(join(frameDir, `f${String(frame).padStart(5, '0')}.png`), { force: true });
  }

  process.stdout.write(`${outPath}\n`);
}

main().catch((e) => {
  process.stderr.write(`${e.stack ?? e}\n`);
  process.exit(1);
});
