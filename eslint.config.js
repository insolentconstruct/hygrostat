// Copyright 2026 Insolent Construct. MIT licence: see LICENSE.
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'firmware/**', 'public/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' }
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    // Preserve vendor/generated style; recommended bug checks still apply.
    ignores: ['static/js/glibc_sincos.js', 'static/js/release_guides.js'],
    plugins: { '@stylistic': stylistic },
    rules: {
      '@stylistic/semi': ['error', 'always'],
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
      '@stylistic/no-tabs': 'error',
      '@stylistic/eol-last': ['error', 'always']
    }
  },
  // These rounded glibc constants are checked by exact WAV parity, not rewritten.
  { files: ['static/js/glibc_sincos.js'], rules: { 'no-loss-of-precision': 'off' } },
  { files: ['static/js/**/*.js'], ignores: ['static/js/worker.js'],
    languageOptions: { globals: globals.browser } },
  { files: ['static/js/worker.js'], languageOptions: { globals: globals.worker } },
  { files: ['*.config.js', 'test/**/*.{js,mjs}', 'tools/**/*.{js,mjs}'],
    languageOptions: { globals: globals.nodeBuiltin } },
  { files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  // Playwright callbacks execute in the page; the surrounding harness is Node.
  { files: ['test/*browser.mjs'],
    languageOptions: { globals: { ...globals.nodeBuiltin, ...globals.browser } } }
];
