// Copyright 2026 Insolent Construct.
// MIT licence: see ../static/js/encoder.js.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const tableSha256 = 'dc5f7fef75cb5c0435aa52f5513549a17b48f4daf37d2728ba5debbd281063a3';
export const costSource = 'measured on a module-calibrated development board';
export const inspectionSource = 'no per-block work (code inspection)';
export const moduleMeasuredOn = 'Beads module';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readRepo = (path) => readFileSync(new URL('../' + path, import.meta.url));
export const tableBytes = readRepo('costs/cost-table.json');
if (sha256(tableBytes) !== tableSha256) {
  throw new Error('Cost table checksum mismatch.');
}
export const costTable = JSON.parse(tableBytes);
const engineNames = ['synth', 'granular'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
  return { kind: 'zero', source: inspectionSource,
    engines: Object.fromEntries(engineNames.map((engine) =>
      [engine, { off: 0, fixed: [0, 0], adjustable: [0, 0] }])),
    uncertainty: { points: 0 }, note: known.note };
}

// A module source covers every value of its feature with finite costs; zero rows are all zero.
function checkEngines(feature, cpu, zero) {
  const label = `${feature.id} ${feature.name}`;
  const finite = (v) => Number.isFinite(v) && (!zero || v === 0);
  if (!cpu.engines || typeof cpu.engines !== 'object' || Object.keys(cpu.engines).some((e) => !engineNames.includes(e))) {
    throw new Error(`Module cost engines are not synth/granular: ${label}`);
  }
  for (const engine of engineNames) {
    const costs = cpu.engines[engine];
    if (costs === undefined) {
      if (zero || !new RegExp(`${engine}: (0 by construction|not applicable)`).test(cpu.note)) {
        throw new Error(`Module cost omits ${engine} without saying why: ${label}`);
      }
      continue;
    }
    const valid = (v) => feature.values ? Array.isArray(v) && v.length === feature.values.length && v.every(finite) :
      v !== null && typeof v === 'object' && finite(v.zero) && finite(v.maximum);
    if (costs === null || typeof costs !== 'object' || !finite(costs.off) || !valid(costs.fixed) || !valid(costs.adjustable)) {
      throw new Error(`Module cost has a missing or invalid ${engine} value: ${label}`);
    }
  }
}

// Measured rows name their run, share-relative report and image; zero rows name the inspected firmware.
function moduleCost(feature, row) {
  const label = `${feature.id} ${feature.name}`;
  if (row.name !== feature.name || !same(row.values, feature.values)) throw new Error(`Module cost feature mismatch: ${label}`);
  const cpu = row.cpu;
  if (!cpu || typeof cpu !== 'object' || !['measured', 'zero'].includes(cpu.kind)) {
    throw new Error(`Module cost is missing or of unknown kind: ${label}`);
  }
  const zero = cpu.kind === 'zero';
  const text = (v) => typeof v === 'string' && v.length > 0;
  const report = (v) => text(v) && /^[\w.-]+(\/[\w.-]+)*\.json$/.test(v) && !v.split('/').some((p) => /^\.+$/.test(p));
  const provenance = Array.isArray(row.provenance) && row.provenance.length > 0 && row.provenance.every((p) => zero ?
    same(Object.keys(p).sort(), ['inspected']) && /^[0-9a-f]{7,40}$/.test(p.inspected) :
    same(Object.keys(p).sort(), ['image', 'report', 'run']) && text(p.image) && text(p.run) && report(p.report) &&
      [p.image, p.run, p.report].every((v) => text(cpu.source) && cpu.source.includes(v)));
  if (!provenance) throw new Error(`Module cost provenance is missing or incomplete: ${label}`);
  if (zero ? cpu.source !== inspectionSource || cpu.uncertainty?.points !== 0 :
    !(cpu.uncertainty?.points > 0) || !Number.isFinite(cpu.uncertainty.points)) {
    throw new Error(`Module cost source or uncertainty is invalid: ${label}`);
  }
  if (!text(cpu.note)) throw new Error(`Module cost needs a note: ${label}`);
  checkEngines(feature, cpu, zero);
  return { kind: cpu.kind, source: cpu.source, engines: structuredClone(cpu.engines),
    uncertainty: structuredClone(cpu.uncertainty), note: cpu.note };
}

