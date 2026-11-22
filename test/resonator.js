// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Beta 4 resonator (41, 43-49) on a synthetic release; no release has it yet.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { validate, encodeProfile, decodeProfile, defaults, pageSlots, crc32, exactPageRule, EXACT_REPLACES } from '../static/js/profile.js';
import { edit, place, entryOf, places, extraControl, placeable, summary } from '../static/js/layout.js';
import { featureHelp } from '../static/js/help.js';
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
// Beta 4 integration with the resonator controls merged; bump it (or set RESONATOR_FIRMWARE_REF) when that branch moves.
// #345 merges Beta 4 integration's resonator; 42 is Rings polyphony there.
const RESONATOR_FIRMWARE_REF = process.env.RESONATOR_FIRMWARE_REF || '3df1b087a7458e57782741ff8e252f55ddb8a21f';
const ref = RESONATOR_FIRMWARE_REF;
const IDS = [41, 43, 44, 45, 46, 47, 48, 49];
const EXACT = [45, 46, 47, 48, 49];
const UNKNOWN = 50;
const STATES = ['Off', 'Fixed', 'Adjustable'];
const manifest = JSON.parse(read('../static/manifest.json'));
assert(manifest.releases.every((r) => !r.profile.features.some((f) => f.id >= 41)), 'no release lists the resonator');
const beta3 = manifest.releases.find((r) => r.slug === 'beta-3-smirr');

// The firmware's catalogue, definitions table and factory block at the ref.
const catalogue = JSON.parse(firmwareShow(ref, 'beads/build/profile-features.json', { encoding: 'utf8' }));
const source = firmwareShow(ref, 'beads/profile.cc', { encoding: 'utf8' });
const table = source.split('kFeatureDefinitions[FEATURE_LAST] = {')[1].split('};')[0];
// The numeric rows: the PLAITS_BLOBS bank row is skipped for its #else twin, and None is dropped.
const definitions = [...table.matchAll(/\{ (\d+), (\w+), (true|false), (true|false), (true|false), (true|false) \}/g)].slice(1);
const factoryBlock = Uint8Array.from(source.split('kProfileBlock[kProfileSize]')[1].split('};')[0]
  .match(/0x[0-9a-f]{2}/g).map(Number));
assert.equal(factoryBlock.length, 4096);
const factory = Array.from({ length: factoryBlock[5] }, (_, i) => Array.from(factoryBlock.subarray(16 + 6 * i, 22 + 6 * i)));

// Manifest rows from the catalogue; the factory block supplies placements.
const fromCatalogue = (c) => {
  const placed = factory.find((e) => e[0] === c.id);
  return { id: c.id, default_in_block: Boolean(placed),
    default: placed || [c.id, STATES.indexOf(c.default_state), c.default, 0, 0, 0],
    name: c.name, values: c.values, states: c.states, field: c.field ?? null,
    page: c.page_slots.length > 0, amount: c.amount_slots.length > 0, action: c.actions.length > 0,
    stateless: c.stateless ?? false, synth_path: c.touches_synth, cpu: null, saved: c.saved ?? null };
};
const additions = IDS.map((id) => fromCatalogue(catalogue.features.find((c) => c.id === id)));
const polyphony = fromCatalogue(catalogue.features.find((c) => c.id === 42));
const release = structuredClone(beta3);
Object.assign(release, { tag: 'drizzlet-dev-resonator', name: 'Synthetic fixture (never offered)',
  development: true, source_commit: ref });
release.profile.features.push(...additions, polyphony);
release.profile.features.sort((a, b) => a.id - b.id);
const profile = release.profile;
const feature = (id) => profile.features.find((f) => f.id === id);

// (a) The catalogue rows agree with kFeatureDefinitions; 42 is Rings polyphony.
assert.deepEqual(catalogue.features.map((c) => c.id), Array.from({ length: 49 }, (_, i) => i + 1));
assert.equal(definitions.length, 49, 'a definition row for every ID up to 49');
assert.deepEqual(definitions[41].slice(1), ['3', 'kNoField', 'false', 'false', 'false', 'false'], '42 is Rings polyphony');
// Catalogue format 2: page 5 has record bytes 24-26; the exact values are not saved.
assert.equal(catalogue.format, 2);
assert.deepEqual(IDS.map((id) => catalogue.features.find((c) => c.id === id).saved),
  IDS.map((id) => ({ 41: 24, 43: 25, 44: 26 })[id] ?? null));
