// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Random pitch steps' third value, Recent notes (Beta 3), on a synthetic release; no offered release has it yet.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { validate, encodeProfile, decodeProfile, defaults, share, unshare, cpuUsage, crc32 } from '../static/js/profile.js';
import { edit } from '../static/js/layout.js';
import { guide } from '../static/js/guide.js';
import { featureHelp } from '../static/js/help.js';
const text = (svg) => [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((m) => m[1]).join(' ');
const read = (file) => readFileSync(new URL(file, import.meta.url));
const manifest = JSON.parse(read('../static/manifest.json'));
const beta2 = manifest.releases[0];
const stock = beta2.profile.features.find((f) => f.id === 10);
const feature = JSON.parse(read('fixtures/recent-notes-feature.json'));
assert(manifest.releases.every((r) => r.profile.features.find((f) => f.id === 10).values.length === 2),
  'no offered release lists Recent notes');

// The firmware catalogue lists the third value; nothing else about ID 10 changes but the page range.
const ref = process.env.RECENT_NOTES_FIRMWARE_REF || 'faee6bd898a835422a6c048846e84e9f48b47686';
const catalogue = JSON.parse(firmwareShow(ref, 'beads/build/profile-features.json'));
const current = JSON.parse(read('../static/profile-features.json'));
const next = catalogue.features.find((c) => c.id === 10);
const now = current.features.find((c) => c.id === 10);
for (const key of Object.keys(now)) {
  if (key === 'values') assert.deepEqual(next.values, [...now.values, 'Recent notes']);
  else if (key === 'page_slots') assert.deepEqual(next.page_slots, Array.from({ length: 21 }, (_, n) => n + 1));
  else assert.deepEqual(next[key], now[key], key);
}
// The manifest entry follows the catalogue and otherwise keeps the Beta 2 entry.
assert.deepEqual(feature.values, next.values);
assert.equal(feature.field, next.field);
assert.equal(feature.synth_path, next.touches_synth);
for (const key of Object.keys(stock)) {
  if (!['values', 'cpu'].includes(key)) assert.deepEqual(feature[key], stock[key], key);
}
assert.equal(feature.cpu, null, 'Beta 3 costs are not yet measured on the module');

const release = structuredClone(beta2);
Object.assign(release, { tag: 'drizzlet-dev-recent-notes', name: 'Synthetic fixture (never offered)',
  development: true, source_commit: ref });
release.profile.features[release.profile.features.findIndex((f) => f.id === 10)] = structuredClone(feature);
const entry = (state, value) => [10, state, value, 0, 0, 0];
const base = defaults(release.profile);
assert.deepEqual(base, defaults(beta2.profile), 'Free stays the default');
assert.deepEqual(encodeProfile(base, release.profile), encodeProfile(base, beta2.profile));

// Fixed and Adjustable Recent notes encode, round-trip and share; Beta 2 refuses value 2.
for (const state of [1, 2]) {
  validate([entry(state, 2)], release.profile);
  assert.throws(() => validate([entry(state, 3)], release.profile), /not allowed|range/);
  assert.throws(() => validate([entry(state, 2)], beta2.profile), /not allowed|range/);
}
const fixed = edit(edit(base, release.profile, feature, 1, 1), release.profile, feature, 2, 2);
assert.deepEqual(fixed.find((e) => e[0] === 10), entry(1, 2));
const block = encodeProfile(fixed, release.profile);
assert.deepEqual(decodeProfile(block, release.profile), fixed);
assert.deepEqual(unshare(share(release, block), [release]).entries, fixed);
assert.throws(() => decodeProfile(block, beta2.profile));

// Guides show three zones and the red third value; help mentions it only where offered.
for (const mobile of [false, true]) {
  const shown = text(guide(base, release, 'abcd1234', mobile));
  assert(shown.includes('Recent notes'), 'guide lists Recent notes');
  const red = (svg) => text(svg).split('red; steady').length;
  assert.equal(red(guide(base, release, 'abcd1234', mobile)), red(guide(base, beta2, 'abcd1234', mobile)) + 1, 'one more steady red value');
  assert(!text(guide(base, beta2, 'abcd1234', mobile)).includes('Recent notes'));
}
assert(text(guide(fixed, release, 'abcd1234', false)).includes('Random pitch steps: Fixed · Recent notes'));
assert.match(featureHelp(feature, release).details, /Recent notes: with PITCH patched.*last 1-8 notes.*unpatched it plays as Free/);
assert(!featureHelp(stock, beta2).details.includes('Recent notes'));

// Until Beta 3 is measured: the default and Fixed Free stay within the baseline; Fifths and Recent notes are not yet measured.
assert.deepEqual(cpuUsage(base, release).engines, cpuUsage(base, beta2).engines);
const free = edit(base, release.profile, feature, 1, 1);
assert.deepEqual(cpuUsage(free, release).engines, cpuUsage(base, beta2).engines);
for (const value of [1, 2]) {
  const usage = cpuUsage(edit(free, release.profile, feature, 2, value), release);
  assert.equal(usage.kind, 'not yet measured');
  assert.deepEqual(usage.unknown, ['Random pitch steps']);
}

// Every state and value of ID 10 against the compiled firmware parser at the same commit.
const reseal = (b) => { const end = 16 + new DataView(b.buffer).getUint16(6, true); new DataView(b.buffer).setUint32(end, crc32(b.subarray(0, end)), true); return b; };
const single = (e) => { const b = encodeProfile([], release.profile); b[5] = 1; b[6] = 6; b.set(e, 16); return reseal(b); };
// Adjustable needs its page slot (the factory one); value 3 is out of range everywhere.
const cases = [];
for (let state = 0; state <= 3; ++state) for (let value = 0; value <= 3; ++value) cases.push(single([10, state, value, state === 2 ? 2 : 0, 0, 0]));
const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-recent-notes-oracle-'));
try {
  mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
  for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) writeFileSync(join(scratch, 'beads', file), firmwareShow(ref, 'beads/' + file));
  const oracle = join(scratch, 'profile-oracle');
  execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
    fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', oracle]);
  const answers = execFileSync(oracle, [], { input: Buffer.concat(cases.map((b) => Buffer.from(b))) });
  const stride = 493;
  assert.equal(answers.length, cases.length * stride);
  const accepted = [];
  cases.forEach((b, i) => {
    let decoded = null;
    try { decoded = decodeProfile(b, release.profile); } catch { /* compared with the firmware below */ }
    assert.equal(Boolean(decoded), answers[i * stride] === 1, `firmware case ${i}: ${Array.from(b.subarray(16, 22))}`);
    if (decoded) {
      accepted.push(Array.from(b.subarray(17, 19)).join(':'));
      assert.deepEqual(decoded.flat(), Array.from(answers.subarray(i * stride + 1, i * stride + 1 + decoded.length * 6)));
    }
  });
  for (const state of [1, 2]) {
    assert(accepted.includes(`${state}:2`), `state ${state} accepts Recent notes`);
    assert(!accepted.includes(`${state}:3`), `state ${state} refuses value 3`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`PASS Recent notes: catalogue at ${ref.slice(0, 7)}, codec, share links, guides, help, CPU classification and firmware parser`);
