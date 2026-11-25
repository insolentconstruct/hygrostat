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

// Byte agreement for the imported catalogue, allowlist and factory region.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { CATALOGUE, catalogueAtRef, catalogueFeatures } from '../tools/catalogue.js';
import { defaultSelection, offeredModels, selectedRegion } from '../static/js/palette.js';
import { factoryScales } from '../static/js/scales.js';
import { guide } from '../static/js/guide.js';
import { modelInfo } from '../static/js/model_info.js';
import { defaults, encodeProfile, regionSupport, validateProfileFormat } from '../static/js/profile.js';
import { factoryTable } from '../static/js/wavetables.js';
import { libraryGroups, fitsSlot } from '../static/js/layout.js';

const assetRoot = new URL('../static/', import.meta.url);
const indexPath = 'images/beta4-catalogue/index.json';
const readAsset = (path) => readFileSync(new URL(path, assetRoot));
const release = JSON.parse(readAsset(indexPath));
const staged = JSON.parse(readFileSync(new URL('../releases/beta4-development.json', import.meta.url)));
for (const key of Object.keys(release)) assert.deepEqual(staged[key], release[key], key);
const source = (path) => firmwareShow(release.source_commit, path);
const catalogue = catalogueAtRef(firmwareShow, release.source_commit);
assert.deepEqual(readAsset(release.catalogue.url), source(CATALOGUE));
assert.deepEqual(release.profile.features, catalogueFeatures(catalogue));
assert.equal(release.profile.features.length, 52);
const gainCeiling = release.profile.features.at(-1);
assert.equal(gainCeiling.name, 'Gain ceiling');
assert(fitsSlot(release.profile, gainCeiling, 'page', 21));
const libraryIds = libraryGroups(release.profile).flatMap(([, ids]) => ids);
assert.deepEqual(libraryIds.sort((a, b) => a - b), release.profile.features.map(({ id }) => id),
  'Every Beta 4 feature appears once in the editor library');
assert.equal(release.content.models.length, 96);
assert.equal(release.content.models.filter((row) => row.id >= 28 && row.blob_size !== undefined).length, 70);
assert.equal(release.content.libraries.length, 6);
assert.equal(offeredModels(release).length, 24);
const { content, profile } = release;
const guides = ['options-guide.svg', 'options-guide-mobile.svg'];
for (const name of guides) assert.deepEqual(readAsset(`images/beta4-catalogue/${name}`), source(`beads/build/docs/${name}`));
assert.deepEqual(profile.features.find(({ id }) => id === 18).values, ['100%', '66%', '33%', '15%']);
assert.deepEqual(profile.leds.boot, [0, 211, 255]);
assert.deepEqual(profile.leds.brightness_15, [255, 0, 0]);
assert.equal(profile.leds.brightness_zone_band, .025);
assert.deepEqual(factoryScales(profile.leds).map(({ color }) => color), [
  [255, 89, 92], [255, 209, 0], [95, 222, 255], [255, 209, 0],
  [95, 222, 255], [0, 255, 253], [240, 0, 255], [255, 0, 170]
]);
for (const mobile of [false, true]) {
  const entries = [...defaults(profile), [15, 1, 1, 0, 0, 0]];
  const svg = guide(entries, { ...release, tag: 'beta4-test' }, 'test', mobile);
  for (const color of ['ff595c', 'ffd100', '5fdeff', '00fffd', 'f000ff', 'ff00aa', '00d3ff']) assert(svg.includes(`fill="#${color}"`));
  assert.match(svg, /fill="#ff0000"[^>]*stroke-dasharray="6 4"[^>]*\/>\s*<text[^>]*>15%<\/text>/);
  assert.match(svg, /15%<\/text>\s*<text[^>]*>red; slow(?: blink)?<\/text>/);
}
assert.equal(content.models.flatMap(({ seed3_peak }) => Object.values(seed3_peak)).length, 288);
assert.equal(content.models.find(({ id }) => id === 7).sha256,
  '372129b1e04f0b426aeb427248e8f73a1b3dbc78dd12990181b9803f2d8c9ebe');
assert.deepEqual(content.model_cpu.working_limits, { 48000: 96.5, 32000: 97, 24000: 90 });
for (const [rate, limit] of Object.entries(content.model_cpu.working_limits)) {
  assert(Math.max(...content.models.map(({ seed3_peak }) => seed3_peak[rate])) * content.model_cpu.screening_ratio < limit);
}
validateProfileFormat(release, source('beads/profile.h').toString());
assert(regionSupport(profile));
const factory = source('beads/profile.cc').toString().split('kProfileBlock[kProfileSize]')[1].split('};')[0];
assert.deepEqual(Buffer.from(encodeProfile(defaults(profile), profile)),
  Buffer.from([...factory.matchAll(/0x([0-9a-f]{2})/g)].map(([, byte]) => parseInt(byte, 16))));
const blobs = new Set([...content.models, ...content.libraries, content.rings].map(({ url }) => url));
assert.equal(blobs.size, 101);
assert.equal(content.models.filter(({ id }) => modelInfo(id)).length, 15);
assert.match(modelInfo(59), /4 ms/);

const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-beta4-catalogue-'));
try {
  for (const path of ['beads/build/tools/blob_sections.py', 'beads/resources.cc']) {
    writeFileSync(join(scratch, basename(path)), source(path));
  }
  const writer = source('beads/build/tools/build_region.sh').toString();
  const stock = [...writer.matchAll(/"\$blob\/([a-z0-9_]+\.bin)"/g)].map(([, name]) =>
    fileURLToPath(new URL(`images/beta4-catalogue/blob/${name}`, assetRoot)));
  const expected = join(scratch, 'region.bin');
  execFileSync('python3', ['blob_sections.py', expected, String(profile.region.release),
    '--wave', 'resources.cc', ...stock], { cwd: scratch });
  assert.deepEqual(readAsset(content.region.url), readFileSync(expected));
  const { sections } = JSON.parse(readFileSync(expected + '.json'));
  assert.deepEqual(profile.region.default_layout,
    sections.map(({ kind, offset, size, sha256 }) => ({ kind, offset, size, sha256 })));
  writeFileSync(expected + '.json', '{}');  // The import uses the compiled layout table.
  const written = await selectedRegion(release, defaultSelection(release), { wave: factoryTable() },
    async (url) => new Response(readAsset(url)));
  assert.deepEqual(Buffer.from(written.region), readFileSync(expected));

  // The shipped catalogue, index and every blob can be re-imported from these inputs.
  symlinkSync(fileURLToPath(new URL('images/beta4-catalogue/blob/', assetRoot)), join(scratch, 'blob'), 'dir');
  const output = join(scratch, 'images');
  execFileSync(process.execPath, [fileURLToPath(new URL('../tools/import-catalogue.js', import.meta.url)),
    firmwareRepo, release.source_commit, scratch, output]);
  for (const path of [...blobs, content.region.url, release.catalogue.url, indexPath, ...guides.map((name) => `images/beta4-catalogue/${name}`)]) {
    assert.deepEqual(readAsset(path), readFileSync(join(output, path.slice('images/'.length))), path);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
execFileSync(process.execPath, [fileURLToPath(new URL('catalogue.js', import.meta.url))], {
  env: { ...process.env, CATALOGUE_FIRMWARE_REF: release.source_commit, CATALOGUE_REACHABILITY_RULES: '1' },
  stdio: 'inherit'
});
console.log('PASS Beta 4 import: catalogue, 101 blob pins, factory region and grouped FM assets match firmware');
