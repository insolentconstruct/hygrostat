// Copyright 2026 Insolent Construct.
// MIT licence: see ../static/js/encoder.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { costTable, costSource, inspectionSource, moduleCosts, importedCost } from '../tools/import-costs.js';
import { defaults, templates, modes, featureDelta, cpuUsage, profileKey,
  encodeProfile, decodeProfile } from '../static/js/profile.js';
const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
// The numerical checks below are Beta 2's; every release gets the per-feature oracle.
const release = manifest.releases.find((r) => r.tag === 'drizzlet-2026.11.09');
const profile = release.profile;
const engines = ['synth', 'granular'];
const round = (v) => Math.round(v * 10) / 10;
const tableFeature = (f) => costTable.features.find((row) => row.id === f.id);
const noRows = new Map();
// A module source row replaces the table; 24 is independently inspected, outside the historical table.
const oracleCpu = (f, rows) => rows.get(f.id)?.cpu || (f.id === 24 ? { kind: 'inspection' } : tableFeature(f).cpu);
// Independent oracle: use only each engine's source fields, never its top-level maxima.
function tableCost(entry, f, engine, rows = noRows) {
  const cpu = oracleCpu(f, rows);
  if (cpu.kind !== 'measured') return 0;
  const c = cpu.engines[engine];
  if (!c) return 0;
  if (!entry || entry[1] === 0) return c.off;
  const v = c[entry[1] === 1 ? 'fixed' : 'adjustable'];
  if (Array.isArray(v)) return v[entry[2]];
  return (v.zero * (255 - entry[2]) + v.maximum * entry[2]) / 255;
}
function tableDelta(entry, f, engine, rows = noRows) {
  return tableCost(entry, f, engine, rows) - tableCost(f.default, f, engine, rows);
}
const referenceEntry = (f) => release.cpu.estimate_reference ?
  release.cpu.estimate_reference.profile.find((e) => e[0] === f.id) : f.default;
const sum = (entries, engine) => profile.features.reduce((total, f) =>
  total + tableCost(entries.find((e) => e[0] === f.id), f, engine) -
  tableCost(referenceEntry(f), f, engine), 0);
