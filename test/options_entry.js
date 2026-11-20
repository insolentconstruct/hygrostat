// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Beta 4 options page preview (37) and opening page (38) on a synthetic release; no release has them yet.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { validate, encodeProfile, decodeProfile, defaults, share, unshare, crc32 } from '../static/js/profile.js';
import { GROUPS, extraGroup, stateLabel, summary } from '../static/js/layout.js';
import { guide } from '../static/js/guide.js';
import { featureHelp } from '../static/js/help.js';
const text = (svg) => [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((m) => m[1]).join(' ');
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
// The firmware merge commit of #286 (override with OPTIONS_ENTRY_FIRMWARE_REF).
const ref = process.env.OPTIONS_ENTRY_FIRMWARE_REF || 'af6ca9f8fa4116904c38e4c5701d8f9f563ad52d';
const manifest = JSON.parse(read('../static/manifest.json'));
const additions = JSON.parse(read('fixtures/options-entry-features.json'));
assert.deepEqual(additions.map((f) => f.id), [37, 38]);
assert(manifest.releases.every((r) => !r.profile.features.some((f) => f.id >= 37)), 'no release lists features 37 or 38');
const beta3 = manifest.releases.find((r) => r.slug === 'beta-3-smirr');
const release = structuredClone(beta3);
Object.assign(release, { tag: 'drizzlet-dev-options-entry', name: 'Synthetic fixture (never offered)',
  development: true, source_commit: ref });
release.profile.features.push(...additions);
const entry = (id, state, value) => [id, state, value, 0, 0, 0];

// Off and Fixed values only, no controls; Beta 3 refuses them.
for (const f of additions) {
  for (let value = 0; value < 2; ++value) {
    validate([entry(f.id, 0, value)], release.profile);
    validate([entry(f.id, 1, value)], release.profile);
    assert.throws(() => validate([entry(f.id, 2, value)], release.profile), /not allowed/);
  }
  assert.throws(() => validate([entry(f.id, 1, 2)], release.profile), /not allowed/);
  for (const k of [3, 4, 5]) {
    const e = entry(f.id, 1, 1);
    e[k] = 1;
    assert.throws(() => validate([e], release.profile), /not allowed/);
  }
  assert.throws(() => validate([entry(f.id, 1, 1)], beta3.profile), /Unknown/);
  assert.equal(stateLabel(f, 0), 'Use stock behaviour');
  assert.equal(summary(f, entry(f.id, 1, 1)), 'Always ' + f.values[1]);
  assert.equal(extraGroup(f), 'Indicators and interface');
  assert(GROUPS.find(([name]) => name === 'Controls')[1].includes(f.id));
  const help = featureHelp(f, release);
  assert(help.description.length > 15 && help.description.length < 180);
  assert.equal(new URL(help.url).hash, '#' + f.name.toLowerCase().replace(/\s/g, '-'));
  assert(help.url.includes(ref));
}

// Profiles without them encode as before; both entries round-trip.
const base = defaults(beta3.profile);
assert.deepEqual(encodeProfile(base, release.profile), encodeProfile(base, beta3.profile));
const both = [...base, entry(37, 1, 1), entry(38, 1, 1)];
const block = encodeProfile(both, release.profile);
assert.deepEqual(decodeProfile(block, release.profile), both);
assert.deepEqual(unshare(share(release, block), [release]).entries, both);
assert.throws(() => decodeProfile(block, beta3.profile), /Unknown/);

// Guides say what the choices change; Off keeps the usual lines.
for (const mobile of [false, true]) {
  const svg = text(guide(both, release, 'abcd1234', mobile));
  assert.match(svg, /Release\. Opens on the first page\./);
  assert.match(svg, /\[A\] shows the page’s first setting\./);
  assert.match(svg, /Options page preview: Fixed · First setting only/);
  for (const off of [[], [entry(37, 0, 1), entry(38, 0, 1)], [entry(37, 1, 0), entry(38, 1, 0)]]) {
    const plain = text(guide([...base, ...off], release, 'abcd1234', mobile));
    assert(!plain.includes('Opens on the first page') && plain.includes('[A] shows stored values.'));
  }
}

// The firmware's catalogue rows and documentation headings.
const catalogue = JSON.parse(firmwareShow(ref, 'beads/build/profile-features.json', { encoding: 'utf8' }));
const docs = firmwareShow(ref, 'beads/build/docs/FEATURES.md', { encoding: 'utf8' });
for (const f of additions) {
  const c = catalogue.features.find((c) => c.id === f.id);
  assert.equal(c.name, f.name);
  assert.deepEqual(c.values, f.values);
  assert.deepEqual(c.states, f.states);
  assert.equal(c.field, f.field);
  assert.deepEqual([c.page_slots, c.amount_slots, c.actions], [[], [], []]);
  assert.equal(c.touches_synth, f.synth_path);
  assert.equal(c.default_state, 'Off');
  assert(docs.includes(`\n### ${f.name}\n`), f.name);
}

// The firmware's own parser agrees on every state, value and destination.
const reseal = (b) => { const end = 16 + new DataView(b.buffer).getUint16(6, true); new DataView(b.buffer).setUint32(end, crc32(b.subarray(0, end)), true); return b; };
const listing = (entries) => {
  const b = encodeProfile([], release.profile);
  b[5] = entries.length; b[6] = 6 * entries.length;
  entries.forEach((e, i) => b.set(e, 16 + 6 * i));
  return reseal(b);
};
const cases = [block, listing([entry(37, 1, 1), entry(38, 1, 1)])];
for (const id of [37, 38]) {
  for (let state = 0; state <= 3; ++state) for (let value = 0; value <= 2; ++value) cases.push(listing([entry(id, state, value)]));
  for (const k of [3, 4, 5]) { const e = entry(id, 1, 1); e[k] = 1; cases.push(listing([e])); }
}
const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-entry-oracle-'));
try {
  mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
  for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) writeFileSync(join(scratch, 'beads', file), firmwareShow(ref, 'beads/' + file));
  const oracle = join(scratch, 'profile-oracle');
  execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
    fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', oracle]);
  const answers = execFileSync(oracle, [], { input: Buffer.concat(cases.map((b) => Buffer.from(b))) });
  const stride = 493;
  assert.equal(answers.length, cases.length * stride);
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
  assert.equal(accepted, 2 + 2 * 4, 'both blocks, and Off or Fixed with a listed value and no destination');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`PASS options page preview and opening page: codec, labels, guides and the firmware parser at ${ref.slice(0, 7)}`);