for (const f of additions) {
  const c = catalogue.features.find((c) => c.id === f.id);
  const d = definitions[f.id - 1];
  assert.equal(f.values?.length || 0, Number(d[1]), `${f.name}: value count`);
  assert.equal(f.field, null);
  assert.equal(d[2], 'kNoField', `${f.name}: field`);
  for (const [key, index] of [['page', 3], ['amount', 4], ['action', 5]]) assert.equal(f[key], d[index] === 'true', `${f.name}: ${key}`);
  assert.equal(f.stateless, d[6] === 'true');
  assert.deepEqual(c.page_slots, f.page ? Array.from({ length: pageSlots(profile) }, (_, n) => n + 1) : []);
  assert.equal(f.default[1], STATES.indexOf(c.default_state), `${f.name}: default state`);
  assert.equal(f.default[2], c.default, `${f.name}: default value`);
}
assert.deepEqual(additions.filter((f) => f.page).map((f) => [f.id, f.values.length, f.default]),
  [[41, 3, [41, 2, 0, 13, 0, 0]], [43, 4, [43, 2, 1, 14, 0, 0]], [44, 4, [44, 2, 1, 15, 0, 0]]]);
for (const id of EXACT) {
  const f = feature(id);
  assert.deepEqual([f.values, f.states, f.page, f.amount, f.action, f.default_in_block], [null, ['Off', 'Fixed'], false, false, false, false]);
  assert.equal(extraControl(f), 'number', `${f.name}: a 0-255 number in Extras`);
  assert(!placeable(f));
  assert.equal(summary(f, [id, 1, 64, 0, 0, 0]), 'Always 64');
}
assert.deepEqual([extraControl({ values: ['Off', 'On'] }), extraControl(feature(41))], ['switch', 'select']);
// The factory block is Beta 3's defaults plus the three page features and Rings polyphony, byte for byte.
assert.deepEqual(encodeProfile(defaults(profile), profile), factoryBlock);
// Help points at the firmware's Resonator section.
const docs = firmwareShow(ref, 'beads/build/docs/FEATURES.md', { encoding: 'utf8' });
assert(docs.includes('\n### Resonator\n'));
for (const f of additions) {
  const help = featureHelp(f, release);
  assert(help.description.length > 15 && help.description.length < 180, f.name);
  assert.equal(new URL(help.url).hash, '#resonator');
  assert(help.url.includes(ref));
}

// (c) Exact structure and brightness take Material off its page; exact damping takes Ring time.
assert.deepEqual(EXACT_REPLACES, { 45: 43, 46: 43, 47: 44 });
const base = defaults(profile);
const fixAt = (entries, id, v) => exactPageRule(edit(edit(entries, profile, feature(id), 1, 1), profile, feature(id), 2, v), profile);
const structure = fixAt(base, 45, 64);
assert.deepEqual(entryOf(structure, feature(43)), [43, 2, 1, 14, 0, 0], 'structure alone keeps Material on the page');
const both = fixAt(structure, 46, 255);
assert.deepEqual(entryOf(both, feature(43)), [43, 1, 1, 0, 0, 0], 'Material Fixed at its value, slot 14 free');
assert.deepEqual(entryOf(both, feature(44)), [44, 2, 1, 15, 0, 0]);
assert(!both.some((e) => e[3] === 14));
const damping = fixAt(base, 47, 0);
assert.deepEqual(entryOf(damping, feature(44)), [44, 1, 1, 0, 0, 0], 'Ring time Fixed at its value, slot 15 free');
assert.deepEqual(entryOf(damping, feature(43)), [43, 2, 1, 14, 0, 0]);
assert.deepEqual(exactPageRule(fixAt(base, 48, 0), profile), fixAt(base, 48, 0), 'position replaces no page control');
assert.deepEqual(exactPageRule(base, profile), base);
// Placing Material again while both are exact is undone; an Off value puts nothing back by itself.
assert.deepEqual(entryOf(exactPageRule(place(both, profile, 43, 'page', 14), profile), feature(43)), [43, 1, 1, 0, 0, 0]);
assert.deepEqual(entryOf(exactPageRule(edit(both, profile, feature(46), 1, 0), profile), feature(43)), [43, 1, 1, 0, 0, 0]);
assert.deepEqual(places(entryOf(place(edit(both, profile, feature(46), 1, 0), profile, 43, 'page', 14), feature(43))), [{ kind: 'page', slot: 14 }]);
// Releases without the exact features are unchanged.
assert.deepEqual(exactPageRule(defaults(beta3.profile), beta3.profile), defaults(beta3.profile));

