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
import { SCALE_RECORD_SIZE, validateScales, readScales, writeScales, effectiveScales } from './scales.js?v=42689801d3309e72';

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

// Options page LED masks (FEEDBACK 1, DRY/WET 2, REVERB 4), one per page.
// Releases without page_leds have Beta 2's four pages, the last lighting all three.
export const PAGE_LEDS = [[1, 2, 4, 7], [1, 2, 4, 3, 5, 6, 7]];
export function pageLeds(profile) {
  const leds = profile.page_leds === undefined ? PAGE_LEDS[0] : profile.page_leds;
  const known = PAGE_LEDS.find((candidate) => Array.isArray(leds) && equal(candidate, leds));
  if (!known) throw new Error('Unsupported options page layout.');
  return known.slice();
}
export const pageSlots = (profile) => pageLeds(profile).length * 3;

// Firmware with feedback_slot (Beta 4 on) has [A] + FEEDBACK as amount slot 3,
// which manual gain (feature 40) keeps while that feature is Off.
export const GAIN = 40;
export const FEEDBACK_SLOT = 3;
export const amountSlots = (profile) => profile.feedback_slot === true ? 3 : 2;
const gainMoved = (entries) => entries.some((e) => e[0] === GAIN && e[1]);

// Exact resonator values (Fixed only) replace a page control: { exact ID: page ID }.
// When every exact value for a page feature is Fixed, it goes Fixed at its value, off its page.
export const EXACT_REPLACES = { 45: 43, 46: 43, 47: 44 };
export function exactPageRule(entries, profile) {
  const has = (id) => profile.features.some((f) => f.id === id);
  const fixed = (id) => entries.some((e) => e[0] === Number(id) && e[1] === 1);
  const replaced = new Set(Object.values(EXACT_REPLACES).filter((page) => has(page) &&
    Object.entries(EXACT_REPLACES).every(([id, target]) => target !== page || (has(Number(id)) && fixed(id)))));
  return normalise(entries.map((e) => replaced.has(e[0]) && e[1] === 2 ? [e[0], 1, e[2], 0, 0, 0] : e.slice()), profile);
}