// Each quality's codec rate; the synths run at 48 kHz, which must leave the heavy patch least room.
const codecRates = new Map([['Bright digital', 48], ['Sunny tape', 48], ['Cold digital', 32], ['Scorched cassette', 24]]);
const synthRate = 48;
const blockCycles = 120000;
export function moduleLimits(limits, path) {
  const fail = (what) => { throw new Error(`Module CPU limits ${what}: ${path}`); };
  const text = (v) => typeof v === 'string' && v.length > 0;
  const cycles = (v) => Number.isInteger(v) && v > 0 && v < blockCycles;
  const percent = (v) => Math.round(v / blockCycles * 1000) / 10;
  const report = (v) => text(v) && /^[\w.-]+(\/[\w.-]+)*\.(json|md)$/.test(v) && !v.split('/').some((p) => /^\.+$/.test(p));
  if (!limits || typeof limits !== 'object' || limits.block_cycles !== blockCycles) fail('need a 120000-cycle block');
  if (!Array.isArray(limits.provenance) || !limits.provenance.length || !limits.provenance.every((p) =>
    same(Object.keys(p).sort(), ['image', 'report', 'run']) && text(p.image) && text(p.run) && report(p.report))) {
    fail('provenance is missing or incomplete');
  }
  if (!text(limits.note)) fail('need a note');
  const rates = Array.isArray(limits.rates) ? limits.rates : [];
  const listed = rates.flatMap((r) => Array.isArray(r?.qualities) ? r.qualities : [null]);
  if (!rates.length || listed.length !== codecRates.size || ![...codecRates.keys()].every((q) => listed.includes(q)) ||
      new Set(rates.map((r) => r.khz)).size !== rates.length ||
      !rates.every((r) => r && r.qualities.length > 0 && r.qualities.every((q) => codecRates.get(q) === r.khz) &&
        cycles(r.clean_cycles) && cycles(r.first_late_cycles) && r.clean_cycles < r.first_late_cycles)) {
    fail('need each quality once at a codec rate with a clean edge below its first late load');
  }
  const ceiling = rates.find((r) => r.khz === limits.ceiling_khz);
  if (limits.ceiling_khz !== synthRate || !ceiling) fail('need the synths\' 48 kHz rate as the ceiling');
  const rateOf = (quality) => rates.find((r) => r.qualities.includes(quality));
  const heavy = Array.isArray(limits.heavy) ? limits.heavy : [];
  if (heavy.length !== codecRates.size || new Set(heavy.map((h) => h?.quality)).size !== heavy.length ||
      !heavy.every((h) => codecRates.has(h?.quality) && cycles(h.peak_cycles) &&
        h.peak_cycles < rateOf(h.quality).clean_cycles)) {
    fail('need one heavy peak per quality below its rate\'s clean edge');
  }
  const margin = (h) => rateOf(h.quality).clean_cycles - h.peak_cycles;
  const binding = heavy.filter((h) => ceiling.qualities.includes(h.quality));
  if (Math.min(...binding.map(margin)) > Math.min(...heavy.map(margin))) {
    fail('leave another rate less room than the ceiling rate');
  }
  return { measured_on: moduleMeasuredOn, block_cycles: blockCycles, provenance: structuredClone(limits.provenance),
    ceiling_khz: ceiling.khz,
    rates: rates.map((r) => ({ khz: r.khz, qualities: [...r.qualities],
      clean: { cycles: r.clean_cycles, percent: percent(r.clean_cycles) },
      first_late: { cycles: r.first_late_cycles, percent: percent(r.first_late_cycles) } })),
    heavy: heavy.map((h) => ({ quality: h.quality, khz: rateOf(h.quality).khz,
      peak: { cycles: h.peak_cycles, percent: percent(h.peak_cycles) }, margin_points: percent(margin(h)) })),
    note: limits.note };
}

