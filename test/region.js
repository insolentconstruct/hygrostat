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
// The region writer, library resolver and profile version 3 against the blob
// firmware's own writer (blob_sections.py), parser and region reader, on synthetic blobs.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo } from './firmware.js';
import { defaults, encodeProfile, decodeSettings, crc32, equal, share, unshare, normalise, validatePlaits,
  regionSupport, knownModel, SECTION_KINDS } from '../static/js/profile.js';
import { writeRegion, readRegion, regionStart, regionImage, checkWaves, checkTerrains, regionSynths, checkInstallable,
  blobInfo, blobDependencies, resolveBlobs, validateRegionFirmware, APP_START, REGION_END, KINDS, STATUS, WAVE_ROWS, WAVE_ROW } from '../static/js/region.js';
import { draftText, readDraft, DRAFT } from '../static/js/draft.js';
import { encode } from '../static/js/encoder.js';
import { decode } from '../static/js/decoder.js';

// Beta 4 phase 4: Beads' wavetables in the default region (WAVE) and TERR's model flag.
const ref = process.env.BLOB_FIRMWARE_REF || 'bc830b2cd495202dd9e61183a1413e427724a44e';
const RELEASE = 20261121;
const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
assert(manifest.releases.every((r) => r.profile.region === undefined), 'no release declares a region yet');
const beta3 = manifest.releases.find((r) => r.slug === 'beta-3-smirr');
const release = structuredClone(beta3);
Object.assign(release, { tag: 'drizzlet-dev-blobs', name: 'Synthetic fixture (never offered)',
  development: true, source_commit: ref });
release.profile.region = { profile_version: 3, release: RELEASE, services_version: 2 };
const profile = release.profile;
const entries = defaults(profile);
const sha256 = (b) => createHash('sha256').update(b).digest();
const u32 = (b, at) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
const put32 = (b, at, v) => new DataView(b.buffer, b.byteOffset, b.byteLength).setUint32(at, v, true);

// Synthetic blobs pass the firmware's checks except the digest allowlist, which the oracle is given.
// A library (kind 2) has two exports after its GOT; dependencies are [id, the library blob built against].
function makeBlob(first, { abi = 2, ids = 1, kind = 1, dependencies = [], size = 256 + 36 * dependencies.length } = {}) {
  const b = new Uint8Array(size);
  const header = abi === 1 ? 64 : 96;
  for (let i = header; i < size - 4; ++i) b[i] = (i * (first + 3 + 7 * (kind - 1))) & 255;
  const list = size - 4 - 36 * dependencies.length;
  const got = list - (kind === 2 ? 8 : 0);
  const library = kind === 2;
  const words = abi === 1 ?
    [0x424d5a44, 64, 1, 1, first, size, 36, 0, 0x41, 0x59, 0x5d, size - 4, 0, 0, 0x3f6e147b, 0x3f6e147b] :
    [0x424d5a44, 96, 2, 2, kind, first, ids, size, 64, 0, 0x61, library ? got : 0x79, library ? 2 : 0x7d, got, 0,
      dependencies.length ? list : 0, dependencies.length, 0, ...(library ? [0, 0] : [0x3f6e147b, 0x3f6e147b]), 0, 0, 0, 0];
  words.forEach((w, i) => put32(b, 4 * i, w));
  if (library) [0x60, 0x80].forEach((e, i) => put32(b, got + 4 * i, e));
  dependencies.forEach(([id, built], i) => { put32(b, list + 36 * i, id); b.set(sha256(built), list + 36 * i + 4); });
  return seal(b);
}
function seal(b) {
  put32(b, b.length - 4, crc32(b.subarray(0, b.length - 4)));
  return b;
}
const makeLibrary = (id, options = {}) => makeBlob(id, { ...options, kind: 2 });
// A synth (kind 3): one ID, its RAM, three entries, a 36-byte control block and 12-sample blocks.
function makeSynth({ id = 1, size = 512, ram = 180000, words = [] } = {}) {
  const b = new Uint8Array(size);
  for (let i = 96; i < size - 4; ++i) b[i] = (i * 11) & 255;
  [0x424d5a44, 96, 2, 2, 3, id, 1, size, ram, 0, 0x61, 0x79, 0x7d, size - 4, 0, 0, 0, 0, 36, 12, 0, 0, 0, 0,
    ...words].forEach((w, i) => put32(b, 4 * i, w));
  return seal(b);
}
const synth = makeSynth();
// Rows like resources/wavetables.py: samples 256-259 repeat 0-3, row 192 repeats 191.
const waves = new Uint8Array(WAVE_ROWS * WAVE_ROW * 2);
for (let row = 0; row < WAVE_ROWS; ++row) {
  for (let j = 0; j < WAVE_ROW; ++j) {
    new DataView(waves.buffer).setInt16((row * WAVE_ROW + j) * 2, (j % 256) * 64 - 8192 + Math.min(row, 191), true);
  }
}
const terrain = Uint8Array.from({ length: 2 * 4096 }, (_, i) => (i * 3) & 255);
const blobs = [makeBlob(43), makeBlob(2, { ids: 3, size: 320 }), makeBlob(30, { abi: 1, size: 192 })];
const banks = [[0, 1, 2, 3, 4, 5, 6, 7], [28, 29, 30, 31, 32, 33, 34, 35], [8, 9, 10, 11, 12, 13, 14, 15]];

// Section layout, limits and the JS reader on a good region.
const { region, directory } = writeRegion({ release: RELEASE, wave: waves, terrain, blobs });
assert.deepEqual(directory.map((e) => e.kind), SECTION_KINDS.slice(0, 3));
assert.deepEqual(directory.map((e) => [e.offset, e.size]), [[0, 100396], [100416, 8228], [108672, 868]]);
for (const e of directory) {
  assert.equal(u32(region, e.offset + e.size - 4), e.crc);
  assert.equal(crc32(region.subarray(e.offset, e.offset + e.size - 4)), e.crc);
}
const plts = region.subarray(directory[2].offset);
assert.deepEqual([0, 1, 2].map((i) => [plts[32 + 16 * i], plts[33 + 16 * i], u32(plts, 36 + 16 * i)]),
  [[1, 2, 96], [1, 30, 416], [1, 43, 608]], 'PLTS sorted by model ID on 32-byte offsets');
assert(plts.subarray(80, 96).every((v) => v === 255) && region.subarray(100396, 100416).every((v) => v === 255));
const good = await readRegion(region, RELEASE, directory);
assert.deepEqual(good, { directory: 'ok', sections: { WAVE: 'ok', TERR: 'ok', PLTS: 'ok', RNGS: 'no region' },
  blobs: ['ok', 'ok', 'ok'] });
