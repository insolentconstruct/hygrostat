// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Options page idle timeout (feature 25) on a synthetic release; no offered release has it yet.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, encodeProfile, decodeProfile, defaults, share, unshare } from '../static/js/profile.js';
import { guide } from '../static/js/guide.js';
import { featureHelp } from '../static/js/help.js';
const text = (svg) => [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((m) => m[1]).join(' ');
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../static/manifest.json'));
const feature = JSON.parse(read('fixtures/idle-timeout-feature.json'));
const shipped = manifest.releases;
assert(shipped.every((r) => !r.profile.features.some((f) => f.id === 25)), 'no offered release lists feature 25');
const beta2 = shipped[0];
const release = structuredClone(beta2);
Object.assign(release, { tag: 'drizzlet-dev-idle-timeout', name: 'Synthetic fixture (never offered)',
  development: true, source_commit: '0'.repeat(40) });
release.profile.features.push(feature);
const timeout = (state, value) => [25, state, value, 0, 0, 0];

// Off and Fixed values only, no controls; older releases refuse the feature.
for (let value = 0; value < feature.values.length; ++value) {
  validate([timeout(0, value)], release.profile);
  validate([timeout(1, value)], release.profile);
  assert.throws(() => validate([timeout(2, value)], release.profile), /not allowed/);
}
assert.throws(() => validate([timeout(1, feature.values.length)], release.profile), /not allowed/);
assert.throws(() => validate([[25, 1, 1, 1, 0, 0]], release.profile), /not allowed/);
assert.throws(() => validate([[25, 1, 1, 0, 1, 0]], release.profile), /not allowed/);
assert.throws(() => validate([[25, 1, 1, 0, 0, 1]], release.profile), /not allowed/);
assert.throws(() => validate([timeout(1, 1)], beta2.profile), /Unknown/);

// Profiles without the feature encode exactly as before; the entry round-trips.
const base = defaults(beta2.profile);
assert.deepEqual(encodeProfile(base, release.profile), encodeProfile(base, beta2.profile));
const entries = [...base, timeout(1, 2)];
const block = encodeProfile(entries, release.profile);
assert.deepEqual(Array.from(block.subarray(16 + 6 * base.length, 22 + 6 * base.length)), timeout(1, 2));
assert.deepEqual(decodeProfile(block, release.profile), entries);
assert.deepEqual(unshare(share(release, block), [release]).entries, entries);
assert.throws(() => unshare(share(release, block), shipped), /another release/);
assert.throws(() => decodeProfile(block, beta2.profile), /Unknown/);

// Guides state the chosen time; Off adds nothing.
for (const mobile of [false, true]) {
  const svg = text(guide(entries, release, 'abcd1234', mobile));
  assert.match(svg, /leave all buttons and knobs for 10 s/);
  assert.match(svg, /Options page idle timeout: Fixed · 10 s/);
  for (const off of [timeout(0, 0), timeout(0, 2), timeout(1, 0)]) {
    const plain = text(guide([...base, off], release, 'abcd1234', mobile));
    assert(!plain.includes('leave all buttons'), 'Off keeps the usual close line');
  }
}

const help = featureHelp(feature, release);
assert(help.description.length > 15 && help.description.length < 180);
assert.match(help.description, /Off keeps them open/);
assert.equal(new URL(help.url).hash, '#options-page-idle-timeout');

// With a prepared firmware revision, check its catalogue entry and documentation heading.
if (process.env.IDLE_TIMEOUT_FIRMWARE_REF) {
  const { firmwareShow } = await import('./firmware.js');
  const ref = process.env.IDLE_TIMEOUT_FIRMWARE_REF;
  const catalogue = JSON.parse(firmwareShow(ref, 'beads/build/profile-features.json', { encoding: 'utf8' }));
  const c = catalogue.features.find((f) => f.id === 25);
  assert.equal(c.name, feature.name);
  assert.deepEqual(c.values, feature.values);
  assert.deepEqual(c.states, feature.states);
  assert.equal(c.field, feature.field);
  assert.deepEqual([c.page_slots, c.amount_slots, c.actions], [[], [], []]);
  assert.equal(c.touches_synth, feature.synth_path);
  const docs = firmwareShow(ref, 'beads/build/docs/FEATURES.md', { encoding: 'utf8' });
  assert.match(docs, /^### Options page idle timeout$/m);
}
console.log(`PASS idle timeout on a synthetic release${process.env.IDLE_TIMEOUT_FIRMWARE_REF ? ' and the prepared firmware catalogue' : ''}`);
