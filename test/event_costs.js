// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { importedCost, importCosts, costTable, tableBytes, tableSha256 } from '../tools/import-costs.js';
import { defaults, normalise, encodeProfile, decodeProfile, featureDelta, cpuUsage, modes } from '../static/js/profile.js';
import { featureHelp } from '../static/js/help.js';
import { guide } from '../static/js/guide.js';
import { GROUPS } from '../static/js/layout.js';
const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
const feature = { id: 24, name: 'Synth reverb tail', values: ['Keep (stock)', 'Clear'],
  states: ['Off', 'Fixed'], field: null, page: false, amount: false, action: false,
  stateless: false, synth_path: true, default_in_block: false, default: [24, 0, 0, 0, 0, 0] };
const expected = { kind: 'zero', source: 'no per-block work (code inspection)',
  engines: { synth: { off: 0, fixed: [0, 0], adjustable: [0, 0] },
    granular: { off: 0, fixed: [0, 0], adjustable: [0, 0] } },
  uncertainty: { points: 0 },
  note: 'clearing the synth reverb happens only when leaving synth playback; no per-block or per-tick work' };
assert.deepEqual(importedCost(feature), expected);
assert.deepEqual(costTable.features.map((f) => f.id), Array.from({ length: 23 }, (_, i) => i + 1));
assert.equal(costTable.features.filter((f) => f.cpu.kind === 'measured').length, 19);
assert.equal(costTable.features.filter((f) => f.cpu.kind === 'inspection').length, 4);
assert.equal(createHash('sha256').update(tableBytes).digest('hex'), tableSha256);
const historical = JSON.stringify(costTable);
const intervals = manifest.releases[0].profile.features.find((f) => f.id === 10);
assert.deepEqual(importedCost(intervals), importedCost({ ...intervals, name: 'Random intervals' }));
assert.throws(() => importedCost({ ...intervals, name: 'Unknown pitch mode' }));
assert.throws(() => importedCost({ ...intervals, id: 1 }));
const extended = structuredClone(manifest);
const release = extended.releases[0];
release.development = true; // The importer only updates a development entry.
release.profile.version = 2; release.profile.size = 4096;
release.profile.features = release.profile.features.filter((f) => f.id !== 24);
release.profile.features.push(structuredClone(feature));
importCosts(extended);
const tail = release.profile.features.find((f) => f.id === 24);
assert.deepEqual(tail.cpu, expected);
assert.equal(release.cpu.costs.table_sha256, tableSha256);
assert.deepEqual(release.cpu.costs.inspected_features, [{ id: 24, name: feature.name, source: 'code inspection' }]);
assert.equal(JSON.stringify(costTable), historical);
assert.match(release.cpu.release_note, /classified separately by code inspection/);
const base = defaults(release.profile);
assert(!base.some((e) => e[0] === 24));
assert.deepEqual(normalise([...base, [24, 0, 0, 0, 0, 0]], release.profile), base);
const clear = [...base, [24, 1, 1, 0, 0, 0]];
assert.deepEqual(decodeProfile(encodeProfile(clear, release.profile), release.profile), clear);
assert.deepEqual(modes(tail), [[0, 'Off'], [1, 'Fixed']]);
assert(guide(clear, release, '12345678').includes('Synth reverb tail: Fixed · Clear'));
for (const engine of ['synth', 'granular']) {
  for (const entry of [undefined, [24, 0, 0, 0, 0, 0], [24, 1, 0, 0, 0, 0], [24, 1, 1, 0, 0, 0]]) {
    assert.equal(featureDelta(entry, tail, engine), 0);
  }
}
assert.deepEqual(cpuUsage(clear, release).engines.map((e) => e.percent), cpuUsage(base, release).engines.map((e) => e.percent));
for (const invalid of [[24, 2, 1, 0, 0, 0], [24, 1, 1, 1, 0, 0], [24, 1, 1, 0, 1, 0], [24, 1, 1, 0, 0, 1]]) {
  assert.throws(() => encodeProfile([...base, invalid], release.profile));
}
for (const change of [
  (f) => { f.id = 25; }, (f) => { f.name = 'Unknown event'; },
  (f) => { f.values = ['Keep', 'Clear']; }, (f) => { f.values.reverse(); },
  (f) => { f.states.push('Adjustable'); }, (f) => { f.page = true; },
  (f) => { f.action = true; }, (f) => { f.amount = true; }, (f) => { f.field = 13; },
  (f) => { f.default[2] = 1; }, (f) => { f.default_in_block = true; }
]) {
  const invalid = structuredClone(feature); change(invalid);
  assert.throws(() => importedCost(invalid));
}
assert.throws(() => importedCost(feature, { features: [...costTable.features, { id: 24, name: feature.name, cpu: { kind: 'measured' } }] }));
assert.throws(() => importedCost({ ...feature, id: 25 }, { features: [{ id: 25, name: feature.name, cpu: { kind: 'inspection' } }] }));
for (const change of [
  (r) => { r.profile.features.pop(); r.profile.features.push({ ...feature, id: 25 }); },
  (r) => { r.profile.features.splice(0, 1); },
  (r) => { r.profile.features.push(structuredClone(feature)); }
]) {
  const invalid = structuredClone(release); change(invalid);
  assert.throws(() => importCosts({ releases: [invalid] }));
}
const prior = structuredClone(manifest);
prior.releases[0].development = true;
prior.releases[0].profile.features = prior.releases[0].profile.features.filter((f) => f.id !== 24);
assert.equal(importCosts(prior).releases[0].profile.features.length, 23);
assert(!('inspected_features' in prior.releases[0].cpu.costs));
const help = featureHelp(feature, release);
assert.match(help.description, /stock.*clear.*stops/);
assert(help.url.endsWith('#synth-reverb-tail'));
assert(GROUPS.find(([name]) => name === 'Sound')[1].includes(24));
console.log('PASS optional synth-tail customization: exact known inspection metadata, immutable 23-feature history, zero event cost, Off/Fixed codec and unknown-feature refusal.');