assert.equal((await readRegion(region, RELEASE + 1, directory)).sections.TERR, 'release');
assert.equal(STATUS.length, 21);
assert.equal(STATUS.at(-1), 'dependency');
assert.deepEqual(writeRegion({ release: RELEASE, blobs: [blobs[0]] }).directory.map((e) => e.offset), [0]);
const refusals = [
  [{ release: 0, blobs }, /release/], [{ release: RELEASE }, /at least one/],
  [{ release: RELEASE, wave: waves.subarray(2) }, /193 rows/],
  [{ release: RELEASE, terrain: new Uint8Array(0) }, /1 to 16/], [{ release: RELEASE, terrain: new Uint8Array(17 * 4096) }, /1 to 16/],
  [{ release: RELEASE, terrain: new Uint8Array(4097) }, /1 to 16/],
  [{ release: RELEASE, blobs: Array.from({ length: 129 }, (_, i) => makeBlob(i % 100)) }, /More than 128/],
  [{ release: RELEASE, blobs: [makeBlob(2, { ids: 3 }), makeBlob(4)] }, /one model ID/],
  [{ release: RELEASE, blobs: [new Uint8Array(256)] }, /Not a Plaits blob/],
  [{ release: RELEASE, blobs: [blobs[0].subarray(0, 252)] }, /size word/],
  [{ release: RELEASE, blobs: [makeBlob(255, { ids: 2 })] }, /no valid model/]];
for (const [input, message] of refusals) assert.throws(() => writeRegion(input), message);
for (const bytes of [new Uint8Array(0), new Uint8Array(17 * 4096), new Uint8Array(4097), new Int8Array(4096)]) {
  assert.throws(() => checkTerrains(bytes), { message: 'TERR must be 1 to 16 grids of 64 x 64.' });
}
for (const count of [1, 16]) assert.doesNotThrow(() => checkTerrains(new Uint8Array(count * 4096)));
const modelFlags = [[2, 2, 'ok'], [2, 3, 'ok'], [2, 4, 'header'], [2, 0x80000000, 'header'],
  [2, 6, 'header'], [1, 1, 'ok'], [1, 2, 'header']].map(([abi, flags, status]) => {
  const blob = makeBlob(5, { abi });
  put32(blob, 4 * (abi === 1 ? 13 : 17), flags);
  return { blob: seal(blob), status };
});
for (const { blob, status } of modelFlags) {
  if (status === 'ok') assert.equal(writeRegion({ release: RELEASE, blobs: [blob] }).blobs.length, 1);
  else assert.throws(() => writeRegion({ release: RELEASE, blobs: [blob] }), /refused \(header\)/);
}
for (const [word, value, status] of [[8, 4353, 'ram'], [4, 4, 'kind'], [4, 2, 'header'], [15, 96, 'layout'],
  [10, 0x60, 'layout']]) {
  const bad = makeBlob(5);
  put32(bad, 4 * word, value);
  put32(bad, 252, crc32(bad.subarray(0, 252)));
  assert.throws(() => writeRegion({ release: RELEASE, blobs: [bad] }), new RegExp(`(model|library) 5 is refused \\(${status}\\)`));
}
{
  const bad = makeBlob(5); bad[100] ^= 1;
  assert.throws(() => writeRegion({ release: RELEASE, blobs: [bad] }), /refused \(crc\)/);
}
for (const [row, offset] of [[0, 0], [7, 2 * 257], [192, 9]]) {
  const bad = waves.slice(); bad[(row * WAVE_ROW) * 2 + offset] ^= 1;
  assert.throws(() => checkWaves(bad), row === 192 && offset === 9 ? /guard row/ : /samples 0-3/);
}
assert.deepEqual(blobInfo(blobs[1]), { kind: 1, first: 2, ids: 3, size: 320, crc: u32(blobs[1], 316) });

// RNGS: the synth blob after PLTS, at offset 32 of its section; Rings only, or left out.
const full = writeRegion({ release: RELEASE, wave: waves, terrain, blobs: [synth, ...blobs] });
assert.deepEqual(full.directory.map((e) => e.kind), SECTION_KINDS);
assert(equal(full.region.subarray(0, region.length), region), 'RNGS leaves the other sections as they were');
const rngs = full.directory[3];
assert.deepEqual([rngs.offset, rngs.size], [108672 + 896, 32 + 512 + 4]);
assert(equal(full.region.subarray(rngs.offset + 32, rngs.offset + 544), synth));
assert.deepEqual([0, 4, 5].map((w) => u32(full.region, rngs.offset + 4 * w)), [0x43535a44, 548, 1]);
assert.deepEqual(full.synth, { id: 1, offset: rngs.offset + 32, size: 512 });
assert.deepEqual((await readRegion(full.region, RELEASE, full.directory)).sections,
  { WAVE: 'ok', TERR: 'ok', PLTS: 'ok', RNGS: 'ok' });
const ringsOnly = writeRegion({ release: RELEASE, blobs: [synth] });
assert.deepEqual(ringsOnly.directory.map((e) => [e.kind, e.offset]), [[KINDS.RNGS, 0]]);
assert.deepEqual([ringsOnly.blobs, writeRegion({ release: RELEASE, blobs }).synth], [[], null]);
for (const [written, synths] of [
  [writeRegion({ release: RELEASE, wave: waves }), { beads: true, plaits: false, rings: false }],
  [writeRegion({ release: RELEASE, blobs }), { beads: false, plaits: true, rings: false }],
  [ringsOnly, { beads: false, plaits: false, rings: true }],
  [writeRegion({ release: RELEASE, blobs: [makeLibrary(1)] }), { beads: false, plaits: false, rings: false }],
  [full, { beads: true, plaits: true, rings: true }]]) {
  assert.deepEqual(regionSynths(written), synths);
  if (synths.beads || synths.plaits) assert.doesNotThrow(() => checkInstallable(written));
  else assert.throws(() => checkInstallable(written),
    { message: "A setup needs Beads' wavetables or at least one Plaits model." });
}
for (const [bad, message] of [[[synth, makeSynth({ id: 2 })], /More than one synth/],
  [[synth.subarray(0, 508)], /refused \(header\)/], [[makeSynth({ id: 0 })], /refused \(header\)/],
  [[makeSynth({ ram: 262145 })], /refused \(ram\)/]]) {
  assert.throws(() => writeRegion({ release: RELEASE, blobs: bad }), message);
}
// The firmware's synth rules: [word, value, status], resealed.
const synthFaults = [[6, 2, 'header'], [9, 4, 'header'], [17, 1, 'header'], [18, 0, 'header'], [19, 0, 'header'],
  [15, 480, 'header'], [16, 1, 'header'], [8, 262144, 'ok'], [8, 262145, 'ram'], [10, 0x60, 'layout'],
  [11, 0, 'layout'], [20, 1, 'header'], [3, 3, 'services']];
