// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Beta 4 Start in quality (39) on a synthetic release; no release has it yet.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { validate, encodeProfile, decodeProfile, defaults, share, unshare, crc32 } from '../static/js/profile.js';
import { GROUPS, extraGroup, stateLabel, stateHint, summary } from '../static/js/layout.js';
import { guide } from '../static/js/guide.js';
import { featureHelp } from '../static/js/help.js';
const text = (svg) => [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((m) => m[1]).join(' ');
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
// The firmware pull request's commit; bump it (or set START_QUALITY_FIRMWARE_REF) when that branch moves.
const ref = process.env.START_QUALITY_FIRMWARE_REF || 'daee27cfe4c89531d59da50c98ed582e30e89c4c';
const manifest = JSON.parse(read('../static/manifest.json'));
const additions = JSON.parse(read('fixtures/start-quality-feature.json'));
assert.deepEqual(additions.map((f) => f.id), [39]);
assert(manifest.releases.every((r) => !r.profile.features.some((f) => f.id === 39)), 'no release lists feature 39');
const beta3 = manifest.releases.find((r) => r.slug === 'beta-3-smirr');
const release = structuredClone(beta3);
Object.assign(release, { tag: 'drizzlet-dev-start-quality', name: 'Synthetic fixture (never offered)',
  development: true, source_commit: ref });
release.profile.features.push(...additions);
const [f] = additions;
const entry = (state, value) => [39, state, value, 0, 0, 0];

// Off and Fixed with five values, no controls; Beta 3 refuses it.
for (let value = 0; value < 5; ++value) {
  validate([entry(0, value)], release.profile);
  validate([entry(1, value)], release.profile);
  assert.throws(() => validate([entry(2, value)], release.profile), /not allowed/);
}
assert.throws(() => validate([entry(1, 5)], release.profile), /not allowed/);
for (const k of [3, 4, 5]) {
  const e = entry(1, 4);
  e[k] = 1;
  assert.throws(() => validate([e], release.profile), /not allowed/);
}
assert.throws(() => validate([entry(1, 4)], beta3.profile), /Unknown/);
assert.equal(stateLabel(f, 0), 'Use stock behaviour');
assert.equal(stateLabel(f, 1), 'Start in this quality');
assert.match(stateHint(f, 1), /\[A\] still changes it/);
assert.equal(stateHint({ id: 5 }, 1), 'No control on the module.');
assert.equal(summary(f, entry(1, 4)), 'Starts in Scorched cassette');
assert.equal(summary(f, entry(1, 0)), 'Keep current');
assert.equal(summary(f, entry(0, 4)), 'Stock');
assert.equal(extraGroup(f), 'Startup');
assert(GROUPS.find(([name]) => name === 'Sound')[1].includes(39));
const help = featureHelp(f, release);
assert(help.description.length > 15 && help.description.length < 180);
assert.equal(new URL(help.url).hash, '#start-in-quality');
assert(help.url.includes(ref));

// Profiles without it encode as before; the entry round-trips.
const base = defaults(beta3.profile);
assert.deepEqual(encodeProfile(base, release.profile), encodeProfile(base, beta3.profile));
const chosen = [...base, entry(1, 4)];
const block = encodeProfile(chosen, release.profile);
assert.deepEqual(decodeProfile(block, release.profile), chosen);
assert.deepEqual(unshare(share(release, block), [release]).entries, chosen);
assert.throws(() => decodeProfile(block, beta3.profile), /Unknown/);
for (const mobile of [false, true]) assert.match(text(guide(chosen, release, 'abcd1234', mobile)), /Start in quality: Fixed · Scorched cassette/);

// The firmware's catalogue row and documentation heading.
const catalogue = JSON.parse(firmwareShow(ref, 'beads/build/profile-features.json', { encoding: 'utf8' }));
const docs = firmwareShow(ref, 'beads/build/docs/FEATURES.md', { encoding: 'utf8' });
const c = catalogue.features.find((c) => c.id === 39);
assert.equal(c.name, f.name);
assert.deepEqual(c.values, f.values);
assert.deepEqual(c.states, f.states);
assert.equal(c.field, f.field);
assert.deepEqual([c.page_slots, c.amount_slots, c.actions], [[], [], []]);
assert.equal(c.touches_synth, f.synth_path);
assert.equal(c.default_state, 'Off');
assert(docs.includes(`\n### ${f.name}\n`), f.name);

// The firmware's own parser agrees on every state, value and destination.
const reseal = (b) => { const end = 16 + new DataView(b.buffer).getUint16(6, true); new DataView(b.buffer).setUint32(end, crc32(b.subarray(0, end)), true); return b; };
const listing = (entries) => {
  const b = encodeProfile([], release.profile);
  b[5] = entries.length; b[6] = 6 * entries.length;
  entries.forEach((e, i) => b.set(e, 16 + 6 * i));
  return reseal(b);
};
const cases = [block];
for (let state = 0; state <= 3; ++state) for (let value = 0; value <= 5; ++value) cases.push(listing([entry(state, value)]));
for (const k of [3, 4, 5]) { const e = entry(1, 4); e[k] = 1; cases.push(listing([e])); }
const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-quality-oracle-'));
try {
  mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
  for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) writeFileSync(join(scratch, 'beads', file), firmwareShow(ref, 'beads/' + file));
  const oracle = join(scratch, 'profile-oracle');
  execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
    fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', oracle]);
  const answers = execFileSync(oracle, [], { input: Buffer.concat(cases.map((b) => Buffer.from(b))) });
  const stride = answers.length / cases.length;
  assert(Number.isInteger(stride) && stride > 6);
  let accepted = 0;
  cases.forEach((b, i) => {
    let decoded = null;
    try { decoded = decodeProfile(b, release.profile); } catch { /* compared with the firmware below */ }
    assert.equal(Boolean(decoded), answers[i * stride] === 1, `firmware case ${i}: ${Array.from(b.subarray(16, 22))}`);
    if (decoded) {
      ++accepted;
      assert.deepEqual(decoded.flat(), Array.from(answers.subarray(i * stride + 1, i * stride + 1 + decoded.length * 6)));
    }
  });
  assert.equal(accepted, 1 + 2 * 5, 'the block, and Off or Fixed with a listed value and no destination');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`PASS start in quality: codec, labels, guides and the firmware parser at ${ref.slice(0, 7)}`);