// Profile version 3 (blob firmware) adds Plaits banks of 8 model IDs and the
// region directory; only a release whose profile.region declares it takes one.
export const PLAITS_BANK = 31;
export const BANK_SIZE = 8;
export const MAX_BANKS = 15;
export const MAX_SECTIONS = 4;
// Section kinds in their required order: WAVE, TERR, PLTS, RNGS.
export const SECTION_KINDS = [0x45564157, 0x52524554, 0x53544c50, 0x53474e52];
export const SECTION_NAMES = ['WAVE', 'TERR', 'PLTS', 'RNGS'];
export const MIN_SECTION_SIZE = 36;
// profile-features.json plaits_models: 0-23 stock, 28-99 Palette; 24-27 never assigned.
export const knownModel = (id) => Number.isInteger(id) && ((id >= 0 && id < 24) || (id >= 28 && id <= 99));
const u32 = (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
// default_layout (optional): the sections the release reads without a directory, as plaits_catalog.cc lists them.
export function regionSupport(profile) {
  const region = profile.region;
  if (region === undefined) return null;
  const layout = region?.default_layout;
  if (region?.profile_version !== 3 || profile.version !== 2 || !u32(region.release) || !region.release ||
      !Number.isInteger(region.services_version) || region.services_version < 1 ||
      (layout !== undefined && !validLayout(layout))) {
    throw new Error('Unsupported region metadata.');
  }
  return region;
}
const validLayout = (layout) => Array.isArray(layout) && layout.length <= MAX_SECTIONS && layout.every((e, i) =>
  SECTION_NAMES.includes(e?.kind) && u32(e.offset) && u32(e.size) && /^[0-9a-f]{64}$/.test(e.sha256) &&
  (!i || SECTION_NAMES.indexOf(e.kind) > SECTION_NAMES.indexOf(layout[i - 1].kind)));

// Banks the writer accepts, and a directory the module's region reader can lay out.
export function validatePlaits(plaits) {
  const { banks, directory } = plaits ?? {};
  if (!Array.isArray(banks) || banks.length > MAX_BANKS ||
      banks.some((bank) => !Array.isArray(bank) || bank.length !== BANK_SIZE || !bank.every(knownModel))) {
    throw new Error('Plaits banks need up to 15 banks of 8 known model IDs.');
  }
  if (!Array.isArray(directory) || directory.length > MAX_SECTIONS ||
      directory.some((e) => !e || !['kind', 'offset', 'size', 'crc'].every((k) => u32(e[k])))) {
    throw new Error('The region directory needs up to 4 sections.');
  }
  let previous = -1, next = 0;
  for (const { kind, offset, size } of directory) {
    const index = SECTION_KINDS.indexOf(kind);
    if (index <= previous || offset % 32 || offset < next || size < MIN_SECTION_SIZE || size % 4) {
      throw new Error('Region sections must be WAVE, TERR, PLTS, RNGS in order, aligned and apart.');
    }
    previous = index;
    next = offset + size;
  }
  return { banks: banks.map((bank) => bank.slice()),
    directory: directory.map(({ kind, offset, size, crc }) => ({ kind, offset, size, crc })) };
}
// The start bank must be below a version 3 profile's bank count; 0 banks means the stock three.
const valueCount = (f, banks) => f.id === PLAITS_BANK && banks ? banks : f.values.length;

// Firmware with hold_rules refuses an adjustable Synth start without its
// gesture, and anything else on the [A] hold (3), which restarts automatic gain.
export function validate(entries, profile, banks = 0) {
  const holdRules = profile.hold_rules === true;
  const slots = pageSlots(profile);
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
    if (state > 2 || (f.states && !f.states.includes(STATES[state])) || (f.values && value >= valueCount(f, banks)) ||
        page > slots || amount > amountSlots(profile) || action > 3 ||
        (page && (!f.page || state !== 2)) ||
        (amount && (!f.amount || state !== 2)) ||
        (action && (!f.action || !state || (state === 1 && (!value || !f.stateless)))) ||
        (id === 9 && state === 1 && value && !action) ||
        (id >= 15 && state === 2 && !f.page && f.field == null && f.saved == null && !amount) ||
        (holdRules && ((id === 9 && state === 2 && !action) || (action === 3 && id !== 9))) ||
        (id === SYNTH && action === 2)) {
      throw new Error(`${f.name}: this setting or placement is not allowed.`);
    }
    [page, amount, action].forEach((slot, k) => {
      if (slot && used[k].has(slot)) throw new Error(`${f.name}: control already used.`);
      if (slot) used[k].add(slot);
    });
  }
  if (profile.feedback_slot === true && used[1].has(FEEDBACK_SLOT) && !gainMoved(entries)) {
    throw new Error('[A] + FEEDBACK has manual gain: move it or take it off the knobs first.');
  }
  return entries;
}

// Beta 4 [A] gestures: a toggle on [A] + SEED or [A] + FREEZE, anything on
// [A] + FEEDBACK, or manual gain moved. Earlier firmware refuses them.
export const TOGGLES = [2, 4, 6, 7, 23];
// Plaits play keeps [A] + FREEZE for its bank, so the Synth toggle goes on [A] + SEED.
export const SYNTH = 7;
// Synth values (feature 7), as the firmware's synth_choice.h; their meanings never change.
export const SYNTHS = ['Beads', 'Plaits', 'Rings'];
// What an install plays: Beads with its wavetables (compiled in until they move to WAVE), Plaits with PLTS, Rings with RNGS.
export const playableSynths = (kinds, wavesInApp = true) =>
  [wavesInApp || kinds.includes('WAVE'), kinds.includes('PLTS'), kinds.includes('RNGS')];
// The section names an install has: its directory's, or the release default layout's without one (null if unknown).
export function installedKinds(profile, directory) {
  if (directory.length) return directory.map((e) => SECTION_NAMES[SECTION_KINDS.indexOf(e.kind)]);
  return regionSupport(profile)?.default_layout?.map((e) => e.kind) ?? null;
}
// The Synth values an install offers, in value order, as [value, name].
export const synthValues = (feature, playable) =>
  feature.values.map((name, value) => [value, name]).filter(([value]) => playable[value] === true);
