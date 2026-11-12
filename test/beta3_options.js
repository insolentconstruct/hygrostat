// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Beta 3 profile-only options (features 25-30) on a synthetic release; no offered release has them yet.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firmwareShow } from './firmware.js';
import { validate, encodeProfile, decodeProfile, defaults, share, unshare, cpuUsage } from '../static/js/profile.js';
import { edit, GROUPS } from '../static/js/layout.js';
import { guide } from '../static/js/guide.js';
import { featureHelp } from '../static/js/help.js';
const text = (svg) => [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((m) => m[1]).join(' ');
const read = (file) => readFileSync(new URL(file, import.meta.url));
const manifest = JSON.parse(read('../static/manifest.json'));
const additions = [JSON.parse(read('fixtures/idle-timeout-feature.json')), ...JSON.parse(read('fixtures/beta3-features.json'))];
const ids = additions.map((f) => f.id);
assert.deepEqual(ids, [25, 26, 27, 28, 29, 30]);
const shipped = manifest.releases;
assert(shipped.every((r) => !r.profile.features.some((f) => ids.includes(f.id))), 'no offered release lists features 25-30');

// The catalogue copy matches the prepared firmware byte for byte.
const ref = process.env.BETA3_FIRMWARE_REF || '6755822bc5090f0c1ed79fabce85ac520c0f9eef';
const catalogueBytes = read('fixtures/beta3-profile-features.json');
assert.deepEqual(catalogueBytes, firmwareShow(ref, 'beads/build/profile-features.json'),
  'copy the prepared firmware catalogue verbatim');
const catalogue = JSON.parse(catalogueBytes);
assert.deepEqual(catalogue.features.map((c) => c.id), Array.from({ length: 30 }, (_, i) => i + 1));
// Features 1-24 change only their page range (seven pages in Beta 3).
const current = JSON.parse(read('../static/profile-features.json'));
for (const [i, c] of current.features.entries()) {
  const next = catalogue.features[i];
  for (const key of Object.keys(c)) {
    if (key === 'page_slots') assert.deepEqual(next[key], c[key].length ? Array.from({ length: 21 }, (_, n) => n + 1) : []);
    else assert.deepEqual(next[key], c[key], `${c.name}: ${key}`);
  }
}
// Manifest entries follow the catalogue: Off by default, Fixed values only, no controls.
const docs = firmwareShow(ref, 'beads/build/docs/FEATURES.md', { encoding: 'utf8' });
const headings = [...docs.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-'));
for (const f of additions) {
  const c = catalogue.features.find((c) => c.id === f.id);
  assert.equal(f.name, c.name);
  assert.deepEqual(f.values, c.values);
  assert.deepEqual(f.states, c.states);
  assert.deepEqual(f.states, ['Off', 'Fixed']);
  assert.equal(f.field, c.field);
  assert.equal(f.synth_path, c.touches_synth, `${f.name}: synth_path`);
  assert.equal(c.cpu_cost, null);
  assert.deepEqual([c.page_slots, c.amount_slots, c.actions], [[], [], []]);
  assert.deepEqual([f.page, f.amount, f.action, f.stateless, f.default_in_block], [false, false, false, false, false]);
  assert.deepEqual(f.default, [f.id, f.states.indexOf(c.default_state), c.default, 0, 0, 0]);
  assert.deepEqual(f.default, [f.id, 0, 0, 0, 0, 0]);
  if (f.cpu) {
    assert.equal(f.cpu.kind, 'zero');
    assert.match(f.cpu.source, /^synthetic fixture/);
    for (const engine of Object.values(f.cpu.engines)) assert.equal(engine.fixed.length, f.values.length);
  }
  const help = featureHelp(f, { development: true, source_commit: ref });
  assert(help.description.length > 15 && help.description.length < 180, f.name);
  assert(!help.description.includes('\n'));
  assert(headings.includes(new URL(help.url).hash.slice(1)), `${f.name}: real FEATURES.md section`);
}
const grouped = GROUPS.flatMap(([, group]) => group);
for (const id of ids) assert.equal(grouped.filter((g) => g === id).length, 1, `feature ${id} is in one library group`);
assert.deepEqual(additions.find((f) => f.id === 28).values, ['Normal (default)', 'Low', 'High']);
assert.equal(featureHelp({ id: 26 }, shipped[0]).url.split('#')[1], 'delay-seed-latch-fade');
assert.equal(featureHelp({ id: 30 }, shipped[0]).url.split('#')[1], 'pitch-knob');

const beta2 = shipped[0];
const release = structuredClone(beta2);
Object.assign(release, { tag: 'drizzlet-dev-beta3-options', name: 'Synthetic fixture (never offered)',
  development: true, source_commit: '0'.repeat(40) });
release.profile.features.push(...structuredClone(additions));
const entry = (id, state, value) => [id, state, value, 0, 0, 0];
const base = defaults(beta2.profile);
assert.deepEqual(defaults(release.profile), base, 'new options are omitted by default');
assert.deepEqual(encodeProfile(base, release.profile), encodeProfile(base, beta2.profile));

for (const f of additions) {
  // Off and Fixed values only, no controls; Beta 2 refuses the feature.
  for (let value = 0; value < f.values.length; ++value) {
    validate([entry(f.id, 0, value)], release.profile);
    validate([entry(f.id, 1, value)], release.profile);
    assert.throws(() => validate([entry(f.id, 2, value)], release.profile), /not allowed/);
  }
  assert.throws(() => validate([entry(f.id, 1, f.values.length)], release.profile), /not allowed/);
  for (const controls of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    assert.throws(() => validate([[f.id, 1, 1, ...controls]], release.profile), /not allowed/);
  }
  assert.throws(() => validate([entry(f.id, 1, 1)], beta2.profile), /Unknown/);

  // Off or value 0 leaves the entry out; Fixed values encode as listed.
  assert.deepEqual(edit(base, release.profile, f, 1, 0), base);
  for (let value = 1; value < f.values.length; ++value) {
    const fixed = edit(edit(base, release.profile, f, 1, 1), release.profile, f, 2, value);
    assert.deepEqual(fixed, [...base, entry(f.id, 1, value)]);
    const block = encodeProfile(fixed, release.profile);
    assert.deepEqual(Array.from(block.subarray(16 + 6 * base.length, 22 + 6 * base.length)), entry(f.id, 1, value));
    assert.deepEqual(decodeProfile(block, release.profile), fixed);
    assert.deepEqual(unshare(share(release, block), [release]).entries, fixed);
    assert.throws(() => decodeProfile(block, beta2.profile), /Unknown/);
    assert.deepEqual(edit(fixed, release.profile, f, 1, 0), base);
    for (const mobile of [false, true]) {
      assert(text(guide(fixed, release, 'abcd1234', mobile)).includes(`${f.name}: Fixed · ${f.values[value]}`));
    }
  }
  // An explicit Fixed 0 means the same as Off and still round-trips.
  const fixedOff = [...base, entry(f.id, 1, 0)];
  assert.deepEqual(decodeProfile(encodeProfile(fixedOff, release.profile), release.profile), fixedOff);
  for (const mobile of [false, true]) {
    assert(!text(guide([...base, entry(f.id, 0, 0)], release, 'abcd1234', mobile)).includes(`${f.name}:`));
  }
}

// All six together, including each Attack sensitivity value.
for (const sensitivity of [1, 2]) {
  const all = [...base, ...additions.map((f) => entry(f.id, 1, f.id === 28 ? sensitivity : 1))];
  const block = encodeProfile(all, release.profile);
  assert.deepEqual(Array.from(block.subarray(16 + 6 * base.length, 16 + 6 * all.length)), additions.flatMap((f) =>
    entry(f.id, 1, f.id === 28 ? sensitivity : 1)));
  assert.deepEqual(decodeProfile(block, release.profile), all);
  assert.deepEqual(unshare(share(release, block), [release]).entries, all);
  assert.throws(() => unshare(share(release, block), shipped), /another release/);
}

// Inspected power-on options add no cost; per-block ones stay unmeasured.
assert.deepEqual(cpuUsage(base, release).engines, cpuUsage(base, beta2).engines);
for (const id of [25, 27, 29]) {
  assert.deepEqual(cpuUsage([...base, entry(id, 1, 1)], release).engines, cpuUsage(base, beta2).engines);
}
for (const id of [26, 28, 30]) {
  const usage = cpuUsage([...base, entry(id, 1, 1)], release);
  assert.equal(usage.kind, 'not yet measured');
  assert.deepEqual(usage.unknown, [additions.find((f) => f.id === id).name]);
}
console.log(`PASS Beta 3 options 25-30: catalogue bytes at ${ref.slice(0, 7)}, manifest fields, help anchors, Off/Fixed codec, share links and guides`);
