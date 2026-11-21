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
// The region writer and profile version 3 against the blob firmware's own
// writer (blob_sections.py), parser and region reader, on synthetic blobs.
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
import { writeRegion, readRegion, regionStart, regionImage, checkWaves, blobInfo, validateRegionFirmware,
  APP_START, REGION_END, KINDS, STATUS, WAVE_ROWS, WAVE_ROW } from '../static/js/region.js';
import { draftText, readDraft, DRAFT } from '../static/js/draft.js';
import { encode } from '../static/js/encoder.js';
import { decode } from '../static/js/decoder.js';

// The phase 1 blob firmware (override with BLOB_FIRMWARE_REF).
const ref = process.env.BLOB_FIRMWARE_REF || 'affe5e61ceca48ec760f41f31c3e660be2444bb5';
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
function makeBlob(first, { abi = 2, ids = 1, size = 256 } = {}) {
  const b = new Uint8Array(size);
  const header = abi === 1 ? 64 : 96;
  for (let i = header; i < size - 4; ++i) b[i] = (i * (first + 3)) & 255;
  const words = abi === 1 ?
    [0x424d5a44, 64, 1, 1, first, size, 36, 0, 0x41, 0x59, 0x5d, size - 4, 0, 0, 0x3f6e147b, 0x3f6e147b] :
    [0x424d5a44, 96, 2, 2, 1, first, ids, size, 64, 0, 0x61, 0x79, 0x7d, size - 4, 0, 0, 0, 0, 0x3f6e147b,
      0x3f6e147b, 0, 0, 0, 0];
  words.forEach((w, i) => put32(b, 4 * i, w));
  put32(b, size - 4, crc32(b.subarray(0, size - 4)));
  return b;
}
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
assert.deepEqual(directory.map((e) => e.kind), SECTION_KINDS);
assert.deepEqual(directory.map((e) => [e.offset, e.size]), [[0, 100396], [100416, 8228], [108672, 868]]);
for (const e of directory) {
  assert.equal(u32(region, e.offset + e.size - 4), e.crc);
  assert.equal(crc32(region.subarray(e.offset, e.offset + e.size - 4)), e.crc);
}
const plts = region.subarray(directory[2].offset);
assert.deepEqual([0, 1, 2].map((i) => [plts[32 + 16 * i], plts[33 + 16 * i], u32(plts, 36 + 16 * i)]),
  [[1, 2, 96], [1, 30, 416], [1, 43, 608]], 'PLTS sorted by model ID on 32-byte offsets');
