// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// See http://creativecommons.org/licenses/MIT/ for more information.
//
import { SCALE_RECORD_SIZE, validateScales, readScales, writeScales, effectiveScales } from './scales.js?v=16167360dbd8375b';

// Six-byte entries are kept in wire order: id, state, value, page, amount, action.
const STATES = ['Off', 'Fixed', 'Adjustable'];
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; ++i) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validate(entries, profile) {
  if (!Array.isArray(entries) || entries.length > 82) throw new Error('Too many features.');
  const seen = new Set();
  const used = [new Set(), new Set(), new Set()];
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 6 ||
        entry.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) {
      throw new Error('Invalid feature entry.');
    }
    const [id, state, value, page, amount, action] = entry;
    const f = profile.features.find((f) => f.id === id);
    if (!f || seen.has(id)) throw new Error('Unknown or repeated feature.');
    seen.add(id);
    if (state > 2 || (f.states && !f.states.includes(STATES[state])) || (f.values && value >= f.values.length) ||
        page > 12 || amount > 2 || action > 3 ||
        (page && (!f.page || state !== 2)) ||
        (amount && (!f.amount || state !== 2)) ||
        (action && (!f.action || !state || (state === 1 && (!value || !f.stateless)))) ||
        (id === 9 && state === 1 && value && !action)) {
      throw new Error(`${f.name}: this setting or placement is not allowed.`);
    }
    [page, amount, action].forEach((slot, k) => {
      if (slot && used[k].has(slot)) throw new Error(`${f.name}: control already used.`);
      if (slot) used[k].add(slot);
    });
  }
  return entries;
}

function validatePitchDefault(entries, scales) {
  const pitch = entries.find((e) => e[0] === 1);
  if (pitch && pitch[2] >= 2 && !effectiveScales(scales).some((scale) => scale.id === pitch[2])) {
    throw new Error('The pitch starting value must be present in the scale bank.');
  }
}

const validFormat = (format) => Number.isInteger(format) && format > 0 && format <= 0xffffffff;

export function encodeProfile(entries, profile, scales = null) {
  validate(entries, profile);
  const version = profile.version || 1;
  if (![1, 2].includes(version) || profile.size !== (version === 2 ? 4096 : 512) ||
      !validFormat(profile.format)) throw new Error('Unsupported profile format.');
  if (version === 1 && scales !== null) throw new Error('This release cannot customize scales.');
  const bank = validateScales(scales);
  validatePitchDefault(entries, bank);
  const payload = entries.length * 6 + (bank?.length || 0) * SCALE_RECORD_SIZE;
  const b = new Uint8Array(profile.size).fill(255);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x46505a44, true);
  b[4] = version;
  b[5] = entries.length;
  v.setUint16(6, payload, true);
  v.setUint32(8, profile.format, true);
  v.setUint32(12, 0, true);
  if (version === 2) { b[12] = bank === null ? 0 : 1; b[13] = bank?.length || 0; }
  entries.forEach((e, i) => b.set(e, 16 + i * 6));
  if (bank) writeScales(b, 16 + entries.length * 6, bank);
  const end = 16 + payload;
  v.setUint32(end, crc32(b.subarray(0, end)), true);
  return b;
}

export function decodeSettings(b, profile) {
  if (!(b instanceof Uint8Array) || b.length !== profile.size ||
      ![1, 2].includes(profile.version) || b.length !== (profile.version === 2 ? 4096 : 512)) {
    throw new Error('Invalid profile size or version.');
  }
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const version = b[4];
  // V2 firmware also reads V1 records, bounded to their original 512 bytes.
  // Share links still require the release's own version before reaching here.
  const compatible = version === profile.version || (profile.version === 2 && version === 1);
  const limit = version === 1 ? 512 : b.length;
  const count = b[5];
  const custom = version === 2 ? b[12] : 0;
  const scaleCount = version === 2 ? b[13] : 0;
  const payload = count * 6 + scaleCount * SCALE_RECORD_SIZE;
  const end = 16 + payload;
  if (count > 82 || scaleCount > 14 || custom > 1 || (!custom && scaleCount) ||
      end + 4 > limit || v.getUint16(6, true) !== payload ||
      v.getUint32(0, true) !== 0x46505a44 || !compatible ||
      !validFormat(profile.format) || v.getUint32(8, true) !== profile.format || b[14] || b[15] ||
      (version === 1 && v.getUint32(12, true) !== 0) ||
      v.getUint32(end, true) !== crc32(b.subarray(0, end))) {
    throw new Error('Invalid profile header or checksum.');
  }
  const entries = validate(Array.from({ length: count }, (_, i) =>
    Array.from(b.subarray(16 + i * 6, 22 + i * 6))), profile);
  const scales = custom ? readScales(b, 16 + count * 6, scaleCount) : null;
  validatePitchDefault(entries, scales);
  return { entries, scales };
}