const faultedSynth = (word, value) => { const b = synth.slice(); put32(b, 4 * word, value); return seal(b); };
for (const [word, value, status] of synthFaults) {
  if (status === 'ok') assert.equal(writeRegion({ release: RELEASE, blobs: [faultedSynth(word, value)] }).synth.size, 512);
  else assert.throws(() => writeRegion({ release: RELEASE, blobs: [faultedSynth(word, value)] }), new RegExp(`\\(${status}\\)`));
}

// Libraries: 1, 5 and 6 (which needs 1); models 13, 82 and 83 need them, 43 needs none.
const lib1 = makeLibrary(1);
const lib1b = makeLibrary(1, { size: 288 });
const lib5 = makeLibrary(5);
const lib6 = makeLibrary(6, { dependencies: [[1, lib1]] });
const m13 = makeBlob(13, { dependencies: [[1, lib1]] });
const m82 = makeBlob(82, { dependencies: [[1, lib1], [5, lib5], [6, lib6]] });
const m83 = makeBlob(83, { dependencies: [[5, lib5], [6, lib6]] });
const chain = [m83, lib6, m13, lib1, blobs[0], lib5, m82];
assert.deepEqual(blobDependencies(m82).map((d) => d.id), [1, 5, 6]);
assert.equal(blobDependencies(m13)[0].sha256, sha256(lib1).toString('hex'));
assert.deepEqual(blobInfo(lib6), { kind: 2, first: 6, ids: 1, size: 292, crc: u32(lib6, 288) });
{
  const written = writeRegion({ release: RELEASE, blobs: chain });
  const s = written.region;
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => [s[32 + 16 * i], s[33 + 16 * i]]),
    [[2, 1], [2, 5], [2, 6], [1, 13], [1, 43], [1, 82], [1, 83]], 'libraries first by ID, then models');
  assert.deepEqual(written.blobs.map((b) => [b.kind, b.id, b.size, b.installedWith]), [['library', 1, 256, [13, 82, 83]],
    ['library', 5, 256, [82, 83]], ['library', 6, 292, [82, 83]], ['model', 13, 292, undefined],
    ['model', 43, 256, undefined], ['model', 82, 364, undefined], ['model', 83, 328, undefined]]);
  for (const b of written.blobs) assert.equal(u32(s, b.offset + b.size - 4), u32(s, 44 + 16 * written.blobs.indexOf(b)));
  assert.deepEqual(await readRegion(s, RELEASE, written.directory),
    { directory: 'ok', sections: { WAVE: 'no region', TERR: 'no region', PLTS: 'ok', RNGS: 'no region' },
      blobs: Array(7).fill('ok') });
  // Model IDs and library IDs are apart: library 1 and model 1 share a region.
  assert.equal(writeRegion({ release: RELEASE, blobs: [lib1, makeBlob(1)] }).blobs.length, 2);
}
const nine = Array.from({ length: 9 }, (_, i) => makeLibrary(i + 1));
for (const [input, message] of [[[lib1, lib1b], /one library/], [nine, /More than 8 libraries/],
  [[makeLibrary(0)], /library 0 is refused \(header\)/], [[makeBlob(4, { dependencies: [[0, lib1]] })], /refused \(library\)/]]) {
  assert.throws(() => writeRegion({ release: RELEASE, blobs: input }), message);
}
assert.equal(writeRegion({ release: RELEASE, blobs: nine.slice(1) }).blobs.length, 8);
// The firmware's library checks (TestLibraryRefusals): [word, value, status], resealed.
const libraryFaults = [[6, 2, 'header'], [17, 1, 'header'], [18, 1, 'header'], [19, 1, 'header'], [20, 1, 'header'],
  [12, 0, 'layout'], [12, 17, 'layout'], [12, 3, 'layout'], [11, 240, 'layout'], [11, 246, 'layout'],
  [13, 248, 'layout'], [10, 0x60, 'layout'], [10, 245, 'layout'], [10, 0x61, 'ok'], [10, 0, 'ok'], [8, 65536, 'ok'],
  [8, 65537, 'ram'], [9, 16385, 'ram'], [16, 1, 'layout'], [15, 252, 'layout'], [3, 3, 'services'], [61, 0x20, 'layout'],
  [61, 244, 'layout'], [62, 0x60, 'ok']].map(([word, value, status]) => [[[word, value]], status]);
// At most 16 exports: the GOT and export table moved to 128 to make room.
const exports = (n) => [[13, 128], [11, 128], [12, n], ...Array.from({ length: n }, (_, i) => [32 + i, 0x60])];
libraryFaults.push([exports(16), 'ok'], [exports(17), 'layout']);
const faulted = (changes) => {
  const b = makeLibrary(3);
  for (const [word, value] of changes) put32(b, 4 * word, value);
  return seal(b);
};
for (const [changes, status] of libraryFaults) {
  if (status === 'ok') assert.equal(writeRegion({ release: RELEASE, blobs: [faulted(changes)] }).blobs.length, 1);
  else assert.throws(() => writeRegion({ release: RELEASE, blobs: [faulted(changes)] }), new RegExp(`\\(${status}\\)`));
}

// The region begins on the first 4 KiB boundary after the app, and must end before 0x08100000.
assert.equal(regionStart(4096), APP_START + 4096);
assert.equal(regionStart(4097), APP_START + 8192);
assert.throws(() => regionStart(REGION_END - APP_START), RangeError);
assert.throws(() => regionImage(new Uint8Array(REGION_END - APP_START - 4096), region), RangeError);

