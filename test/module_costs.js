// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Module-measured cost sources: the Beta 3 fixtures import beside the unchanged Beta 2 table.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beta3Ref } from './firmware.js';
import { checkReleaseCosts } from './costs.js';
import { importCosts, moduleCosts, costTable, tableBytes, tableSha256, inspectionSource,
  moduleMeasuredOn } from '../tools/import-costs.js';
import { cpuUsage, defaults, featureDelta } from '../static/js/profile.js';
const read = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const manifest = read('../static/manifest.json');
const beta2 = manifest.releases[0];
const historical = JSON.stringify(costTable);

// Beta 3 fixtures: 10 and 23 replace their Beta 2 entries, 25-33 are new.
const replaced = [read('fixtures/recent-notes-feature.json'), read('fixtures/time-scan-feature.json')];
const added = [read('fixtures/idle-timeout-feature.json'), ...read('fixtures/beta3-features.json'),
  read('fixtures/plaits-bank-feature.json')];
const fixtures = [...replaced, ...added].sort((a, b) => a.id - b.id);
assert.deepEqual(fixtures.map((f) => f.id), [10, 23, 25, 26, 27, 28, 29, 30, 31, 32, 33]);

// The Beta 3 source file as the release will commit it: fixture costs plus their provenance.
const dwt = { image: 'beta3-qual-12180c6', run: 'run-beta3-2',
  report: 'session-2026-11-11/beta3/module-plan/run-beta3-2/run/dwt/report.json' };
const followup = { image: 'beta3-qual-12180c6', run: 'run-fu-1',
  report: 'session-2026-11-11/beta3/followup/run-fu-1/run/followup/report.json' };
const sourceRow = (f) => {
  const zero = f.cpu.kind === 'zero';
  return { id: f.id, name: f.name, values: f.values,
    provenance: zero ? [{ inspected: beta3Ref }] : [f.id === 10 ? followup : dwt],
    cpu: zero ? { ...f.cpu, source: inspectionSource } : f.cpu };
};
const source = { format: 1, measured_on: moduleMeasuredOn, features: fixtures.map(sourceRow),
  limits: read('fixtures/beta3-cpu-limits.json') };
const path = 'costs/beta3-module.json';
const files = (json, at = path) => (p) => {
  assert.equal(p, at);
  return Buffer.from(JSON.stringify(json, null, 2) + '\n');
};

// A development entry built from Beta 2 plus the fixtures, with costs cleared so the import must fill them.
const development = (refs = [{ path }]) => {
  const m = structuredClone(manifest);
  const r = m.releases[0];
  Object.assign(r, { tag: 'drizzlet-dev-beta3-costs', development: true, source_commit: '0'.repeat(40) });
  r.profile.features = [...r.profile.features.filter((f) => !replaced.some((g) => g.id === f.id)),
    ...structuredClone(fixtures)].sort((a, b) => a.id - b.id);
  for (const f of r.profile.features) f.cpu = null;
  r.cpu.costs = { module_sources: refs };
  return m;
};
const imported = importCosts(development(), files(source));
const release = imported.releases[0];
assert.deepEqual(release.profile.features.map((f) => f.id), Array.from({ length: 33 }, (_, i) => i + 1));
for (const f of release.profile.features) {
  const fixture = fixtures.find((g) => g.id === f.id);
  if (!fixture) assert.deepEqual(f.cpu, beta2.profile.features.find((g) => g.id === f.id).cpu, `${f.name}: Beta 2 cost kept`);
  else if (fixture.cpu.kind === 'measured') assert.deepEqual(f.cpu, fixture.cpu, `${f.name}: fixture cost imported`);
  else assert.deepEqual(f.cpu, { ...fixture.cpu, source: inspectionSource }, `${f.name}: inspected zero`);
}
const digest = createHash('sha256').update(files(source)(path)).digest('hex');
assert.deepEqual(release.cpu.costs.module_sources, [{ path, sha256: digest, features: fixtures.map((f) => f.id) }]);
assert.equal(release.cpu.costs.table_sha256, tableSha256);
assert.deepEqual(release.cpu.costs.inspected_features, [{ id: 24, name: 'Synth reverb tail', source: 'code inspection' }]);
assert.match(release.cpu.release_note, /measured on the Beads module, each naming its run, report and firmware image/);
assert.equal(createHash('sha256').update(tableBytes).digest('hex'), tableSha256);
assert.equal(JSON.stringify(costTable), historical, 'the historical table is never rewritten');
checkReleaseCosts(release, files(source));