assert(plts.subarray(80, 96).every((v) => v === 255) && region.subarray(100396, 100416).every((v) => v === 255));
const good = readRegion(region, RELEASE, directory);
assert.deepEqual(good, { directory: 'ok', sections: { WAVE: 'ok', TERR: 'ok', PLTS: 'ok' }, blobs: ['ok', 'ok', 'ok'] });
assert.equal(readRegion(region, RELEASE + 1, directory).sections.TERR, 'release');
assert.equal(STATUS.length, 20);
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
for (const [word, value, status] of [[8, 4353, 'ram'], [4, 2, 'kind'], [15, 96, 'library'], [10, 0x60, 'layout']]) {
  const bad = makeBlob(5);
  put32(bad, 4 * word, value);
  put32(bad, 252, crc32(bad.subarray(0, 252)));
  assert.throws(() => writeRegion({ release: RELEASE, blobs: [bad] }), new RegExp(`model 5 is refused \\(${status}\\)`));
}
{
  const bad = makeBlob(5); bad[100] ^= 1;
  assert.throws(() => writeRegion({ release: RELEASE, blobs: [bad] }), /refused \(crc\)/);
}
for (const [row, offset] of [[0, 0], [7, 2 * 257], [192, 9]]) {
  const bad = waves.slice(); bad[(row * WAVE_ROW) * 2 + offset] ^= 1;
  assert.throws(() => checkWaves(bad), row === 192 && offset === 9 ? /guard row/ : /samples 0-3/);
}
assert.deepEqual(blobInfo(blobs[1]), { first: 2, ids: 3, size: 320, crc: u32(blobs[1], 316) });

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
  writeFileSync(join(scratch, 'terrain.bin'), terrain);
  const files = blobs.map((b, i) => { const f = join(scratch, `blob${i}.bin`); writeFileSync(f, b); return f; });
  const configurations = [[{ blobs }, files], [{ wave: factory }, ['--wave', join(scratch, 'beads/resources.cc')]],
    [{ terrain, blobs: blobs.slice(1) }, ['--terrain', join(scratch, 'terrain.bin'), ...files.slice(1)]],
    [{ wave: factory, terrain, blobs }, ['--wave', join(scratch, 'beads/resources.cc'), '--terrain',
      join(scratch, 'terrain.bin'), ...files]]];
  for (const [input, args] of configurations) {
    const out = join(scratch, 'region.bin');
    execFileSync('python3', ['-I', join(scratch, 'beads/build/tools/blob_sections.py'), out, String(RELEASE), ...args]);
    const written = writeRegion({ release: RELEASE, ...input });
    assert(equal(written.region, readFileSync(out)), `blob_sections.py agrees: ${args.join(' ')}`);
    const layout = JSON.parse(readFileSync(out + '.json', 'utf8'));
    assert.deepEqual(written.directory, layout.sections.map((s) => ({ kind: KINDS[s.kind], offset: s.offset,
      size: s.size, crc: Number(s.crc) })));
  }
  // Both writers refuse the same malformed inputs: release 0, a bad CRC, a library, IDs past 255, a shared ID.
  const badCrc = makeBlob(5); badCrc[100] ^= 1;
  const library = makeBlob(5); put32(library, 16, 2); put32(library, 252, crc32(library.subarray(0, 252)));
  for (const [release, bad] of [[0, [blobs[0]]], [RELEASE, [badCrc]], [RELEASE, [library]],
    [RELEASE, [makeBlob(255, { ids: 2 })]], [RELEASE, [makeBlob(2, { ids: 3 }), makeBlob(4)]]]) {
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
  // Each blob check: the model 2 blob changed, resealed, its entry and section CRCs updated.
  for (const [status, word, value, reblob = true] of [['header', 0, 0], ['header', 1, 64], ['abi', 2, 3],
    ['services', 3, 3], ['kind', 4, 2], ['header', 6, 0], ['library', 15, 96], ['layout', 10, 0x60],
    ['layout', 13, 318], ['ram', 8, 4353], ['ram', 9, 16385], ['crc', 50, 7, false]]) {
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
  for (const [banksCount, sections] of [[16, 0], [0, 4], [15, 3], [1, 0], [0, 0], [2, 1]]) {
    const b = encodeProfile(entries, profile, null, { banks: Array(Math.min(banksCount, 15)).fill(banks[1]),
      directory: directory.slice(0, Math.min(sections, 3)) });
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
  lines.forEach((line, i) => {
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
    if (i >= records0) return;
    const statuses = reader.split(' ').map(Number);
    const [services, dir, ...rest] = statuses;
    const named = [dir, rest[0], rest[1], rest[2]].map((s) => STATUS[s]);
    const blobStatuses = rest.slice(4).map((s) => STATUS[s]);
    assert.equal(STATUS[services], 'ok', `record ${i}: services`);
    const want = expected[i];
    const got = want[0] === 'directory' ? named : [...named.slice(1), ...blobStatuses];
    assert.deepEqual(got, want, `record ${i}: firmware statuses`);
    if (!decoded.plaits?.directory.length) return;
    const js = readRegion(records[i].bytes, records[i].release, decoded.plaits.directory);
    const jsNamed = [js.directory, js.sections.WAVE, js.sections.TERR, js.sections.PLTS];
    // Digest allowlists stay on the module; everything else must agree.
    if (want.includes('digest')) assert.deepEqual(jsNamed, ['ok', 'ok', 'ok', 'ok']);
    else assert.deepEqual([jsNamed, js.blobs], [named, blobStatuses], `record ${i}: JS reader agrees`);
  });
  console.log(`PASS ${configurations.length} writer layouts equal blob_sections.py; ${records.length} profiles and regions agree with the firmware`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log('PASS region writer, limits, profile version 3, share, draft and WAV round trip');
