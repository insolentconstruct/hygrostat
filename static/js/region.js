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
import { crc32, sha256, SECTION_KINDS, MIN_SECTION_SIZE } from './profile.js?v=d62286caca2e468b';

export const APP_START = 0x08020000;
export const REGION_END = 0x08100000;
export const SECTION_MAGIC = 0x43535a44;
export const KINDS = { WAVE: SECTION_KINDS[0], TERR: SECTION_KINDS[1], PLTS: SECTION_KINDS[2] };
export const WAVE_ROWS = 193;
export const WAVE_ROW = 260;
export const TERRAIN_SIZE = 64 * 64;
export const MAX_TERRAINS = 16;
export const MAX_BLOBS = 128;
export const MAX_LIBRARIES = 8;
const ALIGNMENT = 32;
const HEADER = 32;
const BLOB_MAGIC = 0x424d5a44;
const BLOB_HEADER_SIZES = [0, 64, 96];
const MODEL = 1;
const LIBRARY = 2;
const MAX_EXPORTS = 16;
const MAX_DEPENDENCIES = 4;
const DEPENDENCY_SIZE = 36;
// PlaitsBlobStatus, in the firmware's order; 'ecc' (a flash double error) happens only on the module.
export const STATUS = ['ok', 'placement', 'header', 'abi', 'services', 'layout', 'ram', 'crc', 'digest', 'imports',
  'no region', 'release', 'selection', 'table', 'model', 'kind', 'library', 'content', 'directory', 'ecc', 'dependency'];

const align = (n) => Math.ceil(n / ALIGNMENT) * ALIGNMENT;
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const equalBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hex = (b) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
const isLibrary = (info) => info.kind === LIBRARY;

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

// A blob's kind, model or library IDs and size from its version 1 or 2 header; the module checks the rest.
export function blobInfo(blob) {
  const v = blob instanceof Uint8Array && blob.length >= 64 ? view(blob) : null;
  const abi = v?.getUint32(8, true);
  if (!v || v.getUint32(0, true) !== BLOB_MAGIC || ![1, 2].includes(abi) ||
      v.getUint32(4, true) !== BLOB_HEADER_SIZES[abi] || blob.length < BLOB_HEADER_SIZES[abi] + 4) {
    throw new Error('Not a Plaits blob.');
  }
  const kind = abi === 1 ? MODEL : v.getUint32(16, true);
  const first = v.getUint32(abi === 1 ? 16 : 20, true);
  const ids = abi === 1 ? 1 : v.getUint32(24, true);
  if (v.getUint32(abi === 1 ? 20 : 28, true) !== blob.length || blob.length % 4) {
    throw new Error("A blob's size word does not match its file.");
  }
  if (!ids || first + ids > 256) throw new Error('A blob serves no valid model IDs.');
  return { kind, first, ids, size: blob.length, crc: v.getUint32(blob.length - 4, true) };
}

// The libraries a checked blob needs: each one's ID and the SHA-256 (hex) of the build it names.
export function blobDependencies(blob) {
  const status = checkBlob(blob);
  if (status !== 'ok') throw new Error(`The blob is refused (${status}).`);
  const h = readHeader(blob, view(blob).getUint32(8, true));
  return Array.from({ length: h.dependencyCount }, (_, i) => {
    const at = h.dependencies + i * DEPENDENCY_SIZE;
    return { id: view(blob).getUint32(at, true), sha256: hex(blob.subarray(at + 4, at + DEPENDENCY_SIZE)) };
  });
}