// Profile version 3: only a release declaring it takes banks and a directory.
const plaits = { banks, directory };
const block = encodeProfile(entries, profile, null, plaits);
assert.equal(block[4], 3);
assert.deepEqual([block[14], block[15]], [3, 3]);
assert.deepEqual(decodeSettings(block, profile), { entries, scales: null, plaits });
assert(equal(encodeProfile(entries, profile), encodeProfile(entries, beta3.profile)), 'version 2 bytes unchanged');
assert.deepEqual(decodeSettings(encodeProfile(entries, profile), profile), { entries, scales: null });
for (const r of manifest.releases) {
  assert.throws(() => encodeProfile(entries, r.profile, null, plaits), /cannot take Plaits banks/);
  assert.throws(() => decodeSettings(block, r.profile), /Invalid profile header/);
  assert.throws(() => unshare(share(r, block), manifest.releases), /version mismatch/);
}
const empty = encodeProfile(entries, profile, null, { banks: [], directory: [] });
assert.deepEqual(decodeSettings(empty, profile).plaits, { banks: [], directory: [] }, 'empty version 3 stays version 3');
const start = (value) => entries.map((e) => e[0] === 31 ? [31, 2, value, 0, 0, 0] : e);
assert.throws(() => encodeProfile(start(3), profile, null, plaits), /not allowed/);
assert.throws(() => encodeProfile(start(3), profile, null, { banks: [], directory }), /not allowed/);
const fiveBanks = { banks: [...banks, banks[0], banks[1]], directory };
assert.deepEqual(decodeSettings(encodeProfile(start(4), profile, null, fiveBanks), profile).entries, start(4));
assert.deepEqual(normalise(start(4), profile, 5), start(4));
assert.throws(() => normalise(start(4), profile), /not allowed/);
for (const bad of [{ banks: [[0, 1, 2, 3, 4, 5, 6, 24]], directory }, { banks: [[0, 1, 2]], directory },
  { banks: Array(16).fill(banks[0]), directory }, { banks, directory: [...directory, directory[2]] },
  { banks, directory: [directory[1], directory[0]] }, { banks, directory: [{ ...directory[0], offset: 4 }] },
  { banks, directory: [directory[0], { ...directory[1], offset: directory[0].size - 4 }] },
  { banks, directory: [{ ...directory[0], kind: 0x41414141 }] }, { banks }]) {
  assert.throws(() => validatePlaits(bad));
  assert.throws(() => encodeProfile(entries, profile, null, bad));
}
for (const meta of [null, { profile_version: 2, release: 1, services_version: 2 },
  { profile_version: 3, release: 0, services_version: 2 }, { profile_version: 3, release: 1 }]) {
  assert.throws(() => regionSupport({ ...profile, region: meta }), /region metadata/);
}
assert.equal(regionSupport(beta3.profile), null);
// Every byte of the bank table and directory reaches the module as written.
const scalesEnd = 16 + entries.length * 6;
const reseal = (b) => {
  const end = 16 + (b[6] | b[7] << 8);
  put32(b, end, crc32(b.subarray(0, end)));
  return b;
};
const unknown = block.slice(); unknown[scalesEnd + 3] = 24; reseal(unknown);
assert.throws(() => decodeSettings(unknown, profile), /Unknown Plaits model/);

// Four sections, or Rings left out: the directory says which, so a link carries it.
for (const dir of [full.directory, full.directory.slice(0, 3), [rngs]]) {
  const b = encodeProfile(entries, profile, null, { banks, directory: dir });
  assert.equal(b[15], dir.length);
  assert.deepEqual(unshare(share(release, b), [...manifest.releases, release]).plaits.directory, dir);
}

// Share links and the kept draft keep the bank table and directory byte for byte.
const releases = [...manifest.releases, release];
const shared = unshare(share(release, block), releases);
assert.equal(shared.release, release);
assert.deepEqual(shared.plaits, plaits);
assert(equal(encodeProfile(shared.entries, profile, shared.scales, shared.plaits), block));
const store = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k) => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k) };
};
for (const chosen of [block, encodeProfile(start(4), profile, null, fiveBanks)]) {
  const draft = readDraft(store({ [DRAFT]: draftText(release, chosen, 'Drizzlet', Date.UTC(2026, 10, 21)) }), releases);
  assert(!draft.refused, draft.error?.message);
  assert(equal(encodeProfile(draft.entries, profile, draft.scales, draft.plaits), chosen));
}
assert.equal(readDraft(store({ [DRAFT]: draftText(release, encodeProfile(entries, profile), 'Drizzlet', 1) }), releases).plaits, undefined);
const older = { ...beta3, tag: release.tag };
assert(readDraft(store({ [DRAFT]: draftText(release, block, 'Drizzlet', 1) }), [older]).refused,
  'older firmware refuses a version 3 draft');

// The image of app and region, with a version 3 profile, survives the WAV round trip.
const app = readFileSync(new URL('../static/' + beta3.app.replace(/\?.*/, ''), import.meta.url));
const image = regionImage(app, region);
image.set(block, profile.offset);
assert.equal(image.length, regionStart(app.length) - APP_START + region.length);
assert(image.subarray(app.length, regionStart(app.length) - APP_START).every((v) => v === 255));
assert(equal(decode(encode(image), image.length), image), 'image WAV decodes byte for byte');

