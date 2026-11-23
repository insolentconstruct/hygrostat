// Copyright 2026 Insolent Construct.
// Author: Insolent Construct.
// MIT licence: see ../static/js/encoder.js.
// Reads a firmware feature catalogue (profile-features.json). Format 2 names
// its feature manifest's SHA-256 and record version, and each saved feature's
// record byte in place of format 1's packed field.
import { createHash } from 'node:crypto';

const STATES = ['Off', 'Fixed', 'Adjustable'];
const ROW_KEYS = ['id', 'name', 'values', 'states', 'page_slots', 'amount_slots', 'actions', 'stateless',
  'default_state', 'default', 'factory', 'touches_synth', 'cpu_cost', 'saved'];
// Saved options sit in record payload bytes 8-55.
export const RECORD_FIRST = 8;
export const RECORD_SIZE = 56;
export const MANIFEST = 'beads/resources/features.json';
export const CATALOGUE = 'beads/build/profile-features.json';
const byte = (v) => Number.isInteger(v) && v >= 0 && v <= 255;
const flag = (v) => typeof v === 'boolean';
// Slots are distinct, ascending numbers from 1 up to the control's count.
const slots = (v, most) => Array.isArray(v) && v.every((s, i) => Number.isInteger(s) && s >= 1 && s <= most &&
  (!i || s > v[i - 1]));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function checkRow(c, i, offsets) {
  const fail = (what) => { throw new Error(`Catalogue feature ${i + 1}: ${what}.`); };
  if (!c || typeof c !== 'object' || Object.keys(c).length !== ROW_KEYS.length ||
      !ROW_KEYS.every((k) => Object.hasOwn(c, k))) fail('unexpected fields');
  if (c.id !== i + 1) fail('IDs must run 1, 2, 3...');
  if (typeof c.name !== 'string' || !c.name) fail('no name');
  if (c.values !== null && (!Array.isArray(c.values) || !c.values.length ||
      !c.values.every((v) => typeof v === 'string'))) fail('invalid values');
  if (!Array.isArray(c.states) || !c.states.length || !c.states.every((s) => STATES.includes(s))) fail('invalid states');
  if (!slots(c.page_slots, 255) || !slots(c.amount_slots, 3) || !slots(c.actions, 3)) fail('invalid controls');
  if (!flag(c.stateless) || !flag(c.touches_synth)) fail('invalid flags');
  if (!c.states.includes(c.default_state) || !byte(c.default) ||
      (c.values && c.default >= c.values.length)) fail('invalid default');
  if (c.cpu_cost !== null) fail('costs come from Hygrostat');
  if (c.saved !== null) {
    if (!Number.isInteger(c.saved) || c.saved < RECORD_FIRST || c.saved >= RECORD_SIZE) fail('record byte out of range');
    if (offsets.has(c.saved)) fail('record byte already used');
    offsets.add(c.saved);
  }
  if (c.factory !== null && (!Array.isArray(c.factory) || c.factory.length !== 6 || !c.factory.every(byte) ||
      c.factory[0] !== c.id || STATES[c.factory[1]] !== c.default_state || c.factory[2] !== c.default)) {
    fail('factory entry differs from its default');
  }
}

// Bytes as published; a format 2 catalogue also checks manifest bytes when given.
export function readCatalogue(bytes, manifestBytes = null) {
  const catalogue = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (catalogue?.format === 1) return catalogue;
  if (catalogue?.format !== 2) throw new Error('Unsupported catalogue format.');
  if (!/^[0-9a-f]{64}$/.test(catalogue.manifest_sha256) || !byte(catalogue.record_version) ||
      !catalogue.record_version || !Array.isArray(catalogue.features)) {
    throw new Error('Invalid format 2 catalogue header.');
  }
  if (manifestBytes !== null && sha256(manifestBytes) !== catalogue.manifest_sha256) {
    throw new Error('The catalogue was not generated from this feature manifest.');
  }
  const offsets = new Set();
  catalogue.features.forEach((c, i) => checkRow(c, i, offsets));
  return catalogue;
}

