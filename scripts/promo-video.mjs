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
 * on PATH; without one it renders the frames and then fails at the last step.
 *
 * The animation is a **pure function of time**. The page exposes `seek(t)` and every property
 * is computed from `t` alone; nothing depends on requestAnimationFrame or the wall clock. That
 * is what makes the capture deterministic: a slow frame cannot drop anything, because the
 * renderer is asked for an exact moment rather than whatever it has drawn by now.
 *
 *   node scripts/screenshots.mjs      # the app shots and the anchor file this composes
 *   node scripts/promo-video.mjs --html ~/Desktop/brew-terminal-promo-9x16.html
 *
 * Options:
 *   --out <path>   where to write the mp4  (default: a temp directory, printed at the end)
 *   --fps <n>      frames per second       (default: 30)
 *   --preview <d>  write one still per beat into <d> and stop, for checking the design
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
const W = 1080;
const H = 1920;
const PORT = 9335;

const shellPath = join(
  homedir(),
  'Library/Caches/ms-playwright/chromium_headless_shell-1228',
  'chrome-headless-shell-mac-x64/chrome-headless-shell',
);
// A real ffmpeg if there is one; Playwright's minimal build otherwise, which will refuse the
// H.264 options below. See the note at the top.
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

/* --------------------------------------------------------------------------- geometry */

/** The app's own coordinate space — the viewport the screenshots were taken at. */
const SHOT_W = 1440;
const SHOT_H = 900;
/** The demo window, in stage coordinates. */
const PORT_W = 960;
const PORT_H = 600;
/** The zoom at which the whole app exactly fills the window. */
const Z_FIT = PORT_W / SHOT_W;
const DEMO_TOP = 740;
const BAR_H = 44;

/**
 * Where things are, measured rather than guessed.
 *
 * Every coordinate in this film comes out of `docs/screenshots/anchors.json`, which is written
 * by the same browser run that takes the screenshots. That is not tidiness — it is the fix for
 * a specific bug. Positions were once read off a *separately running* copy of the app, whose
 * navigation rail happened to be collapsed; every panel sat about 140px to the left of where
 * the pictures had it, and the first zoom landed on the rail instead of on the badge it was
 * meant to be showing. Same run, same numbers, or the two drift apart again.
 */
const anchorPath = join('docs', 'screenshots', 'anchors.json');
let anchors;
try {
  anchors = JSON.parse(readFileSync(anchorPath, 'utf8'));
} catch {
  process.stderr.write(`no ${anchorPath} — run \`node scripts/screenshots.mjs\` first\n`);
  process.exit(1);
}

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

/** One measured control: `{ box: [x, y, w, h], role, name }`. */
const anchorOf = (shotName, anchor) => {
  const found = anchors[shotName]?.[anchor];
  if (!found) fail(`${shotName} has no anchor "${anchor}" — is it in ANCHORS in screenshots.mjs?`);
  return found;
};

/**
 * Keep the frame inside the picture.
 *
 * A camera centred near an edge at high zoom shows the page background past the edge of the
 * screenshot, which reads as a rendering fault rather than as a choice.
 */
const inside = ([x, y], z) => {
  const hw = PORT_W / 2 / z;
  const hh = PORT_H / 2 / z;
  return [Math.min(Math.max(x, hw), SHOT_W - hw), Math.min(Math.max(y, hh), SHOT_H - hh)];
};

/**
 * How far to push in, decided by the size of what is being shown.
 *
 * Fixed zooms are what make a film look like it was assembled rather than directed: the same
 * 1.6x that frames a table row beautifully turns a 36-pixel toggle into a speck, and the same
 * push that makes the toggle readable slices a lesson card into three words. Solving for the
 * fraction of the frame the subject should occupy gives every beat the framing it needs, and
 * the clamps keep it inside what the source pixels can actually support — the screenshots are
 * 2x, so past about 2.2 the image is being invented rather than shown.
 */
const Z_MIN = 1.12;
const Z_MAX = 2.2;
const fit = (b, fraction) => {
  if (!Array.isArray(b) || b.length < 4) fail(`a look or target has no measured size: ${b}`);
  const byW = (PORT_W * fraction) / Math.max(b[2], 8);
  const byH = (PORT_H * fraction) / Math.max(b[3], 8);
  return Math.min(Z_MAX, Math.max(Z_MIN, Math.min(byW, byH)));
};

/**
 * Where the cursor comes in from: the far side of the frame, diagonally.
 *
 * Twelve hand-typed entry points were twelve numbers that had to be re-checked every time a
 * panel moved. Approaching from whichever half of the screen the target is *not* in gives a
 * long, legible travel every time, and costs nothing to maintain.
 */
const entryFor = (b) => [
  Math.min(Math.max(b[0] + (b[0] > SHOT_W / 2 ? -440 : 440), 70), SHOT_W - 70),
  Math.min(Math.max(b[1] + (b[1] > SHOT_H / 2 ? -260 : 260), 70), SHOT_H - 70),
];

/**
 * Where to point the camera so a given box is *readable*, not merely centred.
 *
 * Half these targets are full-width rows — a lesson card, a position, a ticker line. Centring
 * one at any useful zoom pushes both its ends out of frame and leaves the middle, which for a
 * table row is a column of numbers with no labels attached. Whatever names the row lives at its
 * left edge, so a box wider than the frame is aimed at its start instead of its middle.
 */
const aim = (b, z) => {
  const halfW = PORT_W / 2 / z;
  const halfH = PORT_H / 2 / z;
  const wide = b.length >= 4 && b[2] * z > PORT_W;
  const tall = b.length >= 4 && b[3] * z > PORT_H;
  return inside(
    [wide ? b[0] - b[2] / 2 - 40 + halfW : b[0], tall ? b[1] - b[3] / 2 - 30 + halfH : b[1]],
    z,
  );
};

/* ------------------------------------------------------------------------- the script */

/**
 * Twelve beats, one per part of the app.
 *
 * `target` is what the cursor clicks, and it is always a control that is genuinely clickable in
 * the real app — a tab, a switch, a sort menu, a row that opens something. Pointing at a static
 * badge and pretending it was pressed is the kind of small lie that a viewer feels without
 * being able to name, and the badge is the thing the film is asking them to trust.
 *
 * `look` is where the camera settles afterwards: the consequence, not the control.
 */
