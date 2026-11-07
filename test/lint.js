// Copyright 2026 Insolent Construct. MIT licence: see ../LICENSE.
// Exercise the actual CLI/configuration, without changing source files.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
let positiveControls = 0;
let negativeControls = 0;
function run(name, args, input) {
  const metadata = new URL(`node_modules/${name}/package.json`, root);
  const pkg = JSON.parse(readFileSync(metadata));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[name];
  assert(bin, `${name}: CLI missing`);
  // HTMLHint consumes files; the other CLIs support stdin.
  const temporary = name === 'htmlhint' ? mkdtempSync(join(tmpdir(), 'hygrostat-lint-')) : null;
  try {
    const filename = temporary && join(temporary, 'control.html');
    if (filename) writeFileSync(filename, input);
    const result = spawnSync(process.execPath,
      [fileURLToPath(new URL(bin, metadata)), ...args, ...(filename ? [filename] : [])], {
        cwd: fileURLToPath(root), input: filename ? undefined : input, encoding: 'utf8'
      });
    assert.ifError(result.error);
    return result;
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

function probe(name, args, good, bad, rule) {
  const valid = run(name, args, good);
  assert.equal(valid.status, 0, `${name}: positive control failed\n${valid.stdout}${valid.stderr}`);
  ++positiveControls;
  const invalid = run(name, args, bad);
  assert.notEqual(invalid.status, 0, `${name}: negative control escaped`);
  assert.match(invalid.stdout + invalid.stderr, rule, `${name}: failed for the wrong reason`);
  ++negativeControls;
}

const js = ['--stdin', '--stdin-filename', 'static/js/lint-control.js'];
probe('eslint', js, "console.log('ok');\n", 'missingLintValue();\n', /no-undef/);
probe('eslint', js, "console.log('ok');\n", 'process.exit(0);\n', /no-undef/);
probe('eslint', js, "console.log('ok');\n", "console.log('ok')\n", /@stylistic\/semi/);
probe('eslint', ['--stdin', '--stdin-filename', 'static/js/worker.js'],
  "self.postMessage('ok');\n", "document.title = 'bad';\n", /no-undef/);
probe('eslint', ['--stdin', '--stdin-filename', 'test/lint-control.js'],
  'process.exitCode = 0;\n', "document.title = 'bad';\n", /no-undef/);

// Generated/vendor sources keep bug checks even though their style is preserved.
probe('eslint', ['--stdin', '--stdin-filename', 'static/js/release_guides.js'],
  'export const guides = []\n', 'export const guides = missingGuide;\n', /no-undef/);
probe('eslint', ['--stdin', '--stdin-filename', 'static/js/glibc_sincos.js'],
  'export const rounded = 0.10000000000000000000000000000000001;\n',
  'export const rounded = missingVendorValue;\n', /no-undef/);

// Data strings are passed to lint only; none of these examples execute.
const safeCallback = "setTimeout(() => console.log('ok'), 0);\n";
for (const [bad, rule] of [
  ["eval('1 + 1');\n", /no-eval/],
  ["setTimeout('missingCallback()', 0);\n", /no-implied-eval/],
  ["new Function('return 1;');\n", /no-new-func/]
]) probe('eslint', js, safeCallback, bad, rule);
probe('eslint', js, "const url = 'https://example.com/'; console.log(url);\n",
  "const url = 'javascript:alert(1)'; console.log(url);\n", /no-script-url/);
for (const filename of ['static/js/glibc_sincos.js', 'static/js/release_guides.js',
  'static/js/worker.js', 'tools/lint-control.js']) {
  probe('eslint', ['--stdin', '--stdin-filename', filename],
    'export const checked = () => 1;\n', "eval('1 + 1');\n", /no-eval/);
}
const safeDOM = "const node = document.createElement('p'); node.textContent = '<safe>'; document.body.append(node);\n";
for (const bad of [
  "document.body.innerHTML = '<p>bad</p>';\n",
  "document.body['innerHTML'] += '<p>bad</p>';\n",
  "document.body.outerHTML = '<p>bad</p>';\n",
  "document.body['outerHTML'] = '<p>bad</p>';\n",
  "document.body[`innerHTML`] = '<p>bad</p>';\n",
  "document.body[`outerHTML`] = '<p>bad</p>';\n",
  'document.body.innerHTML++;\n',
  "document.body['outerHTML']++;\n",
  "window.document.write('<p>bad</p>');\n",
  "globalThis['document']['writeln']('<p>bad</p>');\n",
  "window[`document`][`write`]('<p>bad</p>');\n"
]) probe('eslint', js, safeDOM, bad, /no-restricted-syntax/);
for (const bad of [
  "document.body.insertAdjacentHTML('beforeend', '<p>bad</p>');\n",
  "document.body['insertAdjacentHTML']('beforeend', '<p>bad</p>');\n",
  "document.write('<p>bad</p>');\n",
  "document['writeln']('<p>bad</p>');\n"
]) probe('eslint', js, safeDOM, bad, /no-restricted-properties/);
// DOM reads remain allowed in production and in Playwright assertions.
for (const filename of ['static/js/lint-control.js', 'test/browser.mjs']) {
  const result = run('eslint', ['--stdin', '--stdin-filename', filename],
    "console.log(document.body.innerHTML, document.body['outerHTML']);\n");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  ++positiveControls;
}
const privateField = run('eslint', js,
  "class State { #innerHTML = ''; update() { this.#innerHTML = 'text'; return this.#innerHTML; } } console.log(new State().update());\n");
assert.equal(privateField.status, 0, privateField.stdout + privateField.stderr);
++positiveControls;

const html = '<!doctype html><html lang="en"><head><title>Lint</title></head><body>';
const end = '</body></html>\n';
probe('htmlhint', ['--config', '.htmlhintrc'],
  html + '<p id="one">OK</p>' + end,
  html + '<p id="one">OK</p><p id="one">Duplicate</p>' + end, /id-unique/);
probe('stylelint', ['--stdin', '--stdin-filename', 'static/lint-control.html', '--max-warnings=0'],
  '<style>.lint-control { color: red; }</style>\n',
  '<style>.lint-control { colour: red; }</style>\n', /property-no-unknown/);

console.log(`PASS ${positiveControls} positive and ${negativeControls} negative lint CLI controls: JS errors/style, worker/Node globals, execution/DOM guards, duplicate HTML IDs and inline CSS typos.`);