// The firmware's catalogue at a ref, checked against that ref's manifest.
export const catalogueAtRef = (show, ref) => readCatalogue(show(ref, CATALOGUE), show(ref, MANIFEST));

// Editor features (a release's profile.features) without costs, from format 2.
export function catalogueFeatures(catalogue) {
  if (catalogue.format !== 2) throw new Error('Editor features need a format 2 catalogue.');
  return catalogue.features.map((c) => ({ id: c.id, name: c.name, values: c.values,
    page: c.page_slots.length > 0, amount: c.amount_slots.length > 0, action: c.actions.length > 0,
    stateless: c.stateless, synth_path: c.touches_synth, cpu: null,
    default: c.factory ? c.factory.slice() : [c.id, STATES.indexOf(c.default_state), c.default, 0, 0, 0],
    default_in_block: c.factory !== null, states: c.states.slice(), saved: c.saved }));
}

// kFeatureDefinitions rows after None: [values, field, page, amount, action, stateless].
// Generated features.cc first, then profile.cc, which holds them up to P4.
export function firmwareDefinitions(read) {
  let source = null;
  for (const file of ['beads/features.cc', 'beads/profile.cc']) {
    try {
      source = read(file);
    } catch {
      continue;
    }
    if (source.includes('kFeatureDefinitions[FEATURE_LAST] = {')) break;
  }
  if (!source?.includes('kFeatureDefinitions[FEATURE_LAST] = {')) throw new Error('No feature definitions found.');
  const table = source.split('kFeatureDefinitions[FEATURE_LAST] = {')[1].split('};')[0];
  return [...table.matchAll(/\{ (\d+), (\w+), (true|false), (true|false), (true|false), (true|false) \}/g)]
    .slice(1).map((m) => [Number(m[1]), m[2] === 'kNoField' ? null : Number(m[2]),
      m[3] === 'true', m[4] === 'true', m[5] === 'true', m[6] === 'true']);
}

// The options record's version and per-feature bytes (0: not saved), generated into settings.*.
export function firmwareRecord(read) {
  const version = /\bkOptionsRecordVersion = (\d+);/.exec(read('beads/settings.h'));
  const table = read('beads/settings.cc').split('kRecordOffsets[FEATURE_LAST] = {')[1]?.split('};')[0];
  if (!version || !table) throw new Error('No options record layout found.');
  return { version: Number(version[1]), offsets: [...table.matchAll(/^ {2}(\d+),/gm)].slice(1).map((m) => Number(m[1])) };
}

// A catalogue row agrees with the firmware's definition; format 2's record
// bytes and version must also equal the firmware's record layout.
export function checkDefinitions(catalogue, definitions, record = null) {
  if (catalogue.features.length !== definitions.length) throw new Error('Catalogue and firmware feature counts differ.');
  if (catalogue.format === 2 && (record?.version !== catalogue.record_version ||
      record.offsets.length !== definitions.length)) {
    throw new Error('Catalogue and firmware record layouts differ.');
  }
  catalogue.features.forEach((c, i) => {
    const [values, field, page, amount, action, stateless] = definitions[i];
    const saved = catalogue.format === 1 ? c.field === field :
      (c.saved ?? 0) === record.offsets[i] && (field === null || c.saved !== null) &&
      // As features.py: a feature saved without a packed field is enumerated (the resonator, Rings polyphony).
      (c.id < 15 || field !== null || c.saved === null || c.values !== null);
    if ((c.values?.length || 0) !== values || (c.page_slots.length > 0) !== page ||
        (c.amount_slots.length > 0) !== amount || (c.actions.length > 0) !== action ||
        (c.stateless ?? false) !== stateless || !saved) {
      throw new Error(`Catalogue feature ${c.id} differs from the firmware.`);
    }
  });
}