// Module CPU limits: the 48 kHz clean edge is the ceiling; other rates and heavy peaks are measured reference.
assert.deepEqual([release.cpu.ceiling, release.cpu.warning, release.cpu.ceiling_kind], [90.8, 90.8, 'measured']);
assert.deepEqual(release.cpu.limits.rates.map((r) => [r.khz, r.qualities, r.clean.percent, r.first_late.percent]),
  [[48, ['Bright digital', 'Sunny tape'], 90.8, 91.3], [32, ['Cold digital'], 86.6, 87.1],
    [24, ['Scorched cassette'], 82.7, 83.1]]);
assert.deepEqual(release.cpu.limits.heavy.map((h) => [h.quality, h.khz, h.peak.percent, h.margin_points]),
  [['Bright digital', 48, 82.2, 8.6], ['Sunny tape', 48, 63, 27.8], ['Cold digital', 32, 64.7, 21.9],
    ['Scorched cassette', 24, 50.9, 31.7]]);
assert.deepEqual(release.cpu.limits.provenance, source.limits.provenance);
assert.equal(release.cpu.limits.measured_on, 'Beads module');
assert.match(release.cpu.release_note, /clean edge measured on the Beads module at 48 kHz, 90\.8% of the block/);
assert.deepEqual([beta2.cpu.ceiling, beta2.cpu.warning, beta2.cpu.limits], [90.8, 90.8, undefined], 'Beta 2 stores the module edge');
for (const change of [(r) => { r.cpu.ceiling = 92; }, (r) => { r.cpu.warning = 91; }, (r) => { delete r.cpu.limits; }]) {
  const moved = structuredClone(release); change(moved);
  assert.throws(() => checkReleaseCosts(moved, files(source)));
}
// The release check also needs the pinned source and valid rows.
for (const change of [(r) => { delete r.cpu.costs.module_sources[0].sha256; }, (r) => { r.cpu.costs.module_sources[0].features.pop(); }]) {
  const unpinned = structuredClone(release); change(unpinned);
  assert.throws(() => checkReleaseCosts(unpinned, files(source)));
}
const unproven = structuredClone(source);
delete unproven.features.find((f) => f.id === 32).provenance;
const reference = structuredClone(release);
reference.cpu.costs.module_sources[0].sha256 = createHash('sha256').update(files(unproven)(path)).digest('hex');
assert.throws(() => checkReleaseCosts(reference, files(unproven)), /provenance is missing/);
const extra = structuredClone(source);
extra.features.push({ ...structuredClone(extra.features[2]), id: 34 });
reference.cpu.costs.module_sources[0] = { path, sha256: createHash('sha256').update(files(extra)(path)).digest('hex'),
  features: extra.features.map((f) => f.id) };
assert.throws(() => checkReleaseCosts(reference, files(extra)), /release lacks/);

// Re-importing the pinned entry is exact; changed source bytes are refused.
assert.deepEqual(importCosts(structuredClone(imported), files(source)), imported);
const edited = structuredClone(source);
edited.features[1].cpu.engines.granular.fixed[1] = 0.5;
assert.throws(() => importCosts(structuredClone(imported), files(edited)), /checksum mismatch/);
assert.throws(() => importCosts(development([{ path, sha256: '0'.repeat(64) }]), files(source)), /checksum mismatch/);

// Every option has a cost: TIME scan and Recent notes take their module values.
const entries = defaults(release.profile);
const every = [...entries.filter((e) => e[0] !== 31), [23, 1, 1, 0, 0, 0], ...[25, 26, 27, 28, 29, 30, 32, 33].map((id) =>
  [id, 1, 1, 0, 0, 0]), [31, 2, 0, 0, 0, 0]];
