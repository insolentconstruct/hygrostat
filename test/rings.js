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
// The Rings synth (#345): Synth value 2, feature 42, the default region with RNGS,
// and the synth rules against the firmware's synth_choice.h and profile parser.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { readCatalogue, catalogueFeatures, firmwareDefinitions, firmwareRecord, checkDefinitions,
  MANIFEST, CATALOGUE } from '../tools/catalogue.js';
import { defaults, encodeProfile, decodeSettings, validate, equal, crc32, share, unshare, regionSupport,
  playableSynths, installedKinds, synthValues, nextSynth, effectiveSynth, checkSynths, SYNTH,
  SECTION_NAMES } from '../static/js/profile.js';
import { writeRegion, regionItems, droppable, validateRegionFirmware, KINDS } from '../static/js/region.js';
import { featureHelp } from '../static/js/help.js';

// #345's head (override with RINGS_FIRMWARE_REF).
const ref = process.env.RINGS_FIRMWARE_REF || '3df1b087a7458e57782741ff8e252f55ddb8a21f';
const show = (file) => firmwareShow(ref, file, { stdio: ['ignore', 'pipe', 'pipe'] });
const text = (file) => show(file).toString('utf8');
const read = (file) => readFileSync(new URL(file, import.meta.url));
const hex = (b) => createHash('sha256').update(b).digest('hex');

// The firmware's format 2 catalogue, copied verbatim.
const fixture = read('fixtures/rings-profile-features.json');
const catalogue = readCatalogue(fixture, show(MANIFEST));
assert(equal(fixture, show(CATALOGUE)), 'the fixture is the firmware catalogue verbatim');
checkDefinitions(catalogue, firmwareDefinitions(text), firmwareRecord(text));
const synthRow = catalogue.features.find((f) => f.id === SYNTH);
const polyphony = catalogue.features.find((f) => f.id === 42);
assert.deepEqual(synthRow.values, ['Beads (Stock)', 'Plaits', 'Rings']);
assert.deepEqual([polyphony.name, polyphony.values, polyphony.states, polyphony.saved, polyphony.factory],
  ['Rings polyphony', ['1', '2', '4'], ['Adjustable'], 27, [42, 2, 0, 0, 0, 0]]);

// A synthetic release from the catalogue, with the firmware's region and default layout; never offered.
const manifest = JSON.parse(read('../static/manifest.json'));
const beta3 = manifest.releases.find((r) => r.slug === 'beta-3-smirr');
const release = structuredClone(beta3);
Object.assign(release, { tag: 'drizzlet-dev-rings', name: 'Synthetic fixture (never offered)', development: true,
  source_commit: ref });
Object.assign(release.profile, { features: catalogueFeatures(catalogue), hold_rules: true, feedback_slot: true });
const catalog = text('beads/blob/plaits_catalog.cc');
const releaseNumber = Number(/kPlaitsBlobRelease = (\d+);/.exec(catalog)[1]);
release.profile.region = { profile_version: 3, release: releaseNumber, services_version: 2, default_layout: [
  { kind: 'PLTS', offset: 0, size: 188560, sha256: '4002fbdfe5a588145e5a8beeb850b29cc0cf4a44981f118ced03b7f03fafc585' },
  { kind: 'RNGS', offset: 188576, size: 66456, sha256: '9eae706fa29d4e9f5e4d37f7397ad49759932fa29693ca48f1b247411aa9b223' }] };
const profile = release.profile;
const sources = { profileHeader: text('beads/profile.h'), catalog, blobHeader: text('beads/blob/plaits_blob.h') };
validateRegionFirmware(profile.region, sources);
const moved = structuredClone(profile.region);
moved.default_layout[1].offset += 32;
assert.throws(() => validateRegionFirmware(moved, sources), /match the firmware/);
assert.throws(() => regionSupport({ ...profile, region: { ...profile.region,
  default_layout: [...profile.region.default_layout].reverse() } }), /region metadata/);

