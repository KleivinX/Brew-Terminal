import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Tauri sets this when developing against a device on the local network.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@content': fileURLToPath(new URL('./content', import.meta.url)),
    },
  },
  // Tauri surfaces Rust errors in the terminal; clearing the screen would eat them.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    ...(host ? { hmr: { protocol: 'ws' as const, host, port: 1421 } } : {}),
    watch: {
      // Rust rebuilds are driven by cargo, not Vite.
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // The 2016 Intel MacBook's WKWebView is the floor we target.
    target: 'safari15',
    // Vite 8 minifies with oxc; esbuild is no longer bundled.
    minify: 'oxc',
    sourcemap: false,
    chunkSizeWarningLimit: 250,
    // No manual vendor chunking: route-level React.lazy already does the splitting that
    // matters, and there is no CDN cache to benefit from a separate vendor file in a
    // desktop app. Revisit only if measurement says otherwise.
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    /*
     * The default 5s is too tight for the longer interaction flows on the reference 2016
     * dual-core machine — several of them drive a dozen user actions through jsdom, and they
     * intermittently timed out when a Rust build was competing for CPU. The tests pass; they
     * just need headroom. Raised rather than trimmed, because shortening the flows would mean
     * testing less of the path a user actually takes.
     */
    testTimeout: 15_000,
  },
});
