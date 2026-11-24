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
import { modelInfo } from '../static/js/model_info.js';
import { defaults, encodeProfile, regionSupport, validateProfileFormat } from '../static/js/profile.js';
import { factoryTable } from '../static/js/wavetables.js';

const assetRoot = new URL('../static/', import.meta.url);
const indexPath = 'images/beta4-catalogue/index.json';
const readAsset = (path) => readFileSync(new URL(path, assetRoot));
const release = JSON.parse(readAsset(indexPath));
const source = (path) => firmwareShow(release.source_commit, path);
const catalogue = catalogueAtRef(firmwareShow, release.source_commit);
assert.deepEqual(readAsset(release.catalogue.url), source(CATALOGUE));
assert.deepEqual(release.profile.features, catalogueFeatures(catalogue));
assert.equal(release.profile.features.length, 52);
assert.equal(release.profile.features.at(-1).name, 'Gain ceiling');
assert.equal(release.content.models.length, 96);
assert.equal(release.content.models.filter((row) => row.id >= 28 && row.blob_size !== undefined).length, 70);
assert.equal(release.content.libraries.length, 6);
assert.equal(offeredModels(release).length, 24);
const { content, profile } = release;
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
  for (const path of [...blobs, content.region.url, release.catalogue.url, indexPath]) {
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