// Libraries by ID, then models by ID, each on a 32-byte boundary after the entry table.
function plaits(release, blobs) {
  if (blobs.length > MAX_BLOBS) throw new Error(`More than ${MAX_BLOBS} blobs.`);
  const sorted = blobs.map((blob) => ({ blob, info: blobInfo(blob) }))
    .sort((a, b) => isLibrary(b.info) - isLibrary(a.info) || a.info.first - b.info.first);
  for (const { blob, info } of sorted) {
    const status = checkBlob(blob);
    const name = isLibrary(info) ? 'library' : 'model';
    if (status !== 'ok') throw new Error(`The blob for ${name} ${info.first} is refused (${status}).`);
  }
  const libraries = sorted.filter(({ info }) => isLibrary(info)).length;
  if (libraries > MAX_LIBRARIES) throw new Error(`More than ${MAX_LIBRARIES} libraries.`);
  sorted.forEach(({ info }, i) => {
    const previous = sorted[i - 1]?.info;
    if (i && i < libraries && info.first === previous.first) throw new Error('Two blobs are one library.');
    if (i > libraries && info.first < previous.first + previous.ids) throw new Error('Two blobs serve one model ID.');
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
    v.setUint32(16 * i, info.kind | info.first << 8, true);
    [places[i], info.size, info.crc].forEach((word, k) => v.setUint32(16 * i + 4 + 4 * k, word, true));
    payload.set(blob, places[i] - HEADER);
  });
  return { section: section('PLTS', release, sorted.length, payload), blobs: placed(sorted, places) };
}

// What each blob takes in the section; a library lists the models it is installed with, directly or through others.
function placed(sorted, places) {
  const needs = new Map(sorted.filter(({ info }) => isLibrary(info))
    .map(({ blob, info }) => [info.first, blobDependencies(blob).map((d) => d.id)]));
  // Only libraries before a library count, as on the module; a cycle never resolves.
  const closure = (ids, below = 256) => ids.filter((id) => id < below)
    .flatMap((id) => [id, ...closure(needs.get(id) ?? [], id)]);
  const users = sorted.filter(({ info }) => !isLibrary(info))
    .map(({ blob, info }) => ({ model: info.first, libraries: closure(blobDependencies(blob).map((d) => d.id)) }));
  return sorted.map(({ info }, i) => isLibrary(info) ?
    { kind: 'library', id: info.first, offset: places[i], size: info.size,
      installedWith: users.filter((u) => u.libraries.includes(info.first)).map((u) => u.model) } :
    { kind: 'model', id: info.first, ids: info.ids, offset: places[i], size: info.size });
}

// The blobs to write for a selection of model blobs: each one's libraries, transitively, the exact builds its
// dependency records name; reference counts per library; the catalogue's model libraries cross-checked.
export async function resolveBlobs(models, available, catalogue = null) {
  const describe = async (blob, kind) => {
    const info = blobInfo(blob);
    const status = checkBlob(blob);
    if (status !== 'ok' || info.kind !== kind) {
      throw new Error(`A ${kind === LIBRARY ? 'library' : 'model'} blob is refused (${status === 'ok' ? 'kind' : status}).`);
    }
    return { blob, info, sha256: await sha256(blob), dependencies: blobDependencies(blob) };
  };
  const builds = await Promise.all(available.map((blob) => describe(blob, LIBRARY)));
  const selected = await Promise.all(models.map((blob) => describe(blob, MODEL)));
  const chosen = new Map();
  // Each dependency names one build; a library may need only libraries before it in the table (lower IDs).
  const resolve = (dependencies, user, below = 256) => dependencies.flatMap(({ id, sha256: digest }) => {
    const build = builds.find((b) => b.info.first === id && b.sha256 === digest);
    if (!build) {
      const other = builds.some((b) => b.info.first === id);
      throw new Error(`${user} needs ${other ? 'another build of' : 'the missing'} library ${id}.`);
    }
    if (id >= below) throw new Error(`${user} needs library ${id}, which comes after it.`);
    if (chosen.has(id) && chosen.get(id) !== build) throw new Error(`Two blobs need different builds of library ${id}.`);
    chosen.set(id, build);
    return [id, ...resolve(build.dependencies, `Library ${id}`, id)];
  });
  const users = selected.map(({ info, dependencies }) => ({ model: info.first, ids: info.ids,
    libraries: new Set(resolve(dependencies, `Model ${info.first}`)) }));
  // The catalogue lists a model's libraries; the libraries those need come with them.
  const closure = (ids) => ids.flatMap((id) => [id, ...closure(chosen.get(id)?.dependencies.map((d) => d.id) ?? [])]);
  for (const { model, ids, libraries } of catalogue ? users : []) {
    for (let id = model; id < model + ids; ++id) {
      const listed = catalogue.plaits_models.find((m) => m.id === id)?.libraries;
      const expected = new Set(closure(listed ?? []));
      if (listed && (expected.size !== libraries.size || ![...expected].every((l) => libraries.has(l)))) {
        throw new Error(`Model ${id}'s libraries differ from the catalogue's.`);
      }
    }
  }
  const libraries = [...chosen.keys()].sort((a, b) => a - b).map((id) => {
    const models = users.filter((u) => u.libraries.has(id)).map((u) => u.model);
    return { id, sha256: chosen.get(id).sha256, models, count: models.length, blob: chosen.get(id).blob };
  });
  return { blobs: [...libraries.map((l) => l.blob), ...models], libraries };
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
  const plts = blobs.length ? plaits(release, blobs) : null;
  if (plts) sections.push(plts.section);
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
  // Byte sizes for a flash meter: sections in the directory, blobs from the region start.
  const at = plts ? directory.at(-1).offset : 0;
  return { region, directory, blobs: plts ? plts.blobs.map((b) => ({ ...b, offset: at + b.offset })) : [] };
}