// The values a list offers: Synth only the synths the release's default region plays, any other feature all.
export function offeredValues(feature, profile) {
  const kinds = feature.id === SYNTH && regionSupport(profile) && installedKinds(profile, []);
  return kinds ? synthValues(feature, playableSynths(kinds)).map(([value]) => value) : feature.values.map((_, value) => value);
}
// EffectiveSynth: the selection if playable, else Beads, else Plaits, else 3 (silent); a fallback never picks Rings.
export const effectiveSynth = (value, playable) => playable[value] ? value : playable[0] ? 0 : playable[1] ? 1 : 3;
// NextSynth: a Synth action steps over synths the install cannot play.
export function nextSynth(value, playable) {
  for (let i = 1; i <= SYNTHS.length; ++i) {
    if (playable[(value + i) % SYNTHS.length]) return (value + i) % SYNTHS.length;
  }
  return value;
}
// At least one synth (Rings alone arises only from a fault), and a Synth value the install lacks is refused, never mapped.
export function checkSynths(entries, playable) {
  if (!playable[0] && !playable[1]) throw new Error('Keep the Beads wavetables or the Plaits models: at least one synth must be installed.');
  const synth = entries.find((e) => e[0] === SYNTH);
  const value = synth?.[1] ? synth[2] : 0;
  if (!playable[value]) throw new Error(`Synth: ${SYNTHS[value]} is not installed. Choose another synth, or add it back.`);
}
export const newGestures = (entries) => entries.some((e) => e[4] === FEEDBACK_SLOT ||
  (e[0] === GAIN && e[1]) || (e[5] && TOGGLES.includes(e[0])));
export const gestureFirmware = (entries) => newGestures(entries) ?
  'These [A] gestures need Drizzlet Beta 4 or later; earlier firmware refuses them.' : '';

function validatePitchDefault(entries, scales) {
  const pitch = entries.find((e) => e[0] === 1);
  if (pitch && pitch[2] >= 2 && !effectiveScales(scales).some((scale) => scale.id === pitch[2])) {
    throw new Error('The pitch starting value must be present in the scale bank.');
  }
}

const validFormat = (format) => Number.isInteger(format) && format > 0 && format <= 0xffffffff;

