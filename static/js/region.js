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
// The region after the app (firmware beads/blob/plaits_region.h): WAVE, TERR
// and PLTS sections, written as beads/build/tools/blob_sections.py does.
import { crc32, SECTION_KINDS, MIN_SECTION_SIZE } from './profile.js?v=6af54c48c8b913e6';

export const APP_START = 0x08020000;
export const REGION_END = 0x08100000;
export const SECTION_MAGIC = 0x43535a44;
export const KINDS = { WAVE: SECTION_KINDS[0], TERR: SECTION_KINDS[1], PLTS: SECTION_KINDS[2] };
export const WAVE_ROWS = 193;
export const WAVE_ROW = 260;
export const TERRAIN_SIZE = 64 * 64;
export const MAX_TERRAINS = 16;
export const MAX_BLOBS = 128;
const ALIGNMENT = 32;
const HEADER = 32;
const BLOB_MAGIC = 0x424d5a44;
const BLOB_HEADER_SIZES = [0, 64, 96];
// PlaitsBlobStatus, in the firmware's order.
export const STATUS = ['ok', 'placement', 'header', 'abi', 'services', 'layout', 'ram', 'crc', 'digest', 'imports',
  'no region', 'release', 'selection', 'table', 'model', 'kind', 'library', 'content', 'directory'];

const align = (n) => Math.ceil(n / ALIGNMENT) * ALIGNMENT;
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const equalBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// The region starts on the first 4 KiB boundary after the app (beads/build/blobs.ld).
export function regionStart(appSize) {
  const start = APP_START + Math.ceil(appSize / 4096) * 4096;
  if (!Number.isInteger(appSize) || appSize < 1 || start >= REGION_END) throw new RangeError('No room for a region.');
  return start;
}

// The app, erased flash up to the region, then the region: what an update writes.
export function regionImage(app, region) {
  const offset = regionStart(app.length) - APP_START;
  if (offset + region.length > REGION_END - APP_START) throw new RangeError('The region does not fit before 0x08100000.');
  const image = new Uint8Array(offset + region.length).fill(0xff);
  image.set(app);
  image.set(region, offset);
  return image;
}

// Rows repeat samples 0-3 as 256-259, and the guard row repeats the last wave.
export function checkWaves(waves) {
  const row = WAVE_ROW * 2;
  if (!(waves instanceof Uint8Array) || waves.length !== WAVE_ROWS * row) {
    throw new Error(`WAVE must be ${WAVE_ROWS} rows of ${WAVE_ROW} samples.`);
  }
  for (let i = 0; i < WAVE_ROWS; ++i) {
    if (!equalBytes(waves.subarray(i * row, i * row + 8), waves.subarray((i + 1) * row - 8, (i + 1) * row))) {
      throw new Error(`WAVE row ${i}: samples 0-3 differ from 256-259.`);
    }
  }
  if (!equalBytes(waves.subarray(-row), waves.subarray(-2 * row, -row))) {
    throw new Error('WAVE guard row differs from the last wave.');
  }
}

function section(kind, release, count, payload) {
  const size = HEADER + payload.length + 4;
  const s = new Uint8Array(size);
  const v = view(s);
  [SECTION_MAGIC, KINDS[kind], 1, release, size, count, 0, 0].forEach((word, i) => v.setUint32(4 * i, word, true));
  s.set(payload, HEADER);
  v.setUint32(size - 4, crc32(s.subarray(0, size - 4)), true);
  return s;
}

// A blob's model IDs and size from its version 1 or 2 header; the module checks the rest.
export function blobInfo(blob) {
  const v = blob instanceof Uint8Array && blob.length >= 64 ? view(blob) : null;
  const abi = v?.getUint32(8, true);
  if (!v || v.getUint32(0, true) !== BLOB_MAGIC || ![1, 2].includes(abi) ||
      v.getUint32(4, true) !== BLOB_HEADER_SIZES[abi] || blob.length < BLOB_HEADER_SIZES[abi] + 4) {
    throw new Error('Not a Plaits blob.');
  }
  const first = v.getUint32(abi === 1 ? 16 : 20, true);
  const ids = abi === 1 ? 1 : v.getUint32(24, true);
  if (v.getUint32(abi === 1 ? 20 : 28, true) !== blob.length || blob.length % 4) {
    throw new Error("A blob's size word does not match its file.");
  }
  if (!ids || first + ids > 256) throw new Error('A blob serves no valid model IDs.');
  return { first, ids, size: blob.length, crc: v.getUint32(blob.length - 4, true) };
}