// Either header version, widened to version 2's fields as the firmware's ReadHeader does.
function readHeader(blob, abi) {
  const v = view(blob);
  const word = (i) => v.getUint32(4 * i, true);
  if (abi === 1) {
    return { header: word(1), services: word(3), kind: MODEL, first: word(4), ids: 1, size: word(5), state: word(6),
      arena: word(7), init: word(8), reset: word(9), render: word(10), got: word(11), gotSize: word(12),
      dependencies: 0, dependencyCount: 0, zero: 0, reserved: 0 };
  }
  return blob.length < 96 ? null : { header: word(1), services: word(3), kind: word(4), first: word(5), ids: word(6),
    size: word(7), state: word(8), arena: word(9), init: word(10), reset: word(11), render: word(12), got: word(13),
    gotSize: word(14), dependencies: word(15), dependencyCount: word(16), zero: word(17) | word(18) | word(19),
    reserved: word(20) | word(21) | word(22) | word(23) };
}

// The firmware's PlaitsBlob::Check without services, digest and import checks, which stay on the module.
function checkBlob(blob) {
  if (blob.length < 64) return 'placement';
  const v = view(blob);
  const abi = v.getUint32(8, true);
  if (v.getUint32(0, true) !== BLOB_MAGIC) return 'header';
  if (abi !== 1 && abi !== 2) return 'abi';
  const h = readHeader(blob, abi);
  if (!h || h.header !== BLOB_HEADER_SIZES[abi]) return 'header';
  if (h.size % 4 || h.size > blob.length || h.size < h.header + 4) return 'header';
  if (!h.services || h.services > 2 || (abi === 1 && h.services !== 1)) return 'services';
  const library = h.kind === LIBRARY;
  if (h.kind !== MODEL && !library) return 'kind';
  // A library has one nonzero ID, and no flags or gains.
  if (!h.ids || h.first >= 256 || h.ids > 256 - h.first || (library && (h.ids !== 1 || !h.first || h.zero)) ||
      h.reserved) return 'header';
  const crcAt = h.size - 4;
  const gotEnd = h.got + h.gotSize;
  if (h.got % 4 || h.gotSize % 4 || h.got > crcAt || h.gotSize > crcAt - h.got) return 'layout';
  const inCode = (e) => (e & 1) === 1 && e >= h.header && e < h.got;
  let next = gotEnd;
  if (library) {
    // reset and render hold the export table and its count.
    const [table, count] = [h.reset, h.render];
    if (!count || count > MAX_EXPORTS || table % 4 || table < gotEnd || table > crcAt ||
        count > Math.floor((crcAt - table) / 4) || (h.init && !inCode(h.init))) return 'layout';
    for (let i = 0; i < count; ++i) {
      const e = v.getUint32(table + 4 * i, true);
      if (e < h.header || e >= h.got) return 'layout';
    }
    next = table + 4 * count;
  } else if (![h.init, h.reset, h.render].every(inCode)) {
    return 'layout';
  }
  // The dependency list ends at the CRC; IDs are libraries' (nonzero).
  const n = h.dependencyCount;
  if (n > MAX_DEPENDENCIES || (!n && h.dependencies) || (n && (h.dependencies < next || h.dependencies % 4 ||
      h.dependencies > crcAt || crcAt - h.dependencies !== n * DEPENDENCY_SIZE))) return 'layout';
  for (let i = 0; i < n; ++i) {
    const id = v.getUint32(h.dependencies + i * DEPENDENCY_SIZE, true);
    if (!id || id >= 256) return 'library';
  }
  if (h.state > (library ? 65536 : abi === 1 ? 256 : 4352) || h.arena > 16384) return 'ram';
  if (crc32(blob.subarray(0, crcAt)) !== v.getUint32(crcAt, true)) return 'crc';
  return 'ok';
}

