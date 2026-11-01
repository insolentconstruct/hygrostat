// Copyright 2026 Insolent Construct. MIT licence: see ../LICENSE.
// Exercise the actual CLI/configuration, without changing source files.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
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
  const invalid = run(name, args, bad);
  assert.notEqual(invalid.status, 0, `${name}: negative control escaped`);
  assert.match(invalid.stdout + invalid.stderr, rule, `${name}: failed for the wrong reason`);
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

const html = '<!doctype html><html lang="en"><head><title>Lint</title></head><body>';
const end = '</body></html>\n';
probe('htmlhint', ['--config', '.htmlhintrc'],
  html + '<p id="one">OK</p>' + end,
  html + '<p id="one">OK</p><p id="one">Duplicate</p>' + end, /id-unique/);
probe('stylelint', ['--stdin', '--stdin-filename', 'static/lint-control.html', '--max-warnings=0'],
  '<style>.lint-control { color: red; }</style>\n',
  '<style>.lint-control { colour: red; }</style>\n', /property-no-unknown/);

console.log('PASS lint CLI controls: JS errors/style, worker/Node globals, duplicate HTML IDs and inline CSS typos.');