// Blobs sorted by model ID, each on a 32-byte boundary after the entry table.
function plaits(release, blobs) {
  if (blobs.length > MAX_BLOBS) throw new Error(`More than ${MAX_BLOBS} blobs.`);
  const sorted = blobs.map((blob) => ({ blob, info: blobInfo(blob) })).sort((a, b) => a.info.first - b.info.first);
  for (const { blob, info } of sorted) {
    const status = checkBlob(blob);
    if (status !== 'ok') throw new Error(`The blob for model ${info.first} is refused (${status}).`);
  }
  sorted.forEach(({ info }, i) => {
    if (i && info.first < sorted[i - 1].info.first + sorted[i - 1].info.ids) throw new Error('Two blobs serve one model ID.');
  });
  let offset = HEADER + 16 * sorted.length;
  const places = sorted.map(({ info }) => {
    offset = align(offset);
    const at = offset;
    offset += info.size;
    return at;
  });
  const payload = new Uint8Array(offset - HEADER).fill(0xff);
  const v = view(payload);
  sorted.forEach(({ blob, info }, i) => {
    v.setUint32(16 * i, 1 | info.first << 8, true);
    [places[i], info.size, info.crc].forEach((word, k) => v.setUint32(16 * i + 4 + 4 * k, word, true));
    payload.set(blob, places[i] - HEADER);
  });
  return section('PLTS', release, sorted.length, payload);
}

// The region and its profile directory; wave is 193 rows of int16 LE, terrain 1-16 64 x 64 grids.
export function writeRegion({ release, wave = null, terrain = null, blobs = [] }) {
  if (!Number.isInteger(release) || release < 1 || release > 0xffffffff) throw new Error('Invalid region release.');
  const sections = [];
  if (wave !== null) {
    checkWaves(wave);
    sections.push(section('WAVE', release, WAVE_ROWS, wave));
  }
  if (terrain !== null) {
    const count = terrain.length / TERRAIN_SIZE;
    if (!(terrain instanceof Uint8Array) || !Number.isInteger(count) || count < 1 || count > MAX_TERRAINS) {
      throw new Error('TERR must be 1 to 16 grids of 64 x 64.');
    }
    sections.push(section('TERR', release, count, terrain));
  }
  if (!Array.isArray(blobs)) throw new Error('Blobs must be a list.');
  if (blobs.length) sections.push(plaits(release, blobs));
  if (!sections.length) throw new Error('A region needs at least one section.');
  const directory = [];
  let size = 0;
  for (const s of sections) {
    const offset = align(size);
    directory.push({ kind: view(s).getUint32(4, true), offset, size: s.length, crc: view(s).getUint32(s.length - 4, true) });
    size = offset + s.length;
  }
  const region = new Uint8Array(size).fill(0xff);
  sections.forEach((s, i) => region.set(s, directory[i].offset));
  return { region, directory };
}

// The firmware's PlaitsBlob::Check without services, digest and import checks, which stay on the module.
function checkBlob(blob) {
  if (blob.length < 64) return 'placement';
  const v = view(blob);
  const abi = v.getUint32(8, true);
  if (v.getUint32(0, true) !== BLOB_MAGIC) return 'header';
  if (abi !== 1 && abi !== 2) return 'abi';
  const word = (i) => v.getUint32(4 * i, true);
  const h = abi === 1 ? { header: word(1), services: word(3), kind: 1, first: word(4), ids: 1, size: word(5),
    state: word(6), arena: word(7), entries: [word(8), word(9), word(10)], got: word(11), gotSize: word(12),
    reserved: 0, dependencies: 0 } :
    blob.length < 96 ? null : { header: word(1), services: word(3), kind: word(4), first: word(5), ids: word(6),
      size: word(7), state: word(8), arena: word(9), entries: [word(10), word(11), word(12)], got: word(13),
      gotSize: word(14), reserved: word(20) | word(21) | word(22) | word(23), dependencies: word(15) | word(16) };
  if (!h || h.header !== BLOB_HEADER_SIZES[abi]) return 'header';
  if (h.size % 4 || h.size > blob.length || h.size < h.header + 4) return 'header';
  if (!h.services || h.services > 2 || (abi === 1 && h.services !== 1)) return 'services';
  if (h.kind !== 1) return 'kind';
  if (!h.ids || h.first >= 256 || h.ids > 256 - h.first || h.reserved) return 'header';
  if (h.dependencies) return 'library';
  const crcAt = h.size - 4;
  if (h.got % 4 || h.gotSize % 4 || h.got > crcAt || h.gotSize > crcAt - h.got ||
      !h.entries.every((e) => (e & 1) && e >= h.header && e < h.got)) return 'layout';
  if (h.state > (abi === 1 ? 256 : 4352) || h.arena > 16384) return 'ram';
  if (crc32(blob.subarray(0, crcAt)) !== v.getUint32(crcAt, true)) return 'crc';
  return 'ok';
}