export const decodeProfile = (b, profile) => decodeSettings(b, profile).entries;
export const decodeScaleBank = (b, profile) => decodeSettings(b, profile).scales;

export const defaults = (profile) => profile.features.filter((f) => f.default_in_block !== false).map((f) => f.default.slice());
// Canonical editor entries: omitted catalogue defaults stay absent when Off.
// Keep the codec lossless for independently supplied firmware blocks.
export function normalise(entries, profile) {
  validate(entries, profile);
  return entries.filter((e) => e[1] !== 0 ||
    profile.features.find((f) => f.id === e[0]).default_in_block !== false)
    .map((e) => e[1] === 0 ? [e[0], 0, 0, 0, 0, 0] : e.slice());
}
export const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export async function sha256(b) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)),
      (v) => v.toString(16).padStart(2, '0')).join('');
}
export const fingerprint = async (block) => (await sha256(block)).slice(0, 8);
export function filenames(release, fp, isDefault) {
  const suffix = isDefault ? '' : `-${fp}`;
  const date = release.tag.replace(/^drizzlet-/, '');
  return { wav: `${release.tag}${suffix}.wav`,
    desktop: isDefault ? `options-guide${release.development ? '-dev' : ''}.svg` : `options-guide-${date}${suffix}.svg`,
    mobile: isDefault ? `options-guide${release.development ? '-dev' : ''}-mobile.svg` : `options-guide-${date}${suffix}-mobile.svg` };
}
export function share(release, block) {
  return new URLSearchParams({ release: release.tag,
    profile: Array.from(block, (v) => v.toString(16).padStart(2, '0')).join('') }).toString();
}
export function unshare(text, releases) {
  const params = new URLSearchParams(text.replace(/^#/, ''));
  const release = releases.find((r) => r.tag === params.get('release'));
  const hex = params.get('profile');
  if (!params.get('release') || !hex || !/^[0-9a-f]+$/i.test(hex) || hex.length % 2) {
    throw new Error('Invalid share link. Copy the full address.');
  }
  if (!release) throw new Error('This link is for another release, no longer offered here. Choose a release and start again.');
  if (hex.length !== release.profile.size * 2) throw new Error('Invalid share link size.');
  const block = Uint8Array.from(hex.match(/../g), (v) => parseInt(v, 16));
  const header = new DataView(block.buffer);
  if (header.getUint32(0, true) === 0x46505a44 &&
      (block[4] !== release.profile.version || header.getUint32(8, true) !== release.profile.format)) {
    throw new Error('Share link version mismatch. Use its original page or start again.');
  }
  try {
    return { release, ...decodeSettings(block, release.profile) };
  } catch (error) {
    throw new Error('Damaged or outdated share link. Copy the full address or start again.', { cause: error });
  }
}
// Focused templates start from every feature Off and add only their own
// settings: { id: [state, value, page, amount, action] }.
export function templates(profile) {
  // A setting that cannot be Off, such as the Plaits bank, keeps its default.
  const stock = defaults(profile).map((e) => canBeOff(profile.features.find((f) => f.id === e[0])) ? [e[0], 0, 0, 0, 0, 0] : e);
  const focused = (changes) => [...stock.map((e) => changes[e[0]] ? [e[0], ...changes[e[0]]] : e),
    ...Object.keys(changes).map(Number).filter((id) => !stock.some((e) => e[0] === id))
      .map((id) => [id, ...changes[id]])];
  return { Drizzlet: defaults(profile), 'Stock plus fixes': stock,
    'Cloud textures': focused({ 2: [2, 1, 3, 0, 0], 3: [1, 1, 0, 0, 0], 6: [2, 1, 1, 0, 0],
      11: [2, 128, 0, 1, 0], 12: [2, 96, 0, 2, 0], 14: [1, 1, 0, 0, 2], 23: [2, 1, 2, 0, 0] }),
    'Pitched grains': focused({ 1: [2, 6, 1, 0, 0], 3: [1, 1, 0, 0, 0], 8: [2, 0, 3, 0, 0], 10: [2, 1, 2, 0, 0],
      11: [2, 64, 0, 1, 0], 13: [2, 0, 0, 0, 1], 14: [1, 1, 0, 0, 2], 22: [1, 1, 0, 0, 0] }),
    'Drum grains': focused({ 3: [1, 1, 0, 0, 0], 5: [2, 1, 1, 0, 0], 8: [2, 1, 3, 0, 0],
      13: [2, 0, 0, 0, 1], 14: [1, 1, 0, 0, 2], 21: [2, 2, 2, 0, 0] }),
    'Delay & freeze': focused({ 2: [2, 0, 3, 0, 0], 3: [2, 2, 1, 0, 0], 14: [1, 1, 0, 0, 2],
      17: [1, 1, 0, 0, 0], 20: [1, 1, 0, 0, 0], 21: [2, 1, 2, 0, 0] }),
    Spectral: focused({ 1: [2, 0, 1, 0, 0], 2: [2, 0, 3, 0, 0], 4: [2, 1, 2, 0, 0] }),
    'Plaits voice': focused({ 1: [2, 1, 1, 0, 0], 7: [1, 1, 0, 0, 0], 9: [1, 1, 0, 0, 3], 10: [2, 1, 2, 0, 0],
      11: [2, 64, 0, 1, 0], 21: [1, 2, 0, 0, 0], 22: [1, 1, 0, 0, 0] }),
    'Live essentials': focused({ 1: [2, 0, 1, 0, 0], 3: [1, 1, 0, 0, 0], 9: [1, 1, 0, 0, 3],
      11: [2, 128, 0, 1, 0], 13: [2, 0, 0, 0, 1], 14: [1, 1, 0, 0, 2], 16: [1, 1, 0, 0, 0],
      18: [2, 1, 3, 0, 0], 19: [1, 1, 0, 0, 0], 20: [1, 1, 0, 0, 0], 21: [2, 0, 2, 0, 0] }) };
}
export const profileKey = (entries, profile) => Array.from(encodeProfile(entries, profile),
    (v) => v.toString(16).padStart(2, '0')).join('');
// One engine's cost of a setting, in points, relative to the release default; an
// engine the feature cannot run on costs 0, an unmeasured feature is null.
export function featureDelta(entry, feature, engine) {
  if (!feature.cpu || !['measured', 'zero'].includes(feature.cpu.kind)) return null;
  const cpu = feature.cpu.engines[engine];
  if (!cpu) return 0;
  const cost = (e) => {
    if (!e || e[1] === 0) return cpu.off;
    const costs = cpu[e[1] === 1 ? 'fixed' : 'adjustable'];
    return Array.isArray(costs) ? costs[e[2]] : costs.zero + (costs.maximum - costs.zero) * e[2] / 255;
  };
  // The measured engine baseline already includes every default setting.
  // Subtract its cost even for omitted entries (Off); placement has no cost.
  const delta = cost(entry) - cost(feature.default);
  return Number.isFinite(delta) ? delta : null;
}
export function cpuUsage(entries, release, scales = null) {
  const pitch = entries.find((e) => e[0] === 1);
  if (scales !== null && scales.length && pitch?.[1] &&
      (pitch[1] === 2 || pitch[2] >= 2)) {
    return { engines: [], percent: null, blocked: false, warning: true,
      kind: 'not yet measured', unknown: ['Custom pitch scales'], names: 'Custom pitch scales' };
  }
  const key = profileKey(entries, release.profile);
  const isDefault = key === profileKey(defaults(release.profile), release.profile);
  const reference = release.cpu.estimate_reference;
  if ((reference && release.cpu.default_measured !== false) ||
      (!reference && release.cpu.default_measured === false)) throw new Error('CPU baseline reference is incomplete.');
  if (reference) validate(reference.profile, release.profile);
  const baselineDefault = (f) => reference ? reference.profile.find((e) => e[0] === f.id) ||
      [f.id, 0, 0, 0, 0, 0] : f.default;
  const costFeature = (f) => reference ? { ...f, default: baselineDefault(f) } : f;
  if (reference) {
    for (const engine of Object.keys(release.cpu.baselines)) {
      const differences = release.profile.features.map((f) => featureDelta(f.default, costFeature(f), engine));
      const declared = release.cpu.estimated_default_delta?.[engine];
      if (!Number.isFinite(declared) || (differences.every(Number.isFinite) &&
          Math.abs(differences.reduce((sum, delta) => sum + delta, 0) - declared) > 1e-8)) {
        throw new Error('CPU default estimate differs from its historical reference.');
      }
    }
  }
  const combination = release.cpu.combinations.find((c) => c.profile === key);
  const measured = combination || (isDefault && !reference ?
    Object.fromEntries(Object.entries(release.cpu.baselines).map(([e, b]) => [e, b.percent])) :
    null);
  const deltas = release.profile.features.map((f) => ({ feature: f,
    deltas: Object.fromEntries(Object.keys(release.cpu.baselines).map((engine) =>
      [engine, featureDelta(entries.find((e) => e[0] === f.id), costFeature(f), engine)])) }));
  // Placement does not add DSP work. Off, Fixed Off, and the same value in
  // a lighter mode stay within the default; other enabled values need a cost.
  const withinDefault = (f) => {
    const e = entries.find((e) => e[0] === f.id);
    const d = baselineDefault(f);
    return !e || e[1] === 0 || (e[1] === 1 && f.values?.[e[2]] === 'Off') ||
      (d[1] !== 0 && e[1] <= d[1] &&
        (f.amount ? e[2] <= d[2] : e[2] === d[2]));
  };
  const unknown = deltas.filter(({ feature: f, deltas }) => Object.values(deltas).some((d) => d === null) &&
    !withinDefault(f)).map(({ feature: f }) => f.name);
  if (!measured && unknown.length) {
    return { engines: [], percent: null, blocked: false, warning: false,
      kind: 'not yet measured', unknown, names: unknown.join(', ') };
  }
  const engines = Object.entries(release.cpu.baselines).map(([engine, baseline]) => {
    const hasMeasurement = Number.isFinite(measured?.[engine]);
    const percent = Math.round((hasMeasurement ? measured[engine] : baseline.percent +
        deltas.reduce((sum, f) => sum + f.deltas[engine], 0)) * 10) / 10;
    return { engine, baseline, percent, measured: hasMeasurement,
      blocked: (!isDefault || Boolean(combination)) && percent > release.cpu.ceiling - (hasMeasurement ? 0 : release.cpu.margin),
      warning: percent >= release.cpu.warning };
  });
  const withinMeasuredDefault = !reference && !measured && deltas.some((f) => Object.values(f.deltas).some((d) => d === null)) &&
    deltas.every((f) => Object.values(f.deltas).every((d) => d === null || d <= 0));
  return { engines, withinMeasuredDefault, percent: Math.max(...engines.map((e) => e.percent)),
    blocked: engines.some((e) => e.blocked), warning: engines.some((e) => e.warning),
    kind: withinMeasuredDefault ? 'within measured default' : isDefault && !combination && !reference ? 'partly measured' : engines.every((e) => e.measured) ? 'measured' : engines.some((e) => e.measured) ? 'partly measured' : 'estimated',
    names: deltas.filter((f) => Object.values(f.deltas).some((d) => d)).map((f) => f.feature.name).join(', ') || 'Release default settings' };
}

// State choices are catalogue capabilities; Fixed Off means disabled.
export const modes = (feature) => (feature.states || STATES).map((name) => [STATES.indexOf(name), name]);
const canBeOff = (feature) => modes(feature).some(([state]) => state === 0);
// An omitted entry is Off, or the default when the setting cannot be Off.
export const initialEntry = (feature) => feature.default_in_block === false || !canBeOff(feature) ?
  feature.default.slice() : [feature.id, 0, 0, 0, 0, 0];

// Bytes 8-11 carry the firmware's assigned kProfileFormat, never a date.
export function validateProfileFormat(release, source) {
  const match = /\bkProfileFormat\s*=\s*(0x[0-9a-f]+|\d+)\s*;/i.exec(source);
  if (!match || Number(match[1]) !== release.profile.format) {
    throw new Error('Profile format must match the firmware.');
  }
}