function choices(f, extremes = false) {
  // Factory-bank profiles cannot select absent user IDs; those costs are tested as unknown below.
  const values = f.values ? f.values.map((_, i) => i).filter((i) => f.id !== 1 || i < 10) :
    extremes ? [0, 255] : Array.from({ length: 256 }, (_, i) => i);
  return modes(f).flatMap(([state]) => (state === 0 ? [0] : values).map((value) =>
    [f.id, state, value, 0, 0, f.id === 9 && state === 1 && value ? 1 : 0]));
}
export function checkReleaseCosts(checked, read) {
  const { rows, sources, limits } = moduleCosts(checked, read);
  // Each module source is pinned by the import, and each row passes its validation.
  assert.deepEqual(checked.cpu.costs.module_sources ?? [], sources);
  // Module limits set the ceiling and warning at the ceiling rate's clean edge.
  assert.deepEqual(checked.cpu.limits ?? null, limits);
  if (limits) {
    const edge = limits.rates.find((r) => r.khz === limits.ceiling_khz).clean.percent;
    assert.deepEqual([checked.cpu.ceiling, checked.cpu.warning, checked.cpu.ceiling_kind], [edge, edge, 'measured']);
  }
  for (const f of checked.profile.features) assert.deepEqual(f.cpu, importedCost(f, costTable, rows), f.name);
  for (const f of checked.profile.features) {
    const module = rows.get(f.id);
    assert(module || tableFeature(f) || f.id === 24, 'unknown feature has no cost oracle');
    const cpu = oracleCpu(f, rows);
    assert(!('off' in f.cpu) && !('fixed' in f.cpu) && !('adjustable' in f.cpu));
    for (const engine of engines) {
      if (cpu.kind === 'measured' && !cpu.engines[engine]) {
        assert.match(cpu.note, new RegExp(`${engine}: (0 by construction|not applicable)`));
        assert.equal(f.cpu.engines[engine], undefined);
      }
      for (const entry of choices(f)) {
        assert(Math.abs(featureDelta(entry, f, engine) - tableDelta(entry, f, engine, rows)) < 1e-12,
          `${f.name}, ${engine}, state ${entry[1]}, value ${entry[2]}`);
      }
      assert.equal(featureDelta(undefined, { ...f, cpu: null }, engine), null);
      assert.equal(featureDelta(undefined, { ...f, cpu: { kind: 'unknown' } }, engine), null);
    }
    assert.equal(f.cpu.source, module ? module.cpu.source : cpu.kind === 'measured' ? costSource : inspectionSource);
    // Only a module source may describe a module measurement.
    if (!module) assert(!JSON.stringify(f.cpu).includes('measured on the module'));
  }
  assert.equal(checked.cpu.costs.source, costSource);
}
for (const r of manifest.releases) checkReleaseCosts(r);
for (const engine of engines) for (let id = 10; id < profile.features[0].values.length; ++id) {
  assert.equal(featureDelta([1, 1, id], profile.features[0], engine), null, 'unmeasured user-scale cost stays unknown');
  assert.equal(featureDelta([1, 2, id], profile.features[0], engine), null, 'unmeasured adjustable user-scale cost stays unknown');
}
assert.equal(featureDelta([2, 1, 1], profile.features[1], 'synth'), 0);
assert.equal(featureDelta([2, 1, 1], profile.features[1], 'granular'), 0);
assert.equal(featureDelta([5, 1, 1], profile.features[4], 'synth'), -0.062);
assert.equal(featureDelta([5, 1, 1], profile.features[4], 'granular'), 0);
// Both the exact default and a valid placement-only edit use the same baseline.
const moved = defaults(profile);
moved.find((e) => e[0] === 1)[3] = 10;
moved.find((e) => e[0] === 18)[3] = 1;
assert.notEqual(profileKey(moved, profile), profileKey(defaults(profile), profile));
assert.deepEqual(decodeProfile(encodeProfile(moved, profile), profile), moved);
for (const entries of [defaults(profile), moved]) {
  for (const result of cpuUsage(entries, release).engines) {
    assert.equal(result.percent, round(release.cpu.baselines[result.engine].percent +
      (release.cpu.estimated_default_delta?.[result.engine] || 0)));
  }
}
for (const f of profile.features) for (const engine of engines) {
  assert.equal(featureDelta(f.default, f, engine), 0, `${f.name}: default ${engine}`);
}
// A real setting change adds only the measured difference from its default.
const changed = structuredClone(moved);
changed[changed.findIndex((e) => e[0] === 18)] = [18, 1, 2, 0, 0, 0];
assert.deepEqual(decodeProfile(encodeProfile(changed, profile), profile), changed);
for (const result of cpuUsage(changed, release).engines) {
  const delta = tableDelta(changed.find((e) => e[0] === 18), profile.features[17], result.engine);
  assert.equal(delta, 0);
  assert.equal(result.percent, round(result.baseline.percent +
    (release.cpu.estimated_default_delta?.[result.engine] || 0) + delta));
}
const fixedPitch = structuredClone(moved);
fixedPitch[0] = [1, 1, 0, 0, 0, 0];
assert.equal(featureDelta(fixedPitch[0], profile.features[0], 'granular'), -0.16);
assert.equal(cpuUsage(fixedPitch, release).engines.find((e) => e.engine === 'granular').percent, 83.6);
for (const [name, entries] of Object.entries({ Default: defaults(profile), ...templates(profile) })) {
  assert.deepEqual(decodeProfile(encodeProfile(entries, profile), profile), entries, `${name} builds`);
  const usage = cpuUsage(entries, release);
  assert(!usage.blocked, name);
  for (const result of usage.engines) {
    // The exact default uses the measured baseline, ahead of estimated costs.
    const isDefault = profileKey(entries, profile) === profileKey(defaults(profile), profile);
    assert.equal(result.percent, round(result.baseline.percent + (isDefault && !release.cpu.estimate_reference ? 0 : sum(entries, result.engine))), name);
    if (!isDefault) assert.equal(result.measured, false);
  }
}
const maxima = [];
for (const engine of engines) {
  const entries = profile.features.map((f) => choices(f, true).reduce((best, e) =>
    tableDelta(e, f, engine) > tableDelta(best, f, engine) ? e : best));
  assert.deepEqual(decodeProfile(encodeProfile(entries, profile), profile), entries);
  const maximum = sum(entries, engine);
  const estimate = round(release.cpu.baselines[engine].percent + maximum);
  maxima.push(`${engine} ${estimate.toFixed(1)}% (delta ${maximum.toFixed(3)} points)`);
  const result = cpuUsage(entries, release).engines.find((e) => e.engine === engine);
  assert.equal(result.percent, estimate);
  assert.equal(result.warning, estimate >= 91);
  assert.equal(result.blocked, estimate > 92);
  for (const percent of [90, 91, 91.5, 92, 92.5]) {
    const measured = structuredClone(release);
    measured.cpu.combinations = [{ profile: profileKey(entries, profile), synth: percent, granular: percent }];
    const usage = cpuUsage(entries, measured);
    assert.equal(usage.percent, percent);
    assert.equal(usage.kind, 'measured');
    assert.equal(usage.warning, percent >= 91);
    assert.equal(usage.blocked, percent > 92);
    assert(usage.engines.every((e) => e.measured && e.percent === percent));
    // Exercise an override below a higher estimate on either engine.
    measured.cpu.baselines[engine].percent = 99;
    assert(cpuUsage(entries, { ...measured, cpu: { ...measured.cpu, combinations: [] } }).percent > percent);
    assert.equal(cpuUsage(entries, measured).percent, percent);
  }
}
let seed = 0x321;
const random = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
for (let i = 0; i < 100; ++i) {
  const entries = profile.features.map((f) => { const options = choices(f); return options[random(options.length)]; });
  const usage = cpuUsage(entries, release);
  for (const result of usage.engines) {
    const delta = sum(entries, result.engine);
    const individual = profile.features.reduce((total, f) =>
      total + featureDelta(entries.find((e) => e[0] === f.id), f, result.engine), 0);
    assert(Math.abs(individual + (release.cpu.estimated_default_delta?.[result.engine] || 0) - delta) < 1e-10);
    assert.equal(result.percent, round(result.baseline.percent + delta));
  }
}
const app = readFileSync(new URL('../static/js/app.js', import.meta.url), 'utf8');
assert(!app.includes('cpuUsage'), 'historical cost calculations are not consumed by the editor');
assert(!app.includes('CPU limit exceeded'));
assert(!app.includes('No CPU cost'));
assert.equal(release.cpu.costs.source, costSource);
console.log(`PASS historical costs: templates, exhaustive deltas, random sums and measured precedence; maxima ${maxima.join('; ')}`);