// A release lists its module-measured cost files in cpu.costs.module_sources; the import pins each SHA-256.
export function moduleCosts(release, read = readRepo) {
  const rows = new Map(), sources = [];
  let limits = null;
  for (const ref of release.cpu?.costs?.module_sources || []) {
    if (!/^costs\/[\w.-]+\.json$/.test(ref.path) || ref.path === 'costs/cost-table.json') {
      throw new Error(`Module cost source must be a new file in costs/: ${ref.path}`);
    }
    const bytes = read(ref.path), digest = sha256(bytes);
    if (ref.sha256 !== undefined && ref.sha256 !== digest) throw new Error(`Module cost source checksum mismatch: ${ref.path}`);
    const source = JSON.parse(bytes);
    if (source.format !== 1 || source.measured_on !== moduleMeasuredOn || !Array.isArray(source.features) ||
        !source.features.length) {
      throw new Error(`Not a module cost source: ${ref.path}`);
    }
    for (const row of source.features) {
      if (!row || !Number.isInteger(row.id)) throw new Error(`Module cost row without a feature ID: ${ref.path}`);
      if (rows.has(row.id) || eventOnly.has(row.id)) throw new Error(`Module cost listed twice or for an event-only feature: ${row.id}`);
      rows.set(row.id, row);
    }
    if (source.limits !== undefined) {
      if (limits) throw new Error(`Module CPU limits listed twice: ${ref.path}`);
      limits = moduleLimits(source.limits, ref.path);
    }
    sources.push({ path: ref.path, sha256: digest, features: source.features.map((row) => row.id) });
  }
  for (const id of rows.keys()) {
    if (!release.profile.features.some((f) => f.id === id)) throw new Error(`Module cost for a feature the release lacks: ${id}`);
  }
  return { rows, sources, limits };
}

export function importedCost(feature, table = costTable, module = new Map()) {
  if (module.has(feature.id)) return moduleCost(feature, module.get(feature.id));
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
  const engines = zero ? Object.fromEntries(engineNames.map((engine) =>
    [engine, { off: 0, fixed: values(), adjustable: values() }])) : structuredClone(cpu.engines);
  return { kind: zero ? 'zero' : 'measured',
    source: zero ? inspectionSource : costSource,
    engines, uncertainty: structuredClone(cpu.uncertainty), note: cpu.note };
}

export function importCosts(manifest, read = readRepo) {
  const releases = manifest.releases.filter((r) => r.development);
  if (releases.length !== 1) throw new Error('Expected one development release.');
  const release = releases[0];
  const module = moduleCosts(release, read);
  const ids = new Set(release.profile.features.map((f) => f.id));
  const tableIds = new Set(costTable.features.map((f) => f.id));
  const additions = release.profile.features.filter((f) => eventOnly.has(f.id));
  if (ids.size !== release.profile.features.length || ![...tableIds].every((id) => ids.has(id)) ||
      ![...ids].every((id) => tableIds.has(id) || eventOnly.has(id) || module.rows.has(id))) {
    throw new Error('Cost table feature set mismatch.');
  }
  const costs = release.profile.features.map((f) => importedCost(f, costTable, module.rows));
  release.profile.features.forEach((f, i) => { f.cpu = costs[i]; });
  release.cpu.costs = { source: costSource, firmware: costTable.firmware,
    table: 'costs/cost-table.json', table_sha256: tableSha256 };
  if (additions.length) release.cpu.costs.inspected_features = additions.map((f) => ({ id: f.id, name: f.name, source: 'code inspection' }));
  if (module.sources.length) release.cpu.costs.module_sources = module.sources;
  // The estimator's ceiling and warning become the module's clean edge; no margin is added.
  if (release.cpu.limits && !module.limits) throw new Error('Module CPU limits are no longer in a module source.');
  const ceiling = module.limits?.rates.find((r) => r.khz === module.limits.ceiling_khz);
  if (ceiling) {
    release.cpu.limits = module.limits;
    Object.assign(release.cpu, { ceiling: ceiling.clean.percent, warning: ceiling.clean.percent, ceiling_kind: 'measured' });
  }
  release.cpu.release_note = 'Default-profile baselines include Clouds-style reverb. Per-feature costs were measured on a module-calibrated development board; estimates sum each engine’s costs. Measured module combinations take precedence. Setting combinations still need module measurement. The default profile is always allowed.' + (additions.length ? ' Event-only additions are classified separately by code inspection; they have no per-block cost.' : '') +
    (module.sources.length ? ' Costs from a module source replace the table: measured on the Beads module, each naming its run, report and firmware image, or zero by code inspection.' : '') +
    (ceiling ? ` The CPU limit is the clean edge measured on the Beads module at ${ceiling.khz} kHz, ${ceiling.clean.percent}% of the block; the other codec rates' edges and heavy-patch peaks are measured reference.` : '');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL('../static/manifest.json', import.meta.url);
  writeFileSync(path, JSON.stringify(importCosts(JSON.parse(readFileSync(path))), null, 2) + '\n');
  console.log('Imported per-engine CPU costs.');
}