// (b) The firmware's own parser on Hygrostat's blocks and raw listings.
for (const id of EXACT) {
  assert.throws(() => validate([[id, 2, 0, 0, 0, 0]], profile), /not allowed/);
  assert.throws(() => validate([[id, 2, 0, 16, 0, 0]], profile), /not allowed/);
  assert.throws(() => validate([[id, 1, 0, 16, 0, 0]], profile), /not allowed/);
}
assert.throws(() => validate([[UNKNOWN, 0, 0, 0, 0, 0]], profile), /Unknown/, 'Hygrostat never writes an unknown ID');
const reseal = (b) => { const end = 16 + new DataView(b.buffer).getUint16(6, true); new DataView(b.buffer).setUint32(end, crc32(b.subarray(0, end)), true); return b; };
const listing = (entries) => {
  const b = encodeProfile([], profile);
  b[5] = entries.length; b[6] = 6 * entries.length;
  entries.forEach((e, i) => b.set(e, 16 + 6 * i));
  return reseal(b);
};
// [block, Hygrostat decodes it, firmware accepts it].
const cases = [[factoryBlock, true, true]];
for (const v of [0, 64, 255]) {
  for (const id of EXACT) cases.push([encodeProfile(fixAt(base, id, v), profile), true, true]);
  const all = EXACT.reduce((entries, id) => fixAt(entries, id, v), base);
  assert.deepEqual([43, 44].map((id) => entryOf(all, feature(id))[1]), [1, 1]);
  cases.push([encodeProfile(all, profile), true, true]);
}
for (const id of EXACT) {
  cases.push([listing([[id, 2, 0, 0, 0, 0]]), false, false], [listing([[id, 2, 9, 16, 0, 0]]), false, false],
    [listing([[id, 1, 9, 0, 1, 0]]), false, false]);
}
// The firmware refuses an unknown ID in every form, as Hygrostat does.
for (let state = 0; state <= 2; ++state) {
  for (const value of [0, 1]) cases.push([listing([[UNKNOWN, state, value, 0, 0, 0]]), false, false]);
}
cases.push([listing([[UNKNOWN, 2, 0, 16, 0, 0]]), false, false], [listing([[UNKNOWN, 1, 0, 0, 0, 1]]), false, false]);
// Rings polyphony: Adjustable 1, 2 or 4 voices only.
for (const [entry, ok] of [[[42, 2, 2, 0, 0, 0], true], [[42, 2, 3, 0, 0, 0], false], [[42, 1, 0, 0, 0, 0], false]]) {
  cases.push([listing([entry]), ok, ok]);
}
const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-resonator-oracle-'));
try {
  mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
  for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) writeFileSync(join(scratch, 'beads', file), firmwareShow(ref, 'beads/' + file));
  const oracle = join(scratch, 'profile-oracle');
  execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
    fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', oracle]);
  const answers = execFileSync(oracle, [], { input: Buffer.concat(cases.map(([b]) => Buffer.from(b))) });
  const stride = 1 + 82 * 6;
  assert.equal(answers.length, cases.length * stride);
  cases.forEach(([b, hygrostat, firmware], i) => {
    let decoded = null;
    try { decoded = decodeProfile(b, profile); } catch { /* expected for refused cases */ }
    const label = `case ${i}: ${Array.from(b.subarray(16, 22))}`;
    assert.equal(Boolean(decoded), hygrostat, `Hygrostat ${label}`);
    assert.equal(answers[i * stride] === 1, firmware, `firmware ${label}`);
    if (decoded) assert.deepEqual(decoded.flat(), Array.from(answers.subarray(i * stride + 1, i * stride + 1 + decoded.length * 6)), label);
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`PASS resonator: catalogue, exact values, page rule and the firmware parser at ${ref.slice(0, 7)} (${cases.length} cases)`);