assert.notEqual(cpuUsage(every, release).kind, 'not yet measured');
// An estimate between the measured edge and the former 92% policy now blocks.
const near = structuredClone(release);
near.cpu.baselines.granular.percent = 90.8 - cpuUsage(every, release).engines.find((e) => e.engine === 'granular').percent +
  release.cpu.baselines.granular.percent + 0.5;
const nearGranular = cpuUsage(every, near).engines.find((e) => e.engine === 'granular');
assert(nearGranular.percent > 90.8 && nearGranular.percent <= 92 && nearGranular.blocked && nearGranular.warning);
const feature = (id) => release.profile.features.find((f) => f.id === id);
assert.equal(featureDelta([23, 1, 1, 0, 0, 0], feature(23), 'granular'), 0.569);
assert.equal(featureDelta([10, 0, 0, 0, 0, 0], feature(10), 'granular'), -0.071, 'Off against the Adjustable default');

// Refusals: missing provenance or cost, incomplete or private provenance, and anything the source cannot vouch for.
const refuse = (change, pattern, refs) => {
  const bad = structuredClone(source);
  change(bad, (id) => bad.features.find((f) => f.id === id));
  assert.throws(() => importCosts(development(refs), files(bad)), pattern);
};
const row = (id, change) => (s, find) => change(find(id));
refuse(row(32, (r) => { delete r.provenance; }), /provenance is missing/);
refuse(row(32, (r) => { r.provenance = []; }), /provenance is missing/);
refuse(row(25, (r) => { delete r.provenance; }), /provenance is missing/);
for (const key of ['run', 'report', 'image']) refuse(row(33, (r) => { r.provenance = [{ ...dwt, [key]: undefined }]; }), /provenance/);
refuse(row(33, (r) => { r.provenance = [{ ...dwt, report: '/abs/' + dwt.report }]; }), /provenance/);
refuse(row(33, (r) => { r.provenance = [{ ...dwt, report: 'session/../report.json' }]; }), /provenance/);
refuse(row(33, (r) => { r.provenance = [{ ...dwt, run: 'run-other' }]; }), /provenance/);
refuse(row(10, (r) => { r.provenance = [dwt]; }), /provenance/);
refuse(row(26, (r) => { r.provenance = [{ ...dwt, sha: 'x' }]; }), /provenance/);
refuse(row(25, (r) => { r.provenance = [{ inspected: 'main' }]; }), /provenance/);
refuse(row(32, (r) => { r.cpu = null; }), /missing or of unknown kind/);
refuse(row(32, (r) => { r.cpu.kind = 'unknown'; }), /missing or of unknown kind/);
refuse(row(32, (r) => { r.cpu.engines.granular.fixed[1] = null; }), /missing or invalid granular/);
refuse(row(32, (r) => { r.cpu.engines.granular.adjustable.pop(); }), /missing or invalid granular/);
refuse(row(10, (r) => { r.cpu.engines.synth.off = null; }), /missing or invalid synth/);
refuse(row(32, (r) => { r.cpu.note = 'no reason given'; }), /omits synth/);
refuse(row(32, (r) => { r.cpu.engines.cpu = {}; }), /synth\/granular/);
refuse(row(32, (r) => { r.cpu.engines.granular = null; r.cpu.note += '; granular: not applicable'; }), /missing or invalid granular/);
refuse(row(32, (r) => { r.cpu.uncertainty.points = 0; }), /uncertainty/);
refuse(row(32, (r) => { delete r.cpu.note; }), /needs a note/);
refuse(row(27, (r) => { r.cpu.engines.granular.fixed[1] = 0.1; }), /missing or invalid granular/);
refuse(row(27, (r) => { r.cpu.source = 'measured on a module-calibrated development board'; }), /source or uncertainty/);
refuse(row(28, (r) => { r.name = 'Attack'; }), /feature mismatch/);
refuse(row(28, (r) => { r.values = r.values.slice(0, 2); }), /feature mismatch/);
refuse((s) => { s.measured_on = 'Seed3 (module-calibrated)'; }, /Not a module cost source/);
refuse((s) => { s.features = []; }, /Not a module cost source/);
refuse((s) => { s.features.push(structuredClone(s.features[0])); }, /listed twice/);
refuse((s) => { s.features.push({ ...structuredClone(s.features[2]), id: 24 }); }, /event-only/);
refuse((s) => { s.features.push({ ...structuredClone(s.features[2]), id: 34 }); }, /release lacks/);
refuse((s) => { s.features = s.features.filter((f) => f.id !== 33); }, /feature set mismatch/);
for (const bad of ['costs/cost-table.json', 'test/fixtures/beta3-features.json', 'costs/../x.json', undefined]) {
  assert.throws(() => importCosts(development([{ path: bad }]), files(source, bad)), /new file in costs/);
}
const limit = (change, pattern) => refuse((s) => change(s.limits), pattern);
limit((l) => { delete l.provenance; }, /limits provenance/);
limit((l) => { l.provenance[0].report = '/abs/' + l.provenance[0].report; }, /limits provenance/);
limit((l) => { l.provenance[0].run = ''; }, /limits provenance/);
limit((l) => { l.block_cycles = 100000; }, /120000-cycle block/);
limit((l) => { delete l.note; }, /need a note/);
limit((l) => { l.rates[1].qualities.push('Sunny tape'); }, /each quality once/);
limit((l) => { l.rates.pop(); }, /each quality once/);
limit((l) => { l.rates[2].khz = 48; }, /each quality once/);
limit((l) => { l.rates[0].first_late_cycles = l.rates[0].clean_cycles; }, /each quality once/);
limit((l) => { l.rates[2].clean_cycles += 0.5; }, /each quality once/);
limit((l) => { l.rates[1] = null; }, /each quality once/);
limit((l) => { l.ceiling_khz = 44; }, /48 kHz rate as the ceiling/);
limit((l) => { l.ceiling_khz = 24; }, /48 kHz rate as the ceiling/);
limit((l) => { l.rates[0].khz = 96; l.ceiling_khz = 96; }, /each quality once/);
limit((l) => { [l.rates[1].qualities, l.rates[2].qualities] = [l.rates[2].qualities, l.rates[1].qualities]; }, /each quality once/);
limit((l) => { l.heavy = []; }, /one heavy peak per quality/);
limit((l) => { l.heavy[3].peak_cycles = l.rates[2].clean_cycles; }, /one heavy peak per quality/);
limit((l) => { l.heavy.push(structuredClone(l.heavy[0])); }, /one heavy peak per quality/);
limit((l) => { l.heavy[3] = structuredClone(l.heavy[0]); }, /one heavy peak per quality/);
limit((l) => { l.heavy = l.heavy.slice(0, 1); }, /one heavy peak per quality/);
limit((l) => { l.heavy[2].peak_cycles = 97000; }, /less room/);
// One source carries the limits; a pinned entry keeps them until a source does.
const halves = { 'costs/a.json': { ...source, features: source.features.slice(0, 5) },
  'costs/b.json': { ...source, features: source.features.slice(5) } };
const both = (p) => Buffer.from(JSON.stringify(halves[p], null, 2) + '\n');
assert.throws(() => importCosts(development([{ path: 'costs/a.json' }, { path: 'costs/b.json' }]), both), /listed twice/);
const stale = development();
stale.releases[0].cpu.limits = structuredClone(release.cpu.limits);
assert.throws(() => importCosts(stale, files({ ...source, limits: undefined })), /no longer in a module source/);
// Without a module source, a new option has no cost and the import refuses.
assert.throws(() => importCosts(development([])), /feature set mismatch/);
assert.deepEqual(moduleCosts(beta2).sources, [], 'Beta 2 has no module source');
console.log(`PASS module cost sources: ${fixtures.length} Beta 3 fixture costs import with provenance and checksum beside the unchanged Beta 2 table; ${33 - fixtures.length} Beta 2 costs kept; module CPU limits set the ${release.cpu.ceiling}% ceiling; refusals`);