// PlaitsRegion::ReadBlobs without the library RAM budget, which the module sets.
async function readBlobs(data, count) {
  const v = view(data);
  const crcAt = data.length - 4;
  if (count > MAX_BLOBS || count * 16 > crcAt - HEADER) return { status: 'table', blobs: [] };
  const entries = Array.from({ length: count }, (_, i) => ({ kind: data[HEADER + 16 * i], id: data[HEADER + 16 * i + 1],
    reserved: v.getUint16(HEADER + 16 * i + 2, true), offset: v.getUint32(HEADER + 16 * i + 4, true),
    size: v.getUint32(HEADER + 16 * i + 8, true), crc: v.getUint32(HEADER + 16 * i + 12, true) }));
  // Libraries by ID, then models by ID; aligned, apart and inside, before any blob is read.
  let next = HEADER + count * 16, previousId = -1, libraries = 0;
  for (const [i, e] of entries.entries()) {
    if (e.kind === LIBRARY) {
      if (libraries !== i || libraries === MAX_LIBRARIES || !e.id) return { status: 'table', blobs: [] };
      ++libraries;
    } else if (e.kind !== MODEL) {
      return { status: 'table', blobs: [] };
    } else if (i === libraries) {
      previousId = -1;
    }
    if (e.reserved || e.id <= previousId || e.offset % ALIGNMENT || e.offset < next ||
        e.offset > crcAt || e.size > crcAt - e.offset) return { status: 'table', blobs: [] };
    previousId = e.id;
    next = e.offset + e.size;
  }
  // Each blob on its own, then what it needs.
  const digests = [];
  const blobs = [];
  for (const [i, e] of entries.entries()) {
    const blob = data.subarray(e.offset, e.offset + e.size);
    let status = checkBlob(blob);
    // The module skips the blob CRC; changed bytes fail its digest allowlist instead.
    if (status === 'crc') status = 'digest';
    if (status === 'ok') {
      const h = readHeader(blob, view(blob).getUint32(8, true));
      if (h.size !== e.size || view(blob).getUint32(e.size - 4, true) !== e.crc) status = 'table';
      else if (h.kind !== e.kind) status = 'kind';
      else if (h.first !== e.id) status = 'model';
    }
    if (i < libraries && status === 'ok') digests[i] = await sha256(blob);
    blobs.push(status);
  }
  const served = new Set();
  entries.forEach((e, i) => {
    if (blobs[i] !== 'ok') return;
    const blob = data.subarray(e.offset, e.offset + e.size);
    // A library needs only libraries before it: no cycle.
    const before = i < libraries ? i : libraries;
    const found = (d) => entries.slice(0, before).some((l, j) => l.id === d.id && blobs[j] === 'ok' && digests[j] === d.sha256);
    if (!blobDependencies(blob).every(found)) blobs[i] = 'dependency';
    const info = readHeader(blob, view(blob).getUint32(8, true));
    for (let id = info.first; i >= libraries && blobs[i] === 'ok' && id < info.first + info.ids; ++id) {
      if (served.has(id)) blobs[i] = 'table';
      served.add(id);
    }
  });
  return { status: blobs.find((s) => s !== 'ok') ?? 'ok', blobs };
}

async function readSection(index, data, release, expectedCrc) {
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
export async function readRegion(region, release, directory) {
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
    const read = await readSection(index, region.subarray(offset, offset + size), release, crc);
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