// The pinned firmware: its writer, catalogue, parser and region reader.
if (spawnSync('git', ['-C', firmwareRepo, 'cat-file', '-e', `${ref}^{commit}`]).status !== 0) {
  throw new Error(`FIRMWARE_REPO lacks the blob firmware ${ref}; it needs the firmware branches.`);
}
const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-region-'));
try {
  execFileSync('tar', ['-x', '-C', scratch], { input: execFileSync('git', ['-C', firmwareRepo, 'archive', ref,
    'beads/blob', 'beads/build', 'beads/dsp', 'beads/profile.cc', 'beads/profile.h', 'beads/plaits_resources.cc',
    'beads/resources.cc', 'plaits'], { maxBuffer: 1 << 28 }) });
  const source = (file) => readFileSync(join(scratch, file), 'utf8');
  const catalogue = JSON.parse(source('beads/build/profile-features.json'));
  assert.deepEqual(catalogue.plaits_models.filter((m) => [13, 82, 83].includes(m.id)).map((m) => m.libraries),
    [[1], [1, 5, 6], [1, 5, 6]], 'the synthetic chain follows the catalogue');
  const models = new Set(catalogue.plaits_models.map((m) => m.id));
  for (let id = 0; id < 256; ++id) assert.equal(knownModel(id), models.has(id), `model ${id}`);
  const sources = { profileHeader: source('beads/profile.h'), catalog: source('beads/blob/plaits_catalog.cc'),
    blobHeader: source('beads/blob/plaits_blob.h') };
  validateRegionFirmware(profile.region, sources);
  for (const changed of [{ release: RELEASE + 1 }, { services_version: 1 }, { profile_version: 2 }]) {
    assert.throws(() => validateRegionFirmware({ ...profile.region, ...changed }, sources), /match the firmware/);
  }

  // Byte agreement with beads/build/tools/blob_sections.py, factory WAVE included.
  const text = source('beads/resources.cc');
  const table = text.slice(text.indexOf('const int16_t wav_integrated_waves[] = {'));
  const values = table.slice(0, table.indexOf('};')).match(/-?\d+/g).slice(1).map(Number);
  const factory = new Uint8Array(values.length * 2);
  values.forEach((v, i) => new DataView(factory.buffer).setInt16(2 * i, v, true));
  const defaultWave = /\{\s*kPlaitsSectionWave, (\d+), (\d+),\s*\{([^}]*)\}/
    .exec(sources.catalog.split('kPlaitsDefaultLayout[] = {')[1].split('};')[0]);
  assert(defaultWave, 'the default layout includes factory WAVE');
  const factoryWritten = writeRegion({ release: RELEASE, wave: factory });
  const waveEntry = factoryWritten.directory.find((e) => e.kind === KINDS.WAVE);
  const waveSection = factoryWritten.region.subarray(waveEntry.offset, waveEntry.offset + waveEntry.size);
  assert.equal(waveSection.length, Number(defaultWave[2]), 'factory WAVE size matches the default layout');
  assert.equal(sha256(waveSection).toString('hex'),
    defaultWave[3].match(/0x[0-9a-f]{2}/g).map((h) => h.slice(2)).join(''),
    'factory WAVE digest matches the default layout');
  writeFileSync(join(scratch, 'terrain.bin'), terrain);
  const files = blobs.map((b, i) => { const f = join(scratch, `blob${i}.bin`); writeFileSync(f, b); return f; });
  const chainFiles = chain.map((b, i) => { const f = join(scratch, `chain${i}.bin`); writeFileSync(f, b); return f; });
  const synthFile = join(scratch, 'synth.bin');
  writeFileSync(synthFile, synth);
  const configurations = [[{ blobs }, files], [{ wave: factory }, ['--wave', join(scratch, 'beads/resources.cc')]],
    [{ terrain, blobs: blobs.slice(1) }, ['--terrain', join(scratch, 'terrain.bin'), ...files.slice(1)]],
    [{ wave: factory, terrain, blobs }, ['--wave', join(scratch, 'beads/resources.cc'), '--terrain',
      join(scratch, 'terrain.bin'), ...files]], [{ blobs: chain }, chainFiles],
    [{ wave: factory, terrain, blobs: [...chain, blobs[1]] }, ['--wave', join(scratch, 'beads/resources.cc'),
      '--terrain', join(scratch, 'terrain.bin'), ...chainFiles, files[1]]],
    [{ blobs: [synth] }, [synthFile]], [{ blobs: [...blobs, synth] }, [synthFile, ...files]],
    [{ wave: factory, terrain, blobs: [synth, ...chain] }, ['--wave', join(scratch, 'beads/resources.cc'),
      '--terrain', join(scratch, 'terrain.bin'), ...chainFiles, synthFile]]];
  for (const [input, args] of configurations) {
    const out = join(scratch, 'region.bin');
    execFileSync('python3', ['-I', join(scratch, 'beads/build/tools/blob_sections.py'), out, String(RELEASE), ...args]);
    const written = writeRegion({ release: RELEASE, ...input });
    assert(equal(written.region, readFileSync(out)), `blob_sections.py agrees: ${args.join(' ')}`);
    const layout = JSON.parse(readFileSync(out + '.json', 'utf8'));
    assert.deepEqual(written.directory, layout.sections.map((s) => ({ kind: KINDS[s.kind], offset: s.offset,
      size: s.size, crc: Number(s.crc) })));
    const plts = layout.sections.find((s) => s.kind === 'PLTS');
    assert.deepEqual(written.blobs.map((b) => [b.kind, b.id, b.offset, b.size]), (plts?.blobs ?? []).map((b) =>
      [b.library === undefined ? 'model' : 'library', b.library ?? b.model, plts.offset + b.offset, b.size]));
    const rings = layout.sections.find((s) => s.kind === 'RNGS');
    assert.deepEqual(written.synth, rings ? { id: rings.blobs[0].synth, offset: rings.offset + rings.blobs[0].offset,
      size: rings.blobs[0].size } : null);
  }
  // Both writers refuse the same malformed inputs: release 0, a bad CRC, a library ID 0, IDs past 255, a
  // shared model or library ID, nine libraries.
  const badCrc = makeBlob(5); badCrc[100] ^= 1;
  for (const [release, bad] of [[0, [blobs[0]]], [RELEASE, [badCrc]], [RELEASE, [makeLibrary(0)]],
    [RELEASE, [makeBlob(255, { ids: 2 })]], [RELEASE, [makeBlob(2, { ids: 3 }), makeBlob(4)]], [RELEASE, [lib1, lib1b]],
    [RELEASE, nine], [RELEASE, [synth, makeSynth({ id: 2 })]], [RELEASE, [synth.map((v, i) => i === 100 ? v ^ 1 : v)]]]) {
    const paths = bad.map((b, i) => { const f = join(scratch, `bad${i}.bin`); writeFileSync(f, b); return f; });
    const python = spawnSync('python3', ['-I', join(scratch, 'beads/build/tools/blob_sections.py'),
      join(scratch, 'bad.bin'), String(release), ...paths], { encoding: 'utf8' });
    assert.notEqual(python.status, 0, `blob_sections.py refuses ${python.stderr}`);
    assert.throws(() => writeRegion({ release, blobs: bad }));
  }

  // The firmware's parser and region reader, compiled from the pinned sources.
  const oracle = join(scratch, 'region-oracle');
  execFileSync('g++', ['-DTEST', '-DPLAITS_BLOBS', '-O1', '-Wall', '-Werror', '-Wno-unused-local-typedefs',
    '-I' + scratch, '-I' + firmwareRepo, fileURLToPath(new URL('region_oracle.cc', import.meta.url)),
    ...['beads/blob/plaits_region.cc', 'beads/blob/plaits_blob.cc', 'beads/profile.cc', 'beads/plaits_resources.cc']
      .map((f) => join(scratch, f)), join(firmwareRepo, 'stmlib/dsp/units.cc'), '-o', oracle]);
  const word = (v) => { const b = new Uint8Array(4); put32(b, 0, v); return b; };
  const records = [];
  const profileRecord = (b) => records.push({ input: [word(1), b] });
  const regionRecord = (b, bytes, { digests = blobs, release = RELEASE } = {}) =>
    records.push({ input: [word(2), b, word(release), word(digests.length), ...digests.map(sha256),
      word(bytes.length), bytes], bytes, block: b, release });
  // A profile with words changed after encoding, resealed: what a damaged or foreign block would hold.
  const raw = (dir, b = block) => {
    const c = b.slice();
    const bytes = scalesEnd - 16 + c[14] * 8 + dir.length * 16;
    [c[6], c[7], c[15]] = [bytes & 255, bytes >> 8, dir.length];
    dir.forEach((e, i) => ['kind', 'offset', 'size', 'crc'].forEach((k, j) =>
      put32(c, scalesEnd + c[14] * 8 + i * 16 + j * 4, e[k])));
    return reseal(c);
  };
  const OK3 = ['ok', 'ok', 'ok'];
  const resealSection = (bytes, i) => {
    const e = directory[i];
    const crc = crc32(bytes.subarray(e.offset, e.offset + e.size - 4));
    put32(bytes, e.offset + e.size - 4, crc);
    return directory.map((d, k) => k === i ? { ...d, crc } : d);
  };
  const padded = new Uint8Array(region.length + 4096).fill(255);
  padded.set(region);
  const expected = [];
  const expect = (statuses) => expected.push(statuses);
  regionRecord(block, padded); expect(['ok', 'ok', 'ok', ...OK3]);
  { const b = padded.slice(); b[directory[1].offset + 100] ^= 1; regionRecord(block, b); }
  expect(['ok', 'crc', 'ok', ...OK3]);
  regionRecord(raw(directory.map((e, i) => i ? e : { ...e, crc: e.crc ^ 1 })), padded); expect(['selection', 'ok', 'ok', ...OK3]);
  regionRecord(raw(directory.map((e, i) => i === 1 ? { ...e, offset: e.offset + 4 } : e)), padded);
  expect(['directory', 'directory', 'directory', 'directory']);
  regionRecord(raw(directory.map((e, i) => i === 2 ? { ...e, offset: directory[1].offset } : e)), padded);
  expect(['directory', 'directory', 'directory', 'directory']);
  regionRecord(raw(directory.map((e, i) => i === 2 ? { ...e, offset: Math.floor((padded.length - 1024) / 32) * 32, size: 2048 } : e)), padded);
  expect(['directory', 'directory', 'directory', 'directory']);
  { const b = padded.slice(); b[32 + 192 * WAVE_ROW * 2 + 20] ^= 1; regionRecord(raw(resealSection(b, 0)), b); }
  expect(['content', 'ok', 'ok', ...OK3]);
  { const b = padded.slice(); put32(b, 20, 192); regionRecord(raw(resealSection(b, 0)), b); }
  expect(['content', 'ok', 'ok', ...OK3]);
  { const b = padded.slice(); put32(b, directory[1].offset + 20, 3); regionRecord(raw(resealSection(b, 1)), b); }
  expect(['ok', 'content', 'ok', ...OK3]);
  { const b = padded.slice(); b[directory[2].offset + 32 + 16 + 1] = 31; regionRecord(raw(resealSection(b, 2)), b); }
  expect(['ok', 'ok', 'model', 'ok', 'model', 'ok']);
  // Entry IDs must strictly ascend: a repeated ID refuses the table before any blob is read.
  for (const id of [2, 1]) {
    const b = padded.slice(); b[directory[2].offset + 32 + 16 + 1] = id; regionRecord(raw(resealSection(b, 2)), b);
    expect(['ok', 'ok', 'table']);
  }
  { const b = padded.slice(); put32(b, directory[2].offset + 32 + 16 + 4, 400); regionRecord(raw(resealSection(b, 2)), b); }
  expect(['ok', 'ok', 'table']);
  { const b = padded.slice(); put32(b, directory[2].offset + 8, 2); regionRecord(raw(resealSection(b, 2)), b); }
  expect(['ok', 'ok', 'header']);
  regionRecord(block, padded, { release: RELEASE + 1 }); expect(['release', 'release', 'release']);
  regionRecord(raw([directory[0], { ...directory[2], offset: Math.ceil(region.length / 32) * 32 + 32, size: 64 }]), padded);
  expect(['ok', 'no region', 'no region']);
  regionRecord(block, padded, { digests: blobs.slice(1) }); expect(['ok', 'ok', 'digest', 'ok', 'ok', 'digest']);
  records.at(-1).allowlist = true;
  // Each blob check: the model 2 blob changed, resealed, its entry and section CRCs updated.
  for (const [status, word, value, reblob = true] of [['header', 0, 0], ['header', 1, 64], ['abi', 2, 3],
    ['services', 3, 3], ['kind', 4, 4], ['header', 4, 2], ['header', 6, 0], ['layout', 15, 96], ['layout', 10, 0x60],
    ['layout', 13, 318], ['ram', 8, 4353], ['ram', 9, 16385], ['digest', 50, 7, false]]) {
    const b = padded.slice();
    const at = directory[2].offset + 96;
    put32(b, at + 4 * word, value);
    if (reblob) put32(b, at + 316, crc32(b.subarray(at, at + 316)));
    put32(b, directory[2].offset + 32 + 12, u32(b, at + 316));
    regionRecord(raw(resealSection(b, 2)), b);
    expect(['ok', 'ok', status, status, 'ok', 'ok']);
  }
  // No directory entries: the firmware reads the release's default layout instead.
  regionRecord(encodeProfile(entries, profile, null, { banks, directory: [] }), padded);
  expect(['no region', 'no region', 'no region']);
  // PLTS alone, its entries in the order given; kinds[i] is entry i's kind.
  const pltsRegion = (list, kinds = list.map((b) => blobInfo(b).kind)) => {
    let offset = 32 + 16 * list.length;
    const places = list.map((b) => { offset = Math.ceil(offset / 32) * 32; offset += b.length; return offset - b.length; });
    const s = new Uint8Array(offset + 4).fill(255);
    [0x43535a44, KINDS.PLTS, 1, RELEASE, s.length, list.length, 0, 0].forEach((w, i) => put32(s, 4 * i, w));
    list.forEach((b, i) => {
      [kinds[i] | blobInfo(b).first << 8, places[i], b.length, u32(b, b.length - 4)].forEach((w, k) => put32(s, 32 + 16 * i + 4 * k, w));
      s.set(b, places[i]);
    });
    return seal(s);
  };
  const pltsRecord = (list, statuses, { kinds, digests = list } = {}) => {
    const s = pltsRegion(list, kinds);
    const dir = [{ kind: KINDS.PLTS, offset: 0, size: s.length, crc: u32(s, s.length - 4) }];
    regionRecord(encodeProfile(entries, profile, null, { banks, directory: dir }), s, { digests });
    records.at(-1).allowlist = digests !== list;
    expect(['no region', 'no region', statuses.find((x) => x !== 'ok') ?? 'ok', ...statuses]);
    return s;
  };
  for (const { blob, status } of modelFlags) pltsRecord([blob], [status]);
  const sortedChain = [lib1, lib5, lib6, m13, blobs[0], m82, m83];
  assert(equal(pltsRecord(sortedChain, Array(7).fill('ok')), writeRegion({ release: RELEASE, blobs: chain }).region),
    'the JS writer lays libraries out as the module reads them');
  pltsRecord([m13, blobs[0]], ['dependency', 'ok']);
  pltsRecord([lib1b, m13], ['ok', 'dependency']);
  pltsRecord([lib1, makeBlob(13, { dependencies: [[2, lib1]] })], ['ok', 'dependency']);
  pltsRecord([lib1, lib6, makeBlob(90, { dependencies: [[6, lib6], [1, lib1]] })], ['ok', 'ok', 'ok']);
  pltsRecord([lib1, lib6, makeBlob(90, { dependencies: [[6, makeLibrary(6)]] })], ['ok', 'ok', 'dependency']);
  pltsRecord([lib1, makeBlob(2, { ids: 3, dependencies: [[1, lib1]] })], ['ok', 'ok']);
  // A refused library refuses its users: here it is missing from the digest allowlist.
  pltsRecord([lib1, m13], ['digest', 'dependency'], { digests: [m13] });
  // A cycle, a later library, the library itself: a library needs only libraries before it.
  const lib5c = makeLibrary(5, { dependencies: [[2, makeLibrary(2)]] });
  pltsRecord([makeLibrary(2, { dependencies: [[5, lib5c]] }), lib5c], ['dependency', 'dependency']);
  pltsRecord([makeLibrary(2, { dependencies: [[5, lib5]] }), lib5], ['dependency', 'ok']);
  pltsRecord([makeLibrary(3, { dependencies: [[3, makeLibrary(3)]] })], ['dependency']);
  // Table rules: libraries first, at most eight; an entry's kind must be its blob's.
  pltsRecord([blobs[0], lib1], []);
  expected[expected.length - 1] = ['no region', 'no region', 'table'];
  pltsRecord(nine, []);
  expected[expected.length - 1] = ['no region', 'no region', 'table'];
  pltsRecord(nine.slice(1), Array(8).fill('ok'));
  pltsRecord([lib1, m13, blobs[0]], ['ok', 'kind', 'ok'], { kinds: [2, 2, 1] });
  pltsRecord([lib1, makeBlob(1)], ['ok', 'ok']);
  pltsRecord([lib1, makeBlob(4, { dependencies: [[0, lib1]] })], ['ok', 'library']);
  for (const [changes, status] of libraryFaults) pltsRecord([faulted(changes)], [status]);
  pltsRecord([faulted([[5, 0]])], []);
  expected[expected.length - 1] = ['no region', 'no region', 'table'];
  // RNGS after PLTS, and RNGS alone: [statuses of WAVE, TERR, PLTS, then the RNGS status].
  {
    const four = new Uint8Array(full.region.length + 4096).fill(255);
    four.set(full.region);
    regionRecord(encodeProfile(entries, profile, null, { banks, directory: full.directory }), four, { digests: [...blobs, synth] });
    expect(['ok', 'ok', 'ok', ...OK3]);
    records.at(-1).rngs = 'ok';
    regionRecord(encodeProfile(entries, profile, null, { banks, directory: full.directory }), four);
    expect(['ok', 'ok', 'ok', ...OK3]);
    Object.assign(records.at(-1), { rngs: 'digest', allowlist: 'RNGS' });
  }
  // A section holding blob (or raw payload words) with count; the directory names it alone.
  const ringsRecord = (payload, status, { count = 1, digests = [synth] } = {}) => {
    const s = new Uint8Array(32 + payload.length + 4);
    [0x43535a44, KINDS.RNGS, 1, RELEASE, s.length, count, 0, 0].forEach((w, i) => put32(s, 4 * i, w));
    s.set(payload, 32);
    seal(s);
    const dir = [{ kind: KINDS.RNGS, offset: 0, size: s.length, crc: u32(s, s.length - 4) }];
    regionRecord(encodeProfile(entries, profile, null, { banks, directory: dir }), s, { digests });
    expect(['no region', 'no region', 'no region']);
    records.at(-1).rngs = status;
  };
  ringsRecord(synth, 'ok');
  ringsRecord(synth, 'table', { count: 2 });
  ringsRecord(synth, 'table', { count: 0 });
  ringsRecord(blobs[0], 'kind', { digests: [blobs[0]] });
  ringsRecord(lib1, 'kind', { digests: [lib1] });
  { const p = new Uint8Array(516).fill(255); p.set(synth); ringsRecord(p, 'table'); }
  ringsRecord(synth.subarray(0, 508), 'header', { digests: [synth.subarray(0, 508)] });
  ringsRecord(synth.map((v, i) => i === 200 ? v ^ 1 : v), 'digest');
  for (const [word, value, status] of synthFaults) {
    const b = faultedSynth(word, value);
    ringsRecord(b, status, { digests: [b] });
  }
  const records0 = records.length;
  // Profile refusals: unknown model, start bank past the bank count, counts past their limits.
  profileRecord(block);
  profileRecord(unknown);
  for (const [value, b] of [[2, null], [3, null], [3, plaits], [4, fiveBanks], [5, fiveBanks]]) {
    const chosen = encodeProfile(start(Math.min(value, 2)), profile, null, b);
    const pos = 16 + entries.findIndex((e) => e[0] === 31) * 6 + 2;
    chosen[pos] = value;
    profileRecord(reseal(chosen));
  }
  for (const [banksCount, sections] of [[16, 0], [0, 5], [15, 4], [1, 0], [0, 0], [2, 1]]) {
    const b = encodeProfile(entries, profile, null, { banks: Array(Math.min(banksCount, 15)).fill(banks[1]),
      directory: full.directory.slice(0, Math.min(sections, 4)) });
    b[14] = banksCount; b[15] = sections;
    if (banksCount === 16) b.set(banks[1], scalesEnd + 15 * 8);
    const bytes = scalesEnd - 16 + banksCount * 8 + sections * 16;
    b[6] = bytes & 255; b[7] = bytes >> 8;
    profileRecord(reseal(b));
  }
  { const b = block.slice(); b[4] = 2; profileRecord(reseal(b)); }
  profileRecord(encodeProfile(entries, profile));
  for (let offset = scalesEnd; offset < scalesEnd + 3 * 8 + 3 * 16; ++offset) {
    for (const value of [0, 23, 24, 28, 99, 100, 255]) {
      const b = block.slice(); b[offset] = value; profileRecord(reseal(b));
    }
  }

  const lines = execFileSync(oracle, [], { input: Buffer.concat(records.flatMap((r) => r.input.map((b) => Buffer.from(b)))),
    maxBuffer: 1 << 26 }).toString().trim().split('\n');
  assert.equal(lines.length, records.length);
  for (const [i, line] of lines.entries()) {
    const [parsed, reader] = line.split(' | ');
    const words = parsed.split(' ').map(Number);
    const accepted = words[0] === 1;
    const nb = words[1];
    const fwBanks = Array.from({ length: nb }, (_, k) => words.slice(2 + k * 8, 10 + k * 8));
    const ns = words[2 + nb * 8];
    const fwDirectory = Array.from({ length: ns }, (_, k) => {
      const [kind, offset, size, crc] = words.slice(3 + nb * 8 + k * 4, 7 + nb * 8 + k * 4);
      return { kind, offset, size, crc };
    });
    const fwEntries = words.slice(3 + nb * 8 + ns * 4);
    const b = records[i].input[1];
    let decoded;
    try { decoded = decodeSettings(b, profile); } catch { decoded = null; }
    assert.equal(accepted, decoded !== null, `record ${i}: acceptance`);
    if (decoded) {
      assert.deepEqual(fwBanks, decoded.plaits?.banks.length ? decoded.plaits.banks :
        [[8, 9, 10, 11, 12, 13, 14, 15], [16, 17, 18, 19, 20, 21, 22, 23], [0, 1, 2, 3, 4, 5, 6, 7]], `record ${i}: banks`);
      assert.deepEqual(fwDirectory, decoded.plaits?.directory ?? [], `record ${i}: directory`);
      for (const e of decoded.entries) assert.deepEqual(fwEntries.slice((e[0] - 1) * 6, e[0] * 6), e, `record ${i}: entry`);
    }
    if (i >= records0) continue;
    const statuses = reader.split(' ').map(Number);
    const [services, dir, ...rest] = statuses;
    const named = [dir, rest[0], rest[1], rest[2], rest[3]].map((s) => STATUS[s]);
    const blobStatuses = rest.slice(5).map((s) => STATUS[s]);
    assert.equal(STATUS[services], 'ok', `record ${i}: services`);
    const want = expected[i];
    const got = want[0] === 'directory' ? named.slice(0, 4) : [...named.slice(1, 4), ...blobStatuses];
    assert.deepEqual(got, want, `record ${i}: firmware statuses`);
    assert.equal(named[4], want[0] === 'directory' ? 'directory' : records[i].rngs ?? 'no region', `record ${i}: RNGS`);
    if (!decoded.plaits?.directory.length) continue;
    const js = await readRegion(records[i].bytes, records[i].release, decoded.plaits.directory);
    const jsNamed = [js.directory, js.sections.WAVE, js.sections.TERR, js.sections.PLTS, js.sections.RNGS];
    // A valid blob missing from the digest allowlist is refused only on the module.
    if (records[i].allowlist === 'RNGS') assert.deepEqual([...jsNamed.slice(0, 4), 'ok'], [...named.slice(0, 4), js.sections.RNGS]);
    else if (records[i].allowlist) assert.deepEqual([...jsNamed.slice(0, 3), 'ok', jsNamed[4]], [...named.slice(0, 3), js.sections.PLTS, named[4]]);
    else assert.deepEqual([jsNamed, js.blobs], [named, blobStatuses], `record ${i}: JS reader agrees`);
  }
  console.log(`PASS ${configurations.length} writer layouts equal blob_sections.py; ${records.length} profiles and regions agree with the firmware`);

  // The resolver: each model's libraries, transitively and by digest, counted and cross-checked with the catalogue.
  const available = [lib1b, lib1, lib5, lib6, makeLibrary(2)];
  const resolved = await resolveBlobs([m82, m13], available, catalogue);
  assert.deepEqual(resolved.blobs, [lib1, lib5, lib6, m82, m13]);
  assert.deepEqual(resolved.libraries.map((l) => [l.id, l.models, l.count, l.sha256 === sha256(l.blob).toString('hex')]),
    [[1, [82, 13], 2, true], [5, [82], 1, true], [6, [82], 1, true]]);
  const installed = writeRegion({ release: RELEASE, blobs: resolved.blobs });
  assert.deepEqual((await readRegion(installed.region, RELEASE, installed.directory)).blobs, Array(5).fill('ok'));
  // Library 1 comes with library 6, which model 83 names; each library leaves with its last user.
  assert.deepEqual((await resolveBlobs([m83], available, catalogue)).blobs, [lib1, lib5, lib6, m83]);
  assert.deepEqual((await resolveBlobs([m13], available, catalogue)).libraries.map((l) => [l.id, l.count]), [[1, 1]]);
  assert.deepEqual(await resolveBlobs([], available, catalogue), { blobs: [], libraries: [] });
  assert.deepEqual((await resolveBlobs([blobs[0]], available, catalogue)).blobs, [blobs[0]]);
  for (const [models, libraries, message] of [[[m13], [lib5], /needs the missing library 1/],
    [[m13], [lib1b], /Model 13 needs another build of library 1/], [[m83], [lib5, lib6], /Library 6 needs the missing library 1/],
    [[m13, makeBlob(5, { dependencies: [[1, lib1b]] })], [lib1, lib1b], /different builds of library 1/],
    [[makeBlob(30, { dependencies: [[2, makeLibrary(2, { dependencies: [[5, lib5]] })]] })],
      [lib5, makeLibrary(2, { dependencies: [[5, lib5]] })], /Library 2 needs library 5, which comes after it/],
    [[lib1], [lib1], /model blob is refused \(kind\)/], [[m13], [m13], /library blob is refused \(kind\)/],
    [[makeBlob(14, { dependencies: [[1, lib1]] })], [lib1], /Model 14's libraries differ from the catalogue's/],
    [[makeBlob(2, { ids: 3 })], [], /Model 2's libraries differ/]]) {
    await assert.rejects(resolveBlobs(models, libraries, catalogue), message);
  }
  // Without the catalogue only the blobs' own records count.
  assert.equal((await resolveBlobs([makeBlob(14, { dependencies: [[1, lib1]] })], [lib1])).libraries.length, 1);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log('PASS region writer, limits, profile version 3, share, draft and WAV round trip');
