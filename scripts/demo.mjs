#!/usr/bin/env node
/**
 * Builds the browser demo the way the Pages workflow does, and serves it at the same subpath.
 *
 * The subpath is the point. A demo served from the root works locally and then 404s every asset
 * once GitHub Pages puts it under `/Brew-Terminal/`, which is a class of bug you can only find
 * by reproducing the prefix. `vite preview` honours `base`, so this serves the built output at
 * `http://localhost:4173/Brew-Terminal/` — the same shape as the deployed URL.
 *
 * Node rather than an inline environment variable in package.json: `FOO=bar vite build` is shell
 * syntax that does not exist on Windows, and contributors are on all three platforms.
 *
 *   npm run demo
 */

import { build, preview } from 'vite';

process.env.BREW_DEMO_BASE ??= '/Brew-Terminal/';

await build();

const server = await preview({ preview: { port: 4173, strictPort: true } });
server.printUrls();