// plaits ({ banks, directory }) writes version 3; null keeps the release's own version.
export function encodeProfile(entries, profile, scales = null, plaits = null) {
  if (plaits !== null && !regionSupport(profile)) {
    throw new Error('This release cannot take Plaits banks or a region: its firmware would refuse the profile.');
  }
  const blobs = plaits === null ? null : validatePlaits(plaits);
  validate(entries, profile, blobs?.banks.length);
  // A version 2 profile on blob firmware reads the default layout too.
  const kinds = regionSupport(profile) && installedKinds(profile, blobs?.directory ?? []);
  if (kinds) checkSynths(entries, playableSynths(kinds));
  const version = profile.version || 1;
  if (![1, 2].includes(version) || profile.size !== (version === 2 ? 4096 : 512) ||
      !validFormat(profile.format)) throw new Error('Unsupported profile format.');
  if (version === 1 && scales !== null) throw new Error('This release cannot customize scales.');
  const bank = validateScales(scales);
  validatePitchDefault(entries, bank);
  const scalesEnd = 16 + entries.length * 6 + (bank?.length || 0) * SCALE_RECORD_SIZE;
  const end = scalesEnd + (blobs ? blobs.banks.length * BANK_SIZE + blobs.directory.length * 16 : 0);
  const b = new Uint8Array(profile.size).fill(255);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x46505a44, true);
  b[4] = blobs ? 3 : version;
  b[5] = entries.length;
  v.setUint16(6, end - 16, true);
  v.setUint32(8, profile.format, true);
  v.setUint32(12, 0, true);
  if (version === 2) { b[12] = bank === null ? 0 : 1; b[13] = bank?.length || 0; }
  if (blobs) { b[14] = blobs.banks.length; b[15] = blobs.directory.length; }
  entries.forEach((e, i) => b.set(e, 16 + i * 6));
  if (bank) writeScales(b, 16 + entries.length * 6, bank);
  if (blobs) {
    const at = scalesEnd + blobs.banks.length * BANK_SIZE;
    blobs.banks.forEach((ids, i) => b.set(ids, scalesEnd + i * BANK_SIZE));
    blobs.directory.forEach((e, i) => ['kind', 'offset', 'size', 'crc'].forEach((k, j) =>
      v.setUint32(at + i * 16 + j * 4, e[k], true)));
  }
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
  const blobs = version === 3 && regionSupport(profile) !== null;
  const compatible = version === profile.version || (profile.version === 2 && version === 1) || blobs;
  const limit = version === 1 ? 512 : b.length;
  const count = b[5];
  const custom = version >= 2 ? b[12] : 0;
  const scaleCount = version >= 2 ? b[13] : 0;
  const bankCount = blobs ? b[14] : 0;
  const sectionCount = blobs ? b[15] : 0;
  const scalesEnd = 16 + count * 6 + scaleCount * SCALE_RECORD_SIZE;
  const end = scalesEnd + bankCount * BANK_SIZE + sectionCount * 16;
  if (count > 82 || scaleCount > 14 || bankCount > MAX_BANKS || sectionCount > MAX_SECTIONS ||
      custom > 1 || (!custom && scaleCount) ||
      end + 4 > limit || v.getUint16(6, true) !== end - 16 ||
      v.getUint32(0, true) !== 0x46505a44 || !compatible ||
      !validFormat(profile.format) || v.getUint32(8, true) !== profile.format || (!blobs && (b[14] || b[15])) ||
      (version === 1 && v.getUint32(12, true) !== 0) ||
      v.getUint32(end, true) !== crc32(b.subarray(0, end))) {
    throw new Error('Invalid profile header or checksum.');
  }
  const scales = custom ? readScales(b, 16 + count * 6, scaleCount) : null;
  const banks = Array.from({ length: bankCount }, (_, i) =>
    Array.from(b.subarray(scalesEnd + i * BANK_SIZE, scalesEnd + (i + 1) * BANK_SIZE)));
  if (!banks.every((ids) => ids.every(knownModel))) throw new Error('Unknown Plaits model in a bank.');
  const entries = validate(Array.from({ length: count }, (_, i) =>
    Array.from(b.subarray(16 + i * 6, 22 + i * 6))), profile, bankCount);
  validatePitchDefault(entries, scales);
  if (!blobs) return { entries, scales };
  // The firmware keeps any directory here; its region reader checks the layout.
  const at = scalesEnd + bankCount * BANK_SIZE;
  const directory = Array.from({ length: sectionCount }, (_, i) => {
    const [kind, offset, size, crc] = [0, 4, 8, 12].map((k) => v.getUint32(at + i * 16 + k, true));
    return { kind, offset, size, crc };
  });
  return { entries, scales, plaits: { banks, directory } };
}

export const decodeProfile = (b, profile) => decodeSettings(b, profile).entries;
export const decodeScaleBank = (b, profile) => decodeSettings(b, profile).scales;

export const defaults = (profile) => profile.features.filter((f) => f.default_in_block !== false).map((f) => f.default.slice());
// Canonical editor entries: omitted catalogue defaults stay absent when Off.
// Keep the codec lossless for independently supplied firmware blocks.
// Manual gain on [A] + FEEDBACK is its Off state, as stock.
export function normalise(entries, profile, banks = 0) {
  validate(entries, profile, banks);
  return entries.map((e) => e[0] === GAIN && e[1] === 2 && e[4] === FEEDBACK_SLOT ? [GAIN, 0, 0, 0, 0, 0] : e)
    .filter((e) => e[1] !== 0 || profile.features.find((f) => f.id === e[0]).default_in_block !== false)
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
  return { wav: `${release.tag}${suffix}.wav`, comboHex: `${release.tag}${suffix}-combo.hex`, comboBin: `${release.tag}${suffix}-combo.bin`,
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
  const version = block[4] === 3 && regionSupport(release.profile) ? 3 : release.profile.version;
  if (header.getUint32(0, true) === 0x46505a44 &&
      (block[4] !== version || header.getUint32(8, true) !== release.profile.format)) {
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