const BEATS = [
  {
    shot: '01-pulse',
    label: 'Pulse',
    hero: true,
    target: 'cryptoTab',
    look: 'providerBadge',
    caption: ['Every panel names its source', 'Which provider it came from, and how old it is.'],
  },
  {
    shot: '05-research',
    label: 'Research Lab',
    target: 'showNumbers',
    look: 'showNumbers',
    caption: ['No chart without its numbers', 'One line opens every point it was drawn from.'],
  },
  {
    shot: '07-compare',
    label: 'Compare',
    target: 'addAsset',
    look: 'showNumbers',
    caption: ['Line them up on one axis', 'Rebased to a shared start, so the shapes compare.'],
  },
  {
    shot: '06-screener',
    label: 'Screener',
    target: 'sort',
    look: 'exportCsv',
    caption: ['Filter the whole market', 'Price, cap, change — then sort it, then take it away.'],
  },
  {
    shot: '11-portfolio',
    label: 'Portfolio',
    target: 'recordTrade',
    look: 'position',
    caption: [
      'What you hold, and what it did',
      'FIFO cost basis, worked out here, from your entries.',
    ],
  },
  {
    shot: '02-sentry',
    callout: 'The hazard row',
    label: 'Sentry',
    hero: true,
    target: 'watchRow',
    look: 'map',
    caption: [
      'A hazard, a place, the distance',
      'Within 500 km of a shipping chokepoint — and which one.',
    ],
  },
  {
    shot: '03-atlas',
    label: 'Atlas',
    target: 'pause',
    look: 'tickerRow',
    caption: ['A ticker you can stop', 'A number you cannot finish reading is not information.'],
  },
  {
    shot: '08-learn',
    callout: 'Stocks Basics',
    label: 'Learn',
    target: 'firstLesson',
    look: 'glossary',
    caption: [
      'Start from the beginning',
      'Five paths and a glossary, for someone new to all of it.',
    ],
  },
  {
    shot: '10-notes',
    callout: 'A saved note',
    label: 'Notes',
    target: 'noteCard',
    look: 'noteBody',
    caption: [
      'Write down why you did it',
      'Kept on this computer. Never sent anywhere on its own.',
    ],
  },
  {
    shot: '09-desk',
    label: 'Model Desk',
    target: 'setUp',
    look: 'panel',
    caption: [
      'The AI is optional, and off',
      'Nothing reaches a model until you go and set one up.',
    ],
  },
  {
    shot: '04-connectors',
    label: 'Connectors',
    hero: true,
    target: 'stageFilter',
    look: 'notReviewed',
    caption: ['Ninety sources nobody has vetted', 'So those rows stay empty, and say so.'],
  },
  {
    shot: '12-settings',
    label: 'Settings',
    target: 'saveKey',
    look: 'keyField',
    caption: [
      'Your keys, your keychain',
      'Held by the OS. Never in the database, logs or exports.',
    ],
  },
];

const TOUR_FROM = 8.0;
const HERO = 2.9;
const PLAIN = 1.93;
const CROSS = 0.3;

/** Beat timings, and the keyframes derived from them. */
let cursorAt = TOUR_FROM;
const DEMOS = BEATS.map((beat) => {
  const from = cursorAt;
  const dur = beat.hero ? HERO : PLAIN;
  const to = from + dur;
  cursorAt = to;

  const target = anchorOf(beat.shot, beat.target);
  const hit = target.box;
  const look = anchorOf(beat.shot, beat.look);

  /*
   * Two framings, both solved rather than typed.
   *
   * The click framing gives the control about a third of the width, so you see what surrounds
   * it. The resting framing gives the subject almost the whole frame, because that is the shot
   * a viewer actually has to *read* — and on a phone the difference between 1.6x and as-deep-
   * as-the-pixels-allow is the difference between a provider badge and a grey smudge.
   *
   * Which way the camera then travels falls out of the content: clicking a small button and
   * resting on a wide table is a pull-back; clicking a wide row and resting on a link is a push
   * in. When the two land on the same number the move would be static, so the click framing
   * steps back to leave the beat somewhere to go.
   */
  const endZoom = fit(look.box, 0.9);
  let midZoom = fit(hit, 0.3);
  if (Math.abs(midZoom - endZoom) < 0.25) midZoom = Math.max(Z_MIN, endZoom * 0.66);
  const wide = [SHOT_W / 2, SHOT_H / 2];
  const midPt = aim(hit, midZoom);
  const endPt = aim(look.box, endZoom);
  const enter = entryFor(hit);

  /*
   * The one thing this film must not get wrong.
   *
   * Everything else is taste; a cursor pressing a control that is not in the picture is a claim
   * the frame contradicts. It cannot happen given `aim` and `zoomFor`, which is exactly why it
   * is worth asserting — the check costs nothing and it is the invariant that would rot first.
   */
  const halfW = PORT_W / 2 / midZoom;
  const halfH = PORT_H / 2 / midZoom;
  if (Math.abs(hit[0] - midPt[0]) > halfW - 8 || Math.abs(hit[1] - midPt[1]) > halfH - 8) {
    fail(`${beat.shot}: "${beat.target}" would be outside the frame at the moment it is clicked`);
  }

  return {
    shot: beat.shot.replace(/[^a-z]/g, ''),
    label: beat.label,
    from,
    to,
    click: from + 0.58 * dur,
    hit,
    // What the control is called, read off the live DOM at capture time. A film that points at
    // something can say what it pointed at, and this is the only spelling that cannot be wrong.
    callout: beat.callout ?? target.name,
    role: target.role,
    caption: beat.caption,
    /*
     * Five keyframes rather than four, and the two extras are both about the cuts.
     *
     * The first sits *before* the beat opens, slightly pushed in, so the shot arrives already
     * settling rather than snapping to a stop — which is what absorbs the jolt of dissolving
     * out of the previous beat's deep zoom. The last sits after the beat closes, still drifting
     * in, so the outgoing shot keeps moving while it fades instead of freezing mid-gesture.
     *
     * The page reads these with a spline, not with per-segment easing, so the camera carries
     * its velocity through the middle keyframes instead of coming to rest at each one — except
     * where a keyframe is deliberately repeated, which the spline honours as a hold. That hold
     * is the still moment the click lands in: a press photographed mid-pan is a smear, and the
     * label naming the control has to be readable while it is on screen.
     */
    cam: [
      [from - CROSS, wide[0], wide[1], Z_FIT * 1.1],
      [from + 0.12 * dur, wide[0], wide[1], Z_FIT],
      [from + 0.5 * dur, midPt[0], midPt[1], midZoom],
      [from + 0.68 * dur, midPt[0], midPt[1], midZoom],
      [to, endPt[0], endPt[1], endZoom],
      [to + CROSS, endPt[0], endPt[1], endZoom * 1.02],
    ],
    // `back` overshoots and settles, the way a hand arrives at a button rather than gliding to
    // a mathematical stop.
    cursor: [
      [from + 0.02 * dur, enter[0], enter[1], 'inOut'],
      [from + 0.52 * dur, hit[0], hit[1], 'back'],
      [from + 0.72 * dur, hit[0], hit[1], 'inOut'],
      [to, endPt[0] - 44, endPt[1] + 36, 'inOut'],
    ],
  };
});

