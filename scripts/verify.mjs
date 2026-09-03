#!/usr/bin/env node
/**
 * Runs every gate CI runs, in CI's order, on one command.
 *
 * This exists because the gates were previously four separate commands in CONTRIBUTING.md —
 * `npm run check`, then three `cargo` invocations run from a different directory. `npm run
 * check` is the memorable one, and it covers neither the Rust side nor the build, the bundle
 * budget, or the generated-type drift check. The predictable failure mode is a push that is
 * green locally and red on GitHub for something a formatter would have fixed in a second.
 *
 * Node rather than shell: contributors are on macOS, Windows and Linux, and the bundle-budget
 * step in `.github/workflows/ci.yml` is bash-only. `zlib.gzipSync` measures the same bytes
 * without needing a shell at all.
 *
 * Usage:
 *   node scripts/verify.mjs              every gate
 *   node scripts/verify.mjs --frontend   skip the Rust gates (fast UI loop)
 *   node scripts/verify.mjs --rust       only the Rust gates
 *   node scripts/verify.mjs --fast       skip the two test suites and the build
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

// ARCHITECTURE.md §5. Kept in step with the same number in `.github/workflows/ci.yml`; if you
// change one, change the other.
const BUNDLE_BUDGET_BYTES = 204_800;

const MANIFEST = ['--manifest-path', 'src-tauri/Cargo.toml'];

const args = new Set(process.argv.slice(2));
const fast = args.has('--fast');
const onlyRust = args.has('--rust');
const onlyFrontend = args.has('--frontend');

/** `npx` and `cargo` are batch shims on Windows, which `spawnSync` will not exec directly. */
const shell = process.platform === 'win32';

const results = [];

function run(name, cmd, cmdArgs) {
  process.stdout.write(`\n\x1b[1m── ${name}\x1b[0m\n`);
  const started = Date.now();
  const { status } = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell });
  const ok = status === 0;
  results.push({ name, ok, ms: Date.now() - started });
  return ok;
}

/** For gates that are a check rather than a subprocess. */
function assert(name, fn) {
  process.stdout.write(`\n\x1b[1m── ${name}\x1b[0m\n`);
  const started = Date.now();
  let ok = false;
  try {
    ok = fn() !== false;
  } catch (error) {
    process.stdout.write(`${error.message}\n`);
  }
  results.push({ name, ok, ms: Date.now() - started });
  return ok;
}

function bundleBudget() {
  const dir = join('dist', 'assets');
  const entries = readdirSync(dir).filter((f) => /^index-.*\.js$/.test(f));
  if (entries.length === 0) throw new Error('No dist/assets/index-*.js — did the build run?');

  let largest = 0;
  for (const entry of entries) {
    const size = gzipSync(readFileSync(join(dir, entry))).length;
    process.stdout.write(`${entry}: ${size} bytes gzipped\n`);
    largest = Math.max(largest, size);
  }
  process.stdout.write(`Largest entry chunk: ${largest} (budget: ${BUNDLE_BUDGET_BYTES})\n`);
  if (largest > BUNDLE_BUDGET_BYTES) {
    process.stdout.write('Initial bundle exceeds the 200 KB gzipped budget.\n');
    return false;
  }
  return true;
}

function generatedTypesInStep() {
  // `cargo test` re-exports src/types/generated from the Rust models (ADR-010). A diff here
  // means the models moved and the TypeScript did not. CI compares against the checkout; this
  // compares the working tree against the index, which locally asks the more useful question —
  // did the run just rewrite files you have not accounted for? Staging them satisfies both.
  const { status } = spawnSync('git', ['diff', '--quiet', '--', 'src/types/generated'], { shell });
  if (status !== 0) {
    spawnSync('git', ['diff', '--stat', '--', 'src/types/generated'], { stdio: 'inherit', shell });
    process.stdout.write('src/types/generated is out of date — commit what `cargo test` wrote.\n');
    return false;
  }
  process.stdout.write('Generated types match the Rust models.\n');
  return true;
}

if (!onlyRust) {
  run('Format (prettier)', 'npx', ['prettier', '--check', '.']);
  run('Lint (eslint)', 'npx', ['eslint', '.']);
  run('Typecheck (tsc)', 'npx', ['tsc', '--noEmit']);
  if (!fast) {
    run('Learn content', 'npx', ['vitest', 'run', 'tests/safety/content.test.ts']);
    run('Frontend tests', 'npx', ['vitest', 'run']);
    if (run('Build', 'npx', ['vite', 'build'])) assert('Bundle budget', bundleBudget);
  }
}

if (!onlyFrontend) {
  run('Format (cargo fmt)', 'cargo', ['fmt', ...MANIFEST, '--all', '--', '--check']);
  run('Clippy', 'cargo', ['clippy', ...MANIFEST, '--all-targets', '--', '-D', 'warnings']);
  if (!fast) {
    run('Rust tests', 'cargo', ['test', ...MANIFEST]);
    assert('Generated types', generatedTypesInStep);
  }
}

process.stdout.write('\n\x1b[1m── Summary\x1b[0m\n');
for (const { name, ok, ms } of results) {
  const mark = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  process.stdout.write(`  ${mark}  ${name} \x1b[2m(${(ms / 1000).toFixed(1)}s)\x1b[0m\n`);
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  process.stdout.write(`\n\x1b[31m${failed.length} gate(s) failed.\x1b[0m CI would be red.\n`);
  process.exit(1);
}
process.stdout.write('\n\x1b[32mAll gates passed.\x1b[0m\n');
