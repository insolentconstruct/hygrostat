// Copyright 2026 Insolent Construct.
// MIT licence: see ../static/js/encoder.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const tableSha256 = 'dc5f7fef75cb5c0435aa52f5513549a17b48f4daf37d2728ba5debbd281063a3';
export const costSource = 'measured on a module-calibrated development board';
export const tableBytes = readFileSync(new URL('../costs/cost-table.json', import.meta.url));
if (createHash('sha256').update(tableBytes).digest('hex') !== tableSha256) {
  throw new Error('Cost table checksum mismatch.');
}
export const costTable = JSON.parse(tableBytes);

// Later event-only options are inspected separately; never rewrite the historical table.
const eventOnly = new Map([[24, {
  name: 'Synth reverb tail', values: ['Keep (stock)', 'Clear'], states: ['Off', 'Fixed'],
  note: 'clearing the synth reverb happens only when leaving synth playback; no per-block or per-tick work'
}]]);

function inspectedCost(feature) {
  const known = eventOnly.get(feature.id);
  if (!known || feature.name !== known.name || JSON.stringify(feature.values) !== JSON.stringify(known.values) ||
      JSON.stringify(feature.states) !== JSON.stringify(known.states) || feature.field !== null ||
      feature.page !== false || feature.amount !== false || feature.action !== false || feature.stateless !== false ||
      feature.default_in_block !== false || JSON.stringify(feature.default) !== JSON.stringify([feature.id, 0, 0, 0, 0, 0])) {
    throw new Error(`Unknown event-only feature definition: ${feature.id} ${feature.name}`);
  }
  return { kind: 'zero', source: 'no per-block work (code inspection)',
    engines: Object.fromEntries(['synth', 'granular'].map((engine) =>
      [engine, { off: 0, fixed: [0, 0], adjustable: [0, 0] }])),
    uncertainty: { points: 0 }, note: known.note };
}

export function importedCost(feature, table = costTable) {
  const matches = table.features.filter((f) => f.id === feature.id);
  if (eventOnly.has(feature.id)) {
    if (matches.length) throw new Error('Event-only additions must not replace the historical cost table.');
    return inspectedCost(feature);
  }
  if (!costTable.features.some((f) => f.id === feature.id)) throw new Error('Unknown cost feature.');
  const measuredName = feature.id === 10 && feature.name === 'Random pitch steps' ? 'Random intervals' : feature.name;
  if (matches.length !== 1 || matches[0].name !== measuredName) {
    throw new Error(`Cost table feature mismatch: ${feature.id} ${feature.name}`);
  }
  const cpu = matches[0].cpu;
  if (!['measured', 'inspection'].includes(cpu.kind)) throw new Error('Unknown table cost kind.');
  const zero = cpu.kind === 'inspection';
  const values = () => feature.values ? feature.values.map(() => 0) : { zero: 0, maximum: 0 };
  const engines = zero ? Object.fromEntries(['synth', 'granular'].map((engine) =>
    [engine, { off: 0, fixed: values(), adjustable: values() }])) : structuredClone(cpu.engines);
  return { kind: zero ? 'zero' : 'measured',
    source: zero ? 'no per-block work (code inspection)' : costSource,
    engines, uncertainty: structuredClone(cpu.uncertainty), note: cpu.note };
}

export function importCosts(manifest) {
  const releases = manifest.releases.filter((r) => r.development);
  if (releases.length !== 1) throw new Error('Expected one development release.');
  const release = releases[0];
  const ids = new Set(release.profile.features.map((f) => f.id));
  const additions = release.profile.features.filter((f) => eventOnly.has(f.id));
  if (ids.size !== release.profile.features.length ||
      release.profile.features.length !== costTable.features.length + additions.length ||
      !costTable.features.every((f) => ids.has(f.id))) {
    throw new Error('Cost table feature set mismatch.');
  }
  const costs = release.profile.features.map((f) => importedCost(f));
  release.profile.features.forEach((f, i) => { f.cpu = costs[i]; });
  release.cpu.costs = { source: costSource, firmware: costTable.firmware,
    table: 'costs/cost-table.json', table_sha256: tableSha256 };
  if (additions.length) release.cpu.costs.inspected_features = additions.map((f) => ({ id: f.id, name: f.name, source: 'code inspection' }));
  release.cpu.release_note = 'Historical default-profile measurements include Clouds-style reverb. Per-feature costs were measured on a module-calibrated development board; estimates sum each engine’s costs. Measured module combinations take precedence. The final image still needs measurement. The default profile is always allowed.' + (additions.length ? ' Event-only additions are classified separately by code inspection; they have no per-block cost.' : '');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL('../static/manifest.json', import.meta.url);
  writeFileSync(path, JSON.stringify(importCosts(JSON.parse(readFileSync(path))), null, 2) + '\n');
  console.log('Imported per-engine CPU costs.');
}
