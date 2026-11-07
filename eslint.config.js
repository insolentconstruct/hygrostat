// Copyright 2026 Insolent Construct. MIT licence: see LICENSE.
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';

// Match dot names, quoted keys and constant template keys, but not private fields.
function propertySelectors(member, value) {
  const path = member ? `${member}.` : '';
  return [
    `[${path}computed=false][${path}property.type='Identifier'][${path}property.name=${value}]`,
    `[${path}computed=true][${path}property.type='Literal'][${path}property.value=${value}]`,
    `[${path}computed=true][${path}property.type='TemplateLiteral'][${path}property.expressions.length=0][${path}property.quasis.0.value.cooked=${value}]`
  ];
}
// Restrict DOM writes, not safe reads used for inspection and assertions.
const markupWrites = [['AssignmentExpression', 'left'], ['UpdateExpression', 'argument']]
  .flatMap(([type, target]) => propertySelectors(target, '/^(innerHTML|outerHTML)$/').map((property) => ({
    selector: `${type}[${target}.type='MemberExpression']${property}`,
    message: 'Use textContent and DOM construction instead of assigning markup.'
  })));
// Include window.document and equivalent qualified/computed document access.
const documentWrites = propertySelectors('object', "'document'").flatMap((object) =>
  propertySelectors('', '/^(write|writeln)$/').map((property) => ({
    selector: `MemberExpression[object.type='MemberExpression']${object}${property}`,
    message: 'Build DOM nodes instead of using document.write or document.writeln.'
  })));

export default [
  { ignores: ['node_modules/**', 'firmware/**', 'public/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: { 'no-eval': 'error', 'no-implied-eval': 'error',
      'no-new-func': 'error', 'no-script-url': 'error' }
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
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-syntax': ['error', ...markupWrites, ...documentWrites],
      'no-restricted-properties': ['error',
        { property: 'insertAdjacentHTML', message: 'Use DOM construction instead of parsing markup.' },
        { object: 'document', property: 'write', message: 'Build DOM nodes instead of writing markup.' },
        { object: 'document', property: 'writeln', message: 'Build DOM nodes instead of writing markup.' }]
    } },
  { files: ['static/js/worker.js'], languageOptions: { globals: globals.worker } },
  { files: ['*.config.js', 'test/**/*.{js,mjs}', 'tools/**/*.{js,mjs}'],
    languageOptions: { globals: globals.nodeBuiltin } },
  { files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  // Playwright callbacks execute in the page; the surrounding harness is Node.
  { files: ['test/*browser.mjs'],
    languageOptions: { globals: { ...globals.nodeBuiltin, ...globals.browser } } }
];