// The factory profile: Hygrostat's encoder writes the firmware's own block, polyphony included.
const factory = defaults(profile);
assert.deepEqual(factory.find((e) => e[0] === 42), [42, 2, 0, 0, 0, 0]);
const block = Uint8Array.from(text('beads/profile.cc').split('kProfileBlock[kProfileSize]')[1].split('};')[0]
  .match(/0x([0-9a-f]{2})/g), (v) => parseInt(v, 16));
assert(equal(encodeProfile(factory, profile), block), 'factory block');

// Feature 42: a start value 1, 2 or 4, Adjustable only, no controls.
const withPolyphony = (entry) => factory.map((e) => e[0] === 42 ? entry : e);
for (const value of [0, 1, 2]) validate(withPolyphony([42, 2, value, 0, 0, 0]), profile);
for (const entry of [[42, 2, 3, 0, 0, 0], [42, 1, 1, 0, 0, 0], [42, 0, 0, 0, 0, 0], [42, 2, 0, 4, 0, 0],
  [42, 2, 0, 0, 1, 0], [42, 2, 0, 0, 0, 1]]) {
  assert.throws(() => validate(withPolyphony(entry), profile), /not allowed/, entry.join(' '));
}
// Help: Synth names Rings and credits it; both link to real FEATURES.md sections.
const headings = [...text('beads/build/docs/FEATURES.md').matchAll(/^#{2,3} (.+)$/gm)]
  .map((m) => m[1].toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-'));
for (const feature of [synthRow, polyphony].map((c) => profile.features.find((f) => f.id === c.id))) {
  const help = featureHelp(feature, release);
  assert(headings.includes(new URL(help.url).hash.slice(1)), feature.name);
  assert(help.description.length > 15 && help.description.length < 180);
}
assert.match(featureHelp(profile.features.find((f) => f.id === SYNTH), release).description, /Beads, Plaits or Rings/);
assert.match(featureHelp(profile.features.find((f) => f.id === SYNTH), release).details, /Mutable Instruments’ Rings \(MIT\)/);
assert.equal(featureHelp(beta3.profile.features.find((f) => f.id === SYNTH), beta3).description, 'Beads or Plaits synth.');

// The editor's synth table: 8 WAVE / PLTS / RNGS combinations x 3 selections, against synth_choice.h.
const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-rings-'));
try {
  mkdirSync(join(scratch, 'beads/blob'), { recursive: true });
  mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
  writeFileSync(join(scratch, 'beads/blob/synth_choice.h'), show('beads/blob/synth_choice.h'));
  writeFileSync(join(scratch, 'choice.cc'), ['#include <cstdio>', '#include "beads/blob/synth_choice.h"',
    'int main() {', '  for (int mask = 0; mask < 8; ++mask) for (int value = 0; value < 4; ++value)',
    '    printf("%d %d %d %d\\n", mask, value, beads::EffectiveSynth(value, mask), beads::NextSynth(value, mask));',
    '  return 0;', '}', ''].join('\n'));
  execFileSync('g++', ['-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo, join(scratch, 'choice.cc'),
    '-o', join(scratch, 'choice')]);
  const rows = execFileSync(join(scratch, 'choice')).toString().trim().split('\n').map((l) => l.split(' ').map(Number));
  assert.equal(rows.length, 32);
  let checked = 0;
  for (const [mask, value, effective, next] of rows) {
    const kinds = ['WAVE', 'PLTS', 'RNGS'].filter((_, i) => mask & 1 << i);
    const playable = playableSynths(kinds, false);
    assert.deepEqual(playable, [0, 1, 2].map((i) => Boolean(mask & 1 << i)));
    assert.equal(effectiveSynth(value, playable), effective, `effective ${mask} ${value}`);
    if (value === 3) continue;
    assert.equal(nextSynth(value, playable), next, `next ${mask} ${value}`);
    // The page offers the playable synths; a selection the install lacks is refused, as is no Beads or Plaits.
    assert.deepEqual(synthValues(synthRow, playable).map(([v]) => v), [0, 1, 2].filter((v) => playable[v]));
    const entries = factory.map((e) => e[0] === SYNTH ? [SYNTH, 2, value, 8, 0, 0] : e);
    const refused = (!playable[0] && !playable[1]) || !playable[value];
    assert.equal((() => { try { checkSynths(entries, playable); return false; } catch { return true; } })(), refused,
      `rule ${mask} ${value}`);
    ++checked;
  }
  assert.equal(checked, 24);
  // Fixed Rings is refused as Adjustable is; Off is Beads.
  assert.throws(() => checkSynths(factory.map((e) => e[0] === SYNTH ? [SYNTH, 1, 2, 0, 0, 0] : e), [true, true, false]),
    /Rings is not installed/);
  checkSynths(factory.map((e) => e[0] === SYNTH ? [SYNTH, 0, 0, 0, 0, 0] : e), [true, false, false]);
  assert.deepEqual(playableSynths([]), [true, false, false], 'Beads plays from the app until WAVE moves');
  assert.deepEqual(synthValues(beta3.profile.features.find((f) => f.id === SYNTH), [true, true, true]).length, 2);

  // The encoder refuses Rings for an install without RNGS; the default layout carries it.
  const rings = factory.map((e) => e[0] === SYNTH ? [SYNTH, 2, 2, 8, 0, 0] : e);
  const dir = (...names) => names.map((name, i) => ({ kind: KINDS[name], offset: 256 * i, size: 64, crc: i }));
  assert.deepEqual(installedKinds(profile, []), ['PLTS', 'RNGS']);
  assert.deepEqual(installedKinds(profile, dir('PLTS')), ['PLTS']);
  assert.equal(installedKinds(beta3.profile, []), null);
  const accepted = encodeProfile(rings, profile, null, { banks: [], directory: [] });
  encodeProfile(rings, profile);
  const noRings = { ...profile, region: { ...profile.region, default_layout: profile.region.default_layout.slice(0, 1) } };
  for (const plaits of [null, { banks: [], directory: [] }]) {
    assert.throws(() => encodeProfile(rings, noRings, null, plaits), /Rings is not installed/);
  }
  encodeProfile(rings, profile, null, { banks: [], directory: dir('PLTS', 'RNGS') });
  for (const names of [['PLTS'], ['WAVE', 'PLTS'], ['WAVE']]) {
    assert.throws(() => encodeProfile(rings, profile, null, { banks: [], directory: dir(...names) }), /Rings is not installed/);
  }
  // The module keeps such a block (another synth plays), so the editor can read it and ask for a change.
  const kept = encodeProfile(factory, profile, null, { banks: [], directory: dir('PLTS') });
  kept.set([SYNTH, 2, 2, 8, 0, 0], 16 + factory.findIndex((e) => e[0] === SYNTH) * 6);
  const end = 16 + (kept[6] | kept[7] << 8);
  new DataView(kept.buffer).setUint32(end, crc32(kept.subarray(0, end)), true);
  assert.deepEqual(decodeSettings(kept, profile).entries, rings);
  assert.deepEqual(unshare(share(release, accepted), [release]).plaits, { banks: [], directory: [] });

  // The firmware's parser takes Synth 2 and polyphony 1, 2 and 4, and refuses what Hygrostat refuses.
  for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) writeFileSync(join(scratch, 'beads', file), show('beads/' + file));
  execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
    fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', join(scratch, 'profile')]);
  const at = (id) => 16 + factory.findIndex((e) => e[0] === id) * 6;
  const variants = [[SYNTH, [2, 2, 8, 0, 0]], [SYNTH, [1, 2, 0, 0, 0]], [SYNTH, [2, 3, 8, 0, 0]],
    ...[0, 1, 2, 3].map((v) => [42, [2, v, 0, 0, 0]]), [42, [1, 1, 0, 0, 0]], [42, [0, 0, 0, 0, 0]], [42, [2, 0, 1, 0, 0]]]
    .map(([id, entry]) => {
      const b = block.slice();
      b.set(entry, at(id) + 1);
      new DataView(b.buffer).setUint32(16 + (b[6] | b[7] << 8), crc32(b.subarray(0, 16 + (b[6] | b[7] << 8))), true);
      return b;
    });
  const answers = execFileSync(join(scratch, 'profile'), [], { input: Buffer.concat(variants.map((b) => Buffer.from(b))) });
  variants.forEach((b, i) => {
    let decoded = null;
    try { decoded = decodeSettings(b, profile).entries; } catch { /* refused */ }
    assert.equal(answers[i * 493] === 1, decoded !== null, `parser ${i}`);
    if (decoded) assert(equal(decoded.flat(), answers.subarray(i * 493 + 1, i * 493 + 1 + decoded.length * 6)), `entries ${i}`);
  });
  assert.deepEqual(variants.map((_, i) => answers[i * 493]), [1, 1, 0, 1, 1, 1, 0, 0, 0, 0]);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// Picker rows and refit for the default region; with REGION_BUILD (a firmware build's out directory), the
// untouched default written from its blobs equals its region.bin byte for byte.
const layout = profile.region.default_layout.map((e) => ({ kind: KINDS[e.kind], offset: e.offset, size: e.size, crc: 0 }));
const appSize = 425 * 1024;
const items = regionItems(layout, appSize);
assert.deepEqual(items.map((i) => [i.kind, i.name, i.bytes]), [['PLTS', 'Plaits models', 188576], ['RNGS', 'Rings synth', 66472]]);
assert.equal(items[1].credit, 'Mutable Instruments (MIT)');
assert(items[1].seconds > 40 && items[1].seconds < 60, `Rings adds ${items[1].seconds} s`);
assert.equal(regionItems(layout.slice(0, 1), appSize)[0].bytes, 188560);
const build = process.env.REGION_BUILD;
if (build) {
  const blobDir = join(build, 'objects/region/blob');
  const stock = [...text('beads/build/tools/build_region.sh').matchAll(/"\$blob\/([a-z0-9_]+\.bin)"/g)].map((m) => m[1]);
  assert(stock.length === 27 && stock.at(-1) === 'rings_synth.bin');
  const blobs = stock.map((name) => readFileSync(join(blobDir, name)));
  const expected = readFileSync(join(build, 'region.bin'));
  const written = writeRegion({ release: releaseNumber, blobs });
  assert(equal(written.region, expected), 'the default region equals the firmware build');
  assert.deepEqual(written.directory.map((e) => SECTION_NAMES[[KINDS.WAVE, KINDS.TERR, KINDS.PLTS, KINDS.RNGS].indexOf(e.kind)]),
    ['PLTS', 'RNGS']);
  profile.region.default_layout.forEach((e, i) => {
    const d = written.directory[i];
    assert.deepEqual([d.offset, d.size, hex(written.region.subarray(d.offset, d.offset + d.size))], [e.offset, e.size, e.sha256]);
  });
  const expectedHash = /^([0-9a-f]{64}) {2}region\.bin$/m.exec(text('beads/build/expected-hashes.sha256'))[1];
  assert.equal(hex(expected), expectedHash);
  // Rings left out keeps PLTS byte for byte; a refit lists it beside the models.
  const without = writeRegion({ release: releaseNumber, blobs: blobs.slice(0, -1) });
  assert(equal(without.region, expected.subarray(0, 188560)));
  const drop = droppable(written);
  assert.deepEqual(drop.at(-1), { kind: 'synth', name: 'Rings synth', size: 66420 });
  assert.equal(drop.filter((d) => d.kind === 'model').length, 22);
  console.log(`PASS the default region written from the firmware build's blobs equals its region.bin (${expectedHash.slice(0, 8)})`);
}
console.log(`PASS Rings synth at ${ref.slice(0, 7)}: format 2 catalogue, factory block, feature 42, help, 24 synth rules and ` +
  'the firmware parser; picker rows' + (build ? ' and the default region' : ''));