const TOUR_TO = cursorAt;
const PROMISES_FROM = TOUR_TO + 0.2;
const END_FROM = PROMISES_FROM + 2.2;
const DURATION = Number((END_FROM + 2.3).toFixed(2));

const IMAGES = BEATS.map((b) => [b.shot.replace(/[^a-z]/g, ''), b.shot]);

/* ------------------------------------------------------------------------------ page */

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
  .glow { position:absolute; inset:0; will-change:opacity,transform;
          background:radial-gradient(70% 45% at 50% 40%, #f9731633 0%, transparent 62%); }
  .glow2 { position:absolute; inset:0; will-change:opacity;
           background:radial-gradient(55% 34% at 50% 62%, #38bdf826 0%, transparent 66%); }
  .grid { position:absolute; inset:0; opacity:.5; will-change:transform;
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
             letter-spacing:.2em; text-transform:uppercase; will-change:opacity,transform; }
  .mono { font-family:'JB',monospace; }
  .mark { width:150px; will-change:opacity,transform; }
  .word { display:inline-block; will-change:opacity,transform; }
  .rule { width:0; height:5px; border-radius:3px; background:#f97316; margin-top:46px;
          will-change:width,opacity; }

  .price { font-family:'JB',monospace; font-weight:600; font-size:118px; letter-spacing:-.03em;
           will-change:opacity,transform; }
  .badge { display:inline-flex; align-items:center; gap:16px;
           padding:20px 34px; border:2px solid #f9731655; border-radius:999px;
           background:#f9731612; font-size:30px; will-change:opacity,transform; }
  .dot { width:14px; height:14px; border-radius:50%; background:#3fb950; }
  .qmark { color:#79838f; font-size:34px; will-change:opacity,transform; }
  .swap { position:relative; height:120px; width:100%; margin-top:44px; }
  .swap > * { position:absolute; left:0; right:0; display:flex; justify-content:center; top:0; }

  /* --- the demo window --- */
  .demo { position:absolute; left:${(W - PORT_W) / 2}px; top:${DEMO_TOP}px; width:${PORT_W}px;
          border-radius:22px; overflow:hidden; background:#15191f; border:1px solid #ffffff14;
          box-shadow:0 40px 90px -20px #000c, 0 110px 200px -60px #000;
          will-change:opacity,transform; }
  .demo .bar { height:${BAR_H}px; display:flex; align-items:center; gap:10px; padding:0 18px;
               background:#ffffff08; border-bottom:1px solid #ffffff0f; }
  .demo .bar i { width:14px; height:14px; border-radius:50%; display:block; }
  .port { position:relative; width:${PORT_W}px; height:${PORT_H}px; overflow:hidden; }
  /*
   * transform-origin at the top-left corner is what makes the camera maths simple: a point in
   * image space lands at (portCentre + (point - focus) * zoom), with no second offset to track.
   */
  .port img { position:absolute; left:0; top:0; width:${SHOT_W}px; transform-origin:0 0;
              will-change:transform,opacity; }

  /*
   * The cursor, the ripple and the hit box live *inside* the window rather than beside it, so
   * the window's float and tilt carry them along for free — and so the port's own overflow
   * clips them, which is what a real pointer over a real window does.
   */
  .cursor { position:absolute; width:44px; height:44px; margin:-3px 0 0 -2px; pointer-events:none;
            filter:drop-shadow(0 6px 14px #000b); will-change:transform,opacity; z-index:6; }
  .ripple { position:absolute; border:3px solid #f97316; border-radius:50%; pointer-events:none;
            width:34px; height:34px; margin:-17px 0 0 -17px;
            will-change:transform,opacity; z-index:5; }
  .hitbox { position:absolute; border:2.5px solid #f97316; border-radius:8px; pointer-events:none;
            background:#f9731618; box-shadow:0 0 0 6px #f9731614;
            will-change:transform,opacity,width,height; z-index:4; }
  .sheen { position:absolute; inset:0; pointer-events:none; z-index:7; will-change:opacity,transform;
           background:linear-gradient(105deg, transparent 34%, #ffffff1f 50%, transparent 66%); }

  .chip { position:absolute; left:0; right:0; top:388px; text-align:center;
          will-change:opacity,transform; }
  .chip span { display:inline-block; padding:12px 26px; border-radius:999px;
               border:1px solid #f9731644; background:#f9731614; color:#f97316;
               font-family:'JB',monospace; font-size:24px; letter-spacing:.16em;
               text-transform:uppercase; }

  .caption { position:absolute; left:0; right:0; top:460px; padding:0 100px; text-align:center;
             will-change:transform; }
  .caption .k { font-size:52px; font-weight:650; letter-spacing:-.028em; line-height:1.14;
                will-change:opacity,transform,clip-path; }
  .caption .v { margin-top:20px; font-size:29px; color:#aab3bf; line-height:1.45;
                will-change:opacity,transform,clip-path; }

  .ticks { position:absolute; left:0; right:0; top:1440px; display:flex; justify-content:center;
           gap:10px; will-change:opacity; }
  .where { position:absolute; left:0; right:0; top:1502px; text-align:center;
           font-family:'JB',monospace; font-size:26px; color:#79838f; letter-spacing:.02em;
           will-change:opacity; }
  .ticks i { display:block; height:6px; width:22px; border-radius:3px; background:#ffffff1f;
             will-change:width,background; }

  /* Names the control the cursor just pressed, in the app's own words. */
  .callout { position:absolute; z-index:7; pointer-events:none; white-space:nowrap;
             padding:7px 12px; border-radius:9px; border:1px solid #f9731655;
             background:#0b0d10ee; color:#f7f7f2; font-family:'JB',monospace; font-size:15px;
             letter-spacing:.01em; box-shadow:0 10px 26px -8px #000e;
             will-change:opacity,transform; }
  .callout b { color:#f97316; font-weight:500; }

  .promise { font-size:44px; font-weight:600; letter-spacing:-.02em; margin:22px 0;
             will-change:opacity,transform; }
  .promise span { color:#f97316; }
  .url { font-family:'JB',monospace; font-size:30px; color:#aab3bf; margin-top:36px;
         will-change:opacity; }
  .fine { position:absolute; bottom:150px; left:0; right:0; text-align:center;
          font-size:22px; color:#79838f; line-height:1.5; padding:0 130px; will-change:opacity; }
</style>

<div class="stage">
  <div class="glow" id="glow"></div>
  <div class="glow2" id="glow2"></div>
  <div class="grid" id="grid"></div>

  <div class="scene" id="s1">
    <img class="mark" id="s1mark" src="${mark}" alt="">
    <div style="height:52px"></div>
    <h2 id="s1name">Brew&nbsp;Terminal</h2>
  </div>

  <div class="scene" id="s2">
    <h1><span class="word">Markets,</span> <span class="word">minus</span>
        <span class="word">the</span> <span class="word">gatekeeping.</span></h1>
    <div class="rule" id="s2rule"></div>
  </div>

  <div class="scene" id="s3">
    <div style="position:relative;height:34px;width:100%">
      <div class="eyebrow" id="eyeA" style="position:absolute;left:0;right:0">Every finance app</div>
      <div class="eyebrow" id="eyeB" style="position:absolute;left:0;right:0">Brew&nbsp;Terminal</div>
    </div>
    <div style="height:56px"></div>
    <div class="price" id="price">$61,240.55</div>
    <div class="swap">
      <div class="qmark" id="qmark">From where? How old? Says who?</div>
      <div id="badgeWrap"><div class="badge" id="badge"><span class="dot"></span>
        <span class="mono">CoinGecko&nbsp;·&nbsp;12s ago</span></div></div>
    </div>
  </div>

  <!-- twelve beats share one window; only the image and the camera change -->
  <div class="demo" id="demo">
    <div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i>
      <i style="background:#28c840"></i></div>
    <div class="port">
${IMAGES.map(([id, file]) => `      <img id="im_${id}" src="${shot(file)}" alt="">`).join('\n')}
      <div class="hitbox" id="hitbox"></div>
      <div class="ripple" id="ripple"></div>
      <div class="ripple" id="ripple2"></div>
      <svg class="cursor" id="cursor" viewBox="0 0 24 24" fill="none">
        <path d="M5 2.5 L5 19.5 L9.6 15.2 L12.3 21.4 L15.2 20.1 L12.6 14.1 L18.8 13.9 Z"
              fill="#ffffff" stroke="#08090b" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>
      <div class="callout" id="callout"><b id="calloutRole"></b> <span id="calloutName"></span></div>
      <div class="sheen" id="sheen"></div>
    </div>
  </div>

  <div class="caption" id="cap"><div class="k" id="capK"></div><div class="v" id="capV"></div></div>
  <div class="chip" id="chip"><span id="chipText"></span></div>
  <div class="ticks" id="ticks">${BEATS.map(() => '<i></i>').join('')}</div>
  <div class="where" id="where">github.com/KleivinX/Brew-Terminal</div>

  <div class="scene" id="s8">
    <div class="promise" id="p1">Runs on <span>your</span> machine</div>
    <div class="promise" id="p2">No account. No telemetry.</div>
    <div class="promise" id="p3">No <span>buy</span>. No <span>sell</span>. No verdicts.</div>
    <div class="promise" id="p4">Free and open source</div>
  </div>

  <div class="scene" id="s9">
    <img class="mark" id="s9mark" src="${mark}" alt="">
    <div style="height:44px"></div>
    <h2>Brew&nbsp;Terminal</h2>
    <div class="url" id="s9url">github.com/KleivinX/Brew-Terminal</div>
  </div>
  <div class="fine" id="fine">A research tool, not an adviser. Not financial advice.<br>
    Your decisions, and their consequences, are your own.</div>
</div>

<script>
  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { a = a === undefined ? 0 : a; b = b === undefined ? 1 : b;
                                   return Math.min(b, Math.max(a, v)); };
  var lerp = function (a, b, p) { return a + (b - a) * p; };

  /*
   * Entrances decelerate; camera moves ease at both ends, the way a real one is driven; 'back'
   * overshoots a little and settles, which is what makes the cursor read as a hand rather than
   * as a tween.
   */
  var out = function (p) { return 1 - Math.pow(1 - clamp(p), 3); };
  var outQuint = function (p) { return 1 - Math.pow(1 - clamp(p), 5); };
  var inOut = function (p) { p = clamp(p);
    return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  var back = function (p) { p = clamp(p);
    var c = 1.42; var q = p - 1; return 1 + (c + 1) * q * q * q + c * q * q; };
  var EASE = { out: out, inOut: inOut, back: back, outQuint: outQuint };

  var seg = function (t, start, dur) { return clamp((t - start) / dur); };
  var band = function (t, start, end, fade) {
    return Math.min(seg(t, start, fade), 1 - seg(t, end - fade, fade));
  };

  /**
   * Value of a keyframe track at time t.
   *
   * Declaring motion as [time, value] pairs rather than as arithmetic per property is what keeps
   * the camera legible: a move is two numbers and a duration, and the easing between them is
   * named on the frame it arrives at, so nothing drifts out of step with anything else.
   */
  function track(t, keys, dflt) {
    if (t <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i += 1) {
      if (t <= keys[i][0]) {
        var a = keys[i - 1], b = keys[i];
        var ease = EASE[b[2] || dflt || 'inOut'] || inOut;
        return lerp(a[1], b[1], ease((t - a[0]) / (b[0] - a[0])));
      }
    }
    return keys[keys.length - 1][1];
  }
  /*
   * Pull one channel out of a multi-value track.
   *
   * The last slot is an easing *name* on the cursor track and a zoom *number* on the camera
   * track, so the type is what decides whether it is an easing at all. Passing a zoom through
   * as an easing name looks up undefined and throws inside seek() — and a throw there is
   * invisible: the frame still renders, with everything after the throw left at whatever it
   * held before, which reads as a layout bug rather than as an error.
   */
  var pick = function (keys, n) {
    return keys.map(function (k) {
      var last = k[k.length - 1];
      return [k[0], k[n], typeof last === 'string' ? last : undefined];
    });
  };

  /**
   * A monotone cubic through the camera keyframes.
   *
   * Per-segment easing is what the cursor wants and what the camera does not. An ease-in-out
   * between every pair of keys has zero velocity at each one, so a four-key move is really
   * three moves with two full stops inside it — legible frame by frame, and visibly steppy in
   * motion. A spline carries velocity across the interior keys, which is the difference between
   * a camera being driven and a camera being posed.
   *
   * Monotone (Fritsch-Carlson) rather than plain Catmull-Rom, for two reasons that both matter
   * here. It cannot overshoot, so the camera never swings past the edge of a screenshot on its
   * way to a corner. And a node beside a flat segment gets a flat tangent, which turns a
   * repeated keyframe into a genuine hold — the still moment the film needs at each click,
   * where Catmull-Rom would have drifted through it in a shallow curve.
   */
  function spline(t, keys) {
    var n = keys.length;
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    var i = 1;
    while (i < n - 1 && t > keys[i][0]) i += 1;

    var slope = function (a, b) {
      return (keys[b][1] - keys[a][1]) / (keys[b][0] - keys[a][0]);
    };
    var node = function (a, b) {
      return a * b <= 0 ? 0 : (a + b) / 2;
    };

    var d = slope(i - 1, i);
    var m1 = i >= 2 ? node(slope(i - 2, i - 1), d) : 0;
    var m2 = i + 1 < n ? node(d, slope(i, i + 1)) : 0;

    // The Fritsch-Carlson limiter: keep the tangents inside the circle of radius 3 so the
    // segment stays monotone whatever the neighbouring keys do.
    if (d !== 0) {
      var scale = 3 / Math.hypot(m1 / d, m2 / d);
      if (scale < 1) {
        m1 *= scale;
        m2 *= scale;
      }
    }

    var t1 = keys[i - 1][0], v1 = keys[i - 1][1];
    var t2 = keys[i][0], v2 = keys[i][1];
    var h = t2 - t1;
    var u = (t - t1) / h;
    var u2 = u * u, u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * v1 +
      (u3 - 2 * u2 + u) * m1 * h +
      (-2 * u3 + 3 * u2) * v2 +
      (u3 - u2) * m2 * h
    );
  }

  var PORT_W = ${PORT_W}, PORT_H = ${PORT_H}, Z_FIT = ${Z_FIT};
  var SHOT_W = ${SHOT_W}, SHOT_H = ${SHOT_H};
  var DURATION = ${DURATION}, CROSS = ${CROSS};
  var TOUR_FROM = ${TOUR_FROM}, TOUR_TO = ${TOUR_TO};
  var PROMISES_FROM = ${PROMISES_FROM}, END_FROM = ${END_FROM};
  var DEMOS = ${JSON.stringify(DEMOS)};

  /**
   * Points the camera: image point (cam.x, cam.y) lands at the centre of the window, at cam.z.
   *
   * transform-origin is the image's top-left corner, which is what keeps this to one line and
   * inPort below to one line — every other origin needs a second offset tracked alongside.
   */
  function camera(img, cam) {
    var x = PORT_W / 2 - cam.x * cam.z;
    var y = PORT_H / 2 - cam.y * cam.z;
    img.style.transform =
      'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px) scale(' + cam.z.toFixed(4) + ')';
  }

  /** Where image point (px, py) sits inside the window, under that same camera. */
  function inPort(cam, px, py) {
    return {
      x: PORT_W / 2 + (px - cam.x) * cam.z,
      y: PORT_H / 2 + (py - cam.y) * cam.z,
    };
  }

  /*
   * A spline is allowed to overshoot between keys, which for a camera is a feature everywhere
   * except at the edges of the picture: half a frame of page background past the corner of a
   * screenshot reads as a rendering fault. Clamping here rather than flattening the spline
   * keeps the motion and loses only the overshoot that would have shown nothing.
   */
  function camAt(d, t) {
    var z = Math.max(Z_FIT, spline(t, pick(d.cam, 3)));
    var hw = PORT_W / 2 / z, hh = PORT_H / 2 / z;
    return {
      x: Math.min(Math.max(spline(t, pick(d.cam, 1)), hw), SHOT_W - hw),
      y: Math.min(Math.max(spline(t, pick(d.cam, 2)), hh), SHOT_H - hh),
      z: z,
    };
  }

  /** On-screen speed of the shot right now, in window pixels per second. */
  function camSpeed(d, t) {
    var dt = 1 / 40;
    var a = camAt(d, t - dt), b = camAt(d, t + dt);
    var pan = Math.hypot((b.x - a.x) * b.z, (b.y - a.y) * b.z);
    var push = (Math.abs(b.z - a.z) / Math.max(b.z, 0.001)) * PORT_W * 0.7;
    return (pan + push) / (2 * dt);
  }

  var lastCaption = -1;

  function seek(t) {
    /* --- the room the whole thing sits in. Never still. --- */
    var pulse = 0.5 + 0.5 * Math.sin((t / DURATION) * Math.PI);
    var beatFlash = 0;
    for (var b = 0; b < DEMOS.length; b += 1) {
      beatFlash = Math.max(beatFlash, Math.exp(-Math.pow((t - DEMOS[b].from) / 0.22, 2)));
    }
    $('glow').style.opacity = 0.46 + 0.44 * pulse + 0.3 * beatFlash;
    $('glow').style.transform =
      'scale(' + (1 + 0.05 * Math.sin(t * 0.55) + 0.03 * beatFlash).toFixed(4) + ')';
    $('glow2').style.opacity = (0.35 + 0.3 * Math.sin(t * 0.4 + 1.6)).toFixed(3);
    $('grid').style.transform =
      'translate(' + (Math.sin(t * 0.22) * 14).toFixed(2) + 'px,' + (-t * 9).toFixed(2) + 'px)';

    /* --- opening --- */
    var a1 = band(t, 0, 1.95, 0.3);
    $('s1').style.opacity = a1;
    $('s1').style.visibility = a1 <= 0.001 ? 'hidden' : 'visible';
    $('s1').style.transform = 'scale(' + (1 + 0.05 * seg(t, 0, 2.2)).toFixed(4) + ')';
    var m = out(seg(t, 0.1, 0.85));
    $('s1mark').style.transform =
      'scale(' + (0.7 + 0.3 * m) + ') rotate(' + ((1 - m) * -9).toFixed(2) + 'deg)';
    $('s1mark').style.opacity = m;
    var n = out(seg(t, 0.55, 0.7));
    $('s1name').style.opacity = n;
    $('s1name').style.transform = 'translateY(' + (30 - 30 * n) + 'px)';

    var a2 = band(t, 1.9, 4.05, 0.3);
    $('s2').style.opacity = a2;
    $('s2').style.visibility = a2 <= 0.001 ? 'hidden' : 'visible';
    var words = document.querySelectorAll('#s2 .word');
    for (var i = 0; i < words.length; i += 1) {
      var p = out(seg(t, 2.05 + i * 0.09, 0.6));
      words[i].style.opacity = p;
      words[i].style.transform =
        'translateY(' + (58 - 58 * p) + 'px) rotate(' + ((1 - p) * -2.4).toFixed(2) + 'deg)';
    }
    var r = outQuint(seg(t, 2.5, 0.9));
    $('s2rule').style.width = (r * 340).toFixed(1) + 'px';
    $('s2rule').style.opacity = r;

    /*
     * The problem and the answer are one scene, not two.
     *
     * A cut between "here is a number with no provenance" and "here is the same number with it"
     * throws away the only thing that makes the point: that it is the *same number*. So the
     * price stays put and the things around it are swapped underneath it.
     */
    var a3 = band(t, 3.95, TOUR_FROM + 0.15, 0.3);
    $('s3').style.opacity = a3;
    $('s3').style.visibility = a3 <= 0.001 ? 'hidden' : 'visible';
    var flip = 5.85;
    $('eyeA').style.opacity = out(seg(t, 4.1, 0.45)) * (1 - seg(t, flip - 0.25, 0.25));
    $('eyeB').style.opacity = out(seg(t, flip + 0.05, 0.4));
    var pr = out(seg(t, 4.25, 0.6));
    var bump = Math.exp(-Math.pow((t - flip) / 0.2, 2));
    $('price').style.opacity = pr;
    $('price').style.transform = 'scale(' + (0.94 + 0.06 * pr + 0.045 * bump).toFixed(4) + ')';
    var q = out(seg(t, 4.7, 0.6)) * (1 - seg(t, flip - 0.3, 0.3));
    $('qmark').style.opacity = q;
    $('qmark').style.transform = 'translateY(' + (24 - 24 * clamp(q)) + 'px)';
    var bd = out(seg(t, flip + 0.12, 0.55));
    $('badgeWrap').style.opacity = bd;
    $('badgeWrap').style.transform =
      'translateY(' + (34 - 34 * bd) + 'px) scale(' + (0.9 + 0.1 * back(seg(t, flip + 0.12, 0.55))).toFixed(4) + ')';

    /* --- the tour --- */
    var demo = $('demo');
    var live = band(t, TOUR_FROM - 0.35, TOUR_TO + 0.4, 0.36);
    demo.style.opacity = live;
    demo.style.visibility = live <= 0.001 ? 'hidden' : 'visible';
    // The window is never quite still: a slow float and a degree of tilt, so the frame reads as
    // a thing sitting in space rather than as a pasted rectangle.
    var bob = Math.sin(t * 0.85) * 7;
    var tilt = Math.sin(t * 0.42) * 0.55;
    demo.style.transform =
      'perspective(2600px) translateY(' + bob.toFixed(2) + 'px) ' +
      'rotateY(' + tilt.toFixed(3) + 'deg) rotateX(' + (-tilt * 0.45).toFixed(3) + 'deg) ' +
      'scale(' + (0.965 + 0.035 * clamp(live * 1.5)).toFixed(4) + ')';

    var idx = -1;
    for (var j = 0; j < DEMOS.length; j += 1) {
      if (t >= DEMOS[j].from && t < DEMOS[j].to) { idx = j; break; }
    }
    if (idx === -1) idx = t >= TOUR_TO ? DEMOS.length - 1 : 0;
    var d = DEMOS[idx];
    var into = t - d.from;

    // Every image keeps its own camera, so a dissolve is two live shots crossing rather than a
    // swap: the outgoing frame drifts on where it was left.
    for (var k = 0; k < DEMOS.length; k += 1) {
      var dk = DEMOS[k];
      var img = $('im_' + dk.shot);
      var op = 0;
      if (k === idx) op = 1;
      else if (k === idx - 1) op = 1 - clamp(into / CROSS);
      img.style.opacity = op;
      if (op > 0) {
        camera(img, camAt(dk, t));
        /*
         * A touch of blur while the camera is moving fast.
         *
         * The film is a pure function of time, which means every frame is a perfectly sharp
         * instant — and a fast push made of perfectly sharp instants strobes, because nothing
         * on screen carries any trace of where it just was. Scaling a blur with the camera's
         * own speed puts that trace back. It is the single cheapest thing that separates
         * "animated" from "filmed".
         */
        var blur = Math.min(1.7, Math.max(0, (camSpeed(dk, t) - 420) / 900));
        img.style.filter = blur > 0.06 ? 'blur(' + blur.toFixed(2) + 'px)' : 'none';
      }
    }

    var cam = camAt(d, t);
    var cx = track(t, pick(d.cursor, 1));
    var cy = track(t, pick(d.cursor, 2));
    var at = inPort(cam, cx, cy);

    /*
     * At a boundary the cursor would otherwise jump from wherever the last beat left it to
     * wherever the next one starts. Blending in port space across the dissolve turns that jump
     * into a sweep — and a sweep is what sells the idea that this is one continuous session.
     */
    if (idx > 0 && into < CROSS) {
      var prev = DEMOS[idx - 1];
      var pAt = inPort(
        camAt(prev, t),
        track(prev.to, pick(prev.cursor, 1)),
        track(prev.to, pick(prev.cursor, 2)),
      );
      var mix = out(into / CROSS);
      at = { x: lerp(pAt.x, at.x, mix), y: lerp(pAt.y, at.y, mix) };
    }

    var press = 1 - 0.2 * Math.exp(-Math.pow((t - d.click) / 0.12, 2));
    $('cursor').style.opacity = live;
    $('cursor').style.transform =
      'translate(' + at.x.toFixed(1) + 'px,' + at.y.toFixed(1) + 'px) scale(' + press.toFixed(3) + ')';

    // Two rings, staggered, so the click lands with a bit of weight.
    var rings = [['ripple', 0], ['ripple2', 0.11]];
    for (var g = 0; g < rings.length; g += 1) {
      var rp = seg(t, d.click + rings[g][1], 0.62);
      var el = $(rings[g][0]);
      el.style.opacity = rp > 0 && rp < 1 ? (1 - rp) * 0.9 * live : 0;
      el.style.transform =
        'translate(' + at.x.toFixed(1) + 'px,' + at.y.toFixed(1) + 'px) ' +
        'scale(' + (0.35 + outQuint(rp) * 2.7).toFixed(3) + ')';
    }

    /*
     * The control that was actually pressed, outlined at its measured size. It is the film's
     * receipt: the highlight is drawn from the same box the anchor file recorded, so it can
     * only ever sit on something the app really has.
     */
    var hb = $('hitbox');
    var hv = Math.exp(-Math.pow((t - d.click - 0.06) / 0.34, 2)) * live;
    var tl = inPort(cam, d.hit[0] - d.hit[2] / 2 - 5, d.hit[1] - d.hit[3] / 2 - 5);
    hb.style.opacity = hv;
    hb.style.width = ((d.hit[2] + 10) * cam.z).toFixed(1) + 'px';
    hb.style.height = ((d.hit[3] + 10) * cam.z).toFixed(1) + 'px';
    hb.style.transform =
      'translate(' + tl.x.toFixed(1) + 'px,' + tl.y.toFixed(1) + 'px) ' +
      'scale(' + (1 + 0.06 * (1 - hv)).toFixed(3) + ')';

    /*
     * The receipt, in words.
     *
     * The outline already proves the cursor landed on a real box. Naming it closes the loop:
     * the text comes from the control's own accessible name, captured off the live DOM in the
     * same pass that measured the box, so the film cannot label a button the app does not have.
     */
    var co = $('callout');
    var cov = Math.exp(-Math.pow((t - d.click - 0.14) / 0.4, 2)) * live;
    if (idx !== lastCaption) {
      $('calloutRole').textContent = d.role;
      $('calloutName').textContent = d.callout;
    }
    var side = at.x > PORT_W - 260 ? -1 : 1;
    co.style.opacity = cov;
    co.style.transform =
      'translate(' + (at.x + (side > 0 ? 26 : -26)).toFixed(1) + 'px,' +
      (at.y + 26 - 8 * cov).toFixed(1) + 'px)' +
      (side > 0 ? '' : ' translateX(-100%)');

    // One pass of light across the glass as each beat opens.
    var sh = clamp(into / 0.55);
    $('sheen').style.opacity = (into < 0.55 ? (1 - sh) * 0.75 : 0) * live;
    $('sheen').style.transform = 'translateX(' + lerp(-PORT_W, PORT_W, sh).toFixed(1) + 'px)';

    /* --- captions and the route chip --- */
    if (idx !== lastCaption) {
      $('capK').textContent = d.caption[0];
      $('capV').textContent = d.caption[1];
      $('chipText').textContent = d.label;
      lastCaption = idx;
    }
    $('cap').style.transform =
      'translateY(' + (Math.sin(t * 0.7) * 4 - 5 * clamp(into / (d.to - d.from))).toFixed(2) + 'px)';
    /*
     * The lines wipe on and wipe off rather than fading.
     *
     * A cross-fade between two pieces of text spends a third of a second with both of them
     * half-present, which at this size is just grey mush. A wipe hands the frame over cleanly:
     * one line is always fully legible or fully gone. The inset is inflated vertically so the
     * mask never clips a descender.
     */
    var capIn = outQuint(seg(t, d.from + 0.06, 0.4));
    var capOut = 1 - seg(t, d.to - 0.24, 0.24);
    var wipe = function (el, on, off) {
      el.style.clipPath =
        'inset(-26% ' + (100 - 100 * on).toFixed(1) + '% -26% ' + (100 - 100 * off).toFixed(1) + '%)';
    };
    $('capK').style.opacity = live;
    $('capK').style.transform = 'translateY(' + (18 - 18 * clamp(capIn)).toFixed(1) + 'px)';
    wipe($('capK'), capIn, capOut);
    var capV = outQuint(seg(t, d.from + 0.16, 0.44));
    $('capV').style.opacity = live;
    $('capV').style.transform = 'translateY(' + (16 - 16 * clamp(capV)).toFixed(1) + 'px)';
    wipe($('capV'), capV, capOut);
    var chip = back(seg(t, d.from + 0.02, 0.4));
    $('chip').style.opacity = clamp(seg(t, d.from + 0.02, 0.3)) * capOut * live;
    $('chip').style.transform = 'scale(' + (0.86 + 0.14 * chip).toFixed(3) + ')';

    $('ticks').style.opacity = live;
    $('where').style.opacity = live * 0.9;
    // The active tick fills as its beat runs, so the bar reads as "where in this, and how much
    // of it is left" rather than only as "which one".
    var through = clamp((t - d.from) / (d.to - d.from)) * 100;
    var ti = $('ticks').children;
    for (var q2 = 0; q2 < ti.length; q2 += 1) {
      var on = q2 === idx;
      ti[q2].style.width = (22 + 32 * (on ? 1 : 0)).toFixed(1) + 'px';
      var stop = through.toFixed(1) + '%';
      ti[q2].style.background = on
        ? 'linear-gradient(90deg,#f97316 ' + stop + ',#f9731633 ' + stop + ')'
        : q2 < idx
          ? '#f9731677'
          : '#ffffff1f';
    }

    /* --- closing --- */
    var a8 = band(t, PROMISES_FROM - 0.1, END_FROM + 0.1, 0.3);
    $('s8').style.opacity = a8;
    $('s8').style.visibility = a8 <= 0.001 ? 'hidden' : 'visible';
    var ps = ['p1', 'p2', 'p3', 'p4'];
    for (var u = 0; u < ps.length; u += 1) {
      var pp = out(seg(t, PROMISES_FROM + u * 0.28, 0.5));
      $(ps[u]).style.opacity = pp;
      $(ps[u]).style.transform =
        'translateY(' + (34 - 34 * pp) + 'px) scale(' + (0.97 + 0.03 * pp).toFixed(3) + ')';
    }

    var a9 = band(t, END_FROM, DURATION + 0.2, 0.3);
    $('s9').style.opacity = a9;
    $('s9').style.visibility = a9 <= 0.001 ? 'hidden' : 'visible';
    var m9 = out(seg(t, END_FROM + 0.1, 0.7));
    $('s9mark').style.opacity = m9;
    $('s9mark').style.transform = 'scale(' + (0.86 + 0.14 * back(seg(t, END_FROM + 0.1, 0.7))) + ')';
    $('s9url').style.opacity = out(seg(t, END_FROM + 0.55, 0.55));
    $('fine').style.opacity = out(seg(t, END_FROM + 0.75, 0.6)) * (1 - seg(t, DURATION - 0.15, 0.15));
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
  #time { font-variant-numeric:tabular-nums; min-width:78px; text-align:right; }
</style>
<div id="bar">
  <button id="play" aria-label="Play or pause">Pause</button>
  <input id="scrub" type="range" min="0" max="${DURATION}" step="0.01" value="0"
         aria-label="Scrub the timeline">
  <span id="time">0.0 / ${DURATION}s</span>
  <button id="restart" aria-label="Restart">Restart</button>
</div>
<script>
  var stage = document.querySelector('.stage');
  var shell = document.createElement('div');
  shell.id = 'shell';
  stage.parentNode.insertBefore(shell, stage);
  shell.appendChild(stage);
  shell.appendChild(document.getElementById('bar'));

  // Fit the fixed-size stage to whatever window it is opened in, without distorting it.
  var fit = function () {
    var scale = Math.min(window.innerWidth / ${W}, window.innerHeight / ${H});
    stage.style.transform = 'translate(-50%, -50%) scale(' + scale + ')';
  };
  window.addEventListener('resize', fit);
  fit();

  var play = document.getElementById('play');
  var scrub = document.getElementById('scrub');
  var time = document.getElementById('time');

  var t = 0;
  var playing = true;
  var last = performance.now();

  function frame(now) {
    if (playing) {
      /*
       * Advance by real elapsed time, so the film runs at the right speed on any refresh rate
       * rather than at one unit per frame — but cap the step. A browser stops firing
       * requestAnimationFrame in a background tab, so coming back after a minute would hand us
       * a sixty-second delta and teleport the film most of the way through. A capped step
       * resumes where it left off.
       */
      var step = Math.min((now - last) / 1000, 1 / 15);
      t = (t + step) % ${DURATION};
      scrub.value = t;
    }
    last = now;
    seek(t);
    time.textContent = t.toFixed(1) + ' / ${DURATION}s';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  play.onclick = function () {
    playing = !playing;
    play.textContent = playing ? 'Pause' : 'Play';
  };
  scrub.oninput = function () {
    t = Number(scrub.value);
    playing = false;
    play.textContent = 'Play';
  };
  document.getElementById('restart').onclick = function () {
    t = 0;
    playing = true;
    play.textContent = 'Pause';
  };
  // Space is what everyone presses.
  window.addEventListener('keydown', function (e) {
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

/**
 * Drive the film to one moment, and refuse to carry on if it threw.
 *
 * An exception inside seek() does not blank the page — it leaves every property after the throw
 * at its previous value, so the render completes and the mistake looks like a design decision.
 * Surfacing it here is the difference between one confusing still and a thousand.
 */
async function seekAt(cdp, sessionId, t) {
  const res = await cdp.send(
    'Runtime.evaluate',
    { expression: `seek(${t});`, returnByValue: true },
    sessionId,
  );
  if (res.exceptionDetails) {
    const detail = res.exceptionDetails;
    throw new Error(`seek(${t}) threw: ${detail.exception?.description ?? detail.text}`);
  }
}

async function main() {
  const htmlOut = flag('html', null);
  if (htmlOut) {
    mkdirSync(dirname(htmlOut), { recursive: true });
    writeFileSync(htmlOut, html + PLAYER);
    process.stdout.write(`${htmlOut}  (${DURATION}s, ${BEATS.length} features)\n`);
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

  // Fonts and a dozen inlined screenshots have to decode before the first frame, or the opening
  // seconds render in a fallback face.
  for (let i = 0; i < 120; i += 1) {
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
   * Preview mode exists because a full render is a thousand frames and several minutes, and
   * almost every mistake in a piece like this — a word landing off-screen, a zoom overshooting
   * the panel, a cursor pointing at nothing — is visible in a single still.
   */
  const previewDir = flag('preview', null);
  if (previewDir) {
    mkdirSync(previewDir, { recursive: true });
    const moments = [
      ['01-mark', 1.1],
      ['02-headline', 3.1],
      ['03-problem', 5.3],
      ['04-answer', 7.2],
    ];
    DEMOS.forEach((d, i) => {
      const n = String(i + 5).padStart(2, '0');
      moments.push([`${n}-${d.shot}-click`, d.click + 0.08]);
      moments.push([`${n}-${d.shot}-end`, d.to - 0.34]);
    });
    moments.push(['29-promises', PROMISES_FROM + 1.4]);
    moments.push(['30-end', END_FROM + 1.5]);

    for (const [name, t] of moments) {
      await seekAt(cdp, sessionId, t);
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
    await seekAt(cdp, sessionId, t);
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
