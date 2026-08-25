import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import local from './eslint-rules/local.js';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src-tauri/**', 'src/types/generated/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
      local,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      /*
       * Safari/VoiceOver strips list semantics from a <ul> whose list-style is none — which
       * every list in this app sets. WKWebView is our macOS target, so the explicit
       * role="list" is load-bearing there rather than redundant.
       */
      'jsx-a11y/no-redundant-roles': 'off',

      // --- Project guarantees, not style preferences ---
      'local/no-banned-copy': 'error',
      'local/no-cross-feature-import': 'error',
      'local/no-raw-html': 'error',

      // The brief asks for no avoidable `any`. Each remaining one needs a written reason.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Promises that are dropped on the floor hide provider failures.
      '@typescript-eslint/no-floating-promises': 'error',

      // No telemetry by design; console is a last-resort surface only.
      'no-console': ['error', { allow: ['error', 'warn'] }],

      // The webview must not reach the network — all HTTP lives in Rust. See ADR-002.
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'All network I/O happens in Rust. Add a Tauri command instead. See ADR-002.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'fetch',
          message: 'All network I/O happens in Rust. Add a Tauri command instead. See ADR-002.',
        },
      ],
    },
  },

  // The browser harness is a fixture server, and its dispatch seam is genuinely untyped.
  {
    files: ['src/lib/ipc.browser.ts'],
    rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },
  },

  // Tests may reach for the escape hatches the app code may not.
  {
    files: ['tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'local/no-banned-copy': 'off',
    },
  },

  // Config files run in Node.
  {
    files: ['*.config.{js,ts}', 'eslint-rules/**/*.js', 'vitest.setup.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