function readBlobs(data, count) {
  const v = view(data);
  const crcAt = data.length - 4;
  if (count > MAX_BLOBS || count * 16 > crcAt - HEADER) return { status: 'table', blobs: [] };
  const entries = Array.from({ length: count }, (_, i) => ({ kind: data[HEADER + 16 * i], id: data[HEADER + 16 * i + 1],
    reserved: v.getUint16(HEADER + 16 * i + 2, true), offset: v.getUint32(HEADER + 16 * i + 4, true),
    size: v.getUint32(HEADER + 16 * i + 8, true), crc: v.getUint32(HEADER + 16 * i + 12, true) }));
  let next = HEADER + count * 16;
  for (const e of entries) {
    if (e.kind === 2) return { status: 'library', blobs: [] };
    if (e.kind !== 1 || e.reserved || e.offset % ALIGNMENT || e.offset < next || e.offset > crcAt ||
        e.size > crcAt - e.offset) return { status: 'table', blobs: [] };
    next = e.offset + e.size;
  }
  const served = new Set();
  const blobs = entries.map((e) => {
    const blob = data.subarray(e.offset, e.offset + e.size);
    let status = checkBlob(blob);
    if (status !== 'ok') return status;
    const info = view(blob);
    const abi = info.getUint32(8, true);
    const first = info.getUint32(abi === 1 ? 16 : 20, true);
    const ids = abi === 1 ? 1 : info.getUint32(24, true);
    if (info.getUint32(abi === 1 ? 20 : 28, true) !== e.size || info.getUint32(e.size - 4, true) !== e.crc) status = 'table';
    else if (first !== e.id) status = 'model';
    for (let id = first; status === 'ok' && id < first + ids; ++id) {
      if (served.has(id)) status = 'table';
      served.add(id);
    }
    return status;
  });
  return { status: blobs.find((s) => s !== 'ok') ?? 'ok', blobs };
}

function readSection(index, data, release, expectedCrc) {
  const v = view(data);
  const word = (i) => v.getUint32(4 * i, true);
  if (word(0) === 0xffffffff) return { status: 'no region' };
  if (word(0) !== SECTION_MAGIC || word(1) !== SECTION_KINDS[index] || word(2) !== 1 || word(6) || word(7)) {
    return { status: 'header' };
  }
  if (word(3) !== release) return { status: 'release' };
  if (word(4) !== data.length || data.length % 4) return { status: 'header' };
  const crc = crc32(data.subarray(0, data.length - 4));
  if (crc !== v.getUint32(data.length - 4, true)) return { status: 'crc' };
  if (crc !== expectedCrc) return { status: 'selection' };
  const count = word(5);
  const payload = data.length - MIN_SECTION_SIZE;
  if (index === 0) {
    try { checkWaves(data.subarray(HEADER, -4)); } catch { return { status: 'content' }; }
    return { status: count === WAVE_ROWS ? 'ok' : 'content' };
  }
  if (index === 1) {
    return { status: count && count <= MAX_TERRAINS && payload === count * TERRAIN_SIZE ? 'ok' : 'content' };
  }
  return readBlobs(data, count);
}

// Checks region (the bytes from the region start) against a profile directory, as
// PlaitsRegion::Read does: { directory, sections: { WAVE, TERR, PLTS }, blobs } statuses.
export function readRegion(region, release, directory) {
  if (!(region instanceof Uint8Array) || !Array.isArray(directory) || !directory.length) {
    throw new Error('Without a directory the module reads the release default layout, which this does not check.');
  }
  const result = { directory: 'ok', sections: { WAVE: 'no region', TERR: 'no region', PLTS: 'no region' }, blobs: [] };
  const room = region.length;
  let ok = directory.length <= SECTION_KINDS.length;
  let next = 0, previous = -1;
  for (const { kind, offset, size } of ok ? directory : []) {
    const index = SECTION_KINDS.indexOf(kind);
    ok = ok && index > previous && offset % ALIGNMENT === 0 && offset >= next && offset <= room &&
      size <= room - offset && size >= MIN_SECTION_SIZE;
    previous = index;
    next = offset + size;
  }
  if (!ok) return { directory: 'directory', sections: { WAVE: 'directory', TERR: 'directory', PLTS: 'directory' }, blobs: [] };
  for (const { kind, offset, size, crc } of directory) {
    const index = SECTION_KINDS.indexOf(kind);
    const read = readSection(index, region.subarray(offset, offset + size), release, crc);
    result.sections[Object.keys(KINDS)[index]] = read.status;
    if (read.blobs) result.blobs = read.blobs;
  }
  return result;
}

// The manifest's region fields must match the firmware: profile version 3,
// kPlaitsBlobRelease and the services table version.
export function validateRegionFirmware(region, { profileHeader, catalog, blobHeader }) {
  const constant = (source, name) => Number(new RegExp(`\\b${name}\\s*=\\s*(0x[0-9a-f]+|\\d+)\\s*;`, 'i').exec(source)?.[1]);
  if (region?.profile_version !== constant(profileHeader, 'kProfileVersionBlobs') ||
      region.release !== constant(catalog, 'kPlaitsBlobRelease') ||
      region.services_version !== constant(blobHeader, 'kPlaitsBlobServicesVersion2')) {
    throw new Error('Region metadata must match the firmware.');
  }
}
