// Copyright 2026 Insolent Construct.
// Author: Insolent Construct
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

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CATALOGUE, catalogueAtRef, catalogueFeatures } from './catalogue.js';
import { defaults, encodeProfile, equal, validateProfileFormat } from '../static/js/profile.js';
import { regionImage, validateRegionFirmware } from '../static/js/region.js';
import { defaultSelection, selectedRegion } from '../static/js/palette.js';
import { factoryTable } from '../static/js/wavetables.js';
import { encode } from '../static/js/encoder.js';
import { decode } from '../static/js/decoder.js';

const [repo, ref, build, entry, assetRoot = 'static'] = process.argv.slice(2);
if (!entry) throw new Error('Usage: node tools/check-beta4-wav.js FIRMWARE REF BUILD_DIR ENTRY_JSON [ASSET_ROOT]');
const commit = execFileSync('git', ['-C', repo, 'rev-parse', '--verify', ref + '^{commit}'], { encoding: 'utf8' }).trim();
const show = (rev, file, options) => execFileSync('git', ['-C', repo, 'show', `${rev}:${file}`], options);
const source = (file) => show(commit, file, { encoding: 'utf8' });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assertPin = (bytes, file, pins) => {
  const digest = sha256(bytes);
  assert(source(`beads/build/${pins}`).split('\n').includes(`${digest}  ${file}`), `${file} SHA-256 differs from the pin at ${commit}`);
  console.log(`${digest}  ${file} (${bytes.length} bytes)`);
};
const root = pathToFileURL(resolve(assetRoot) + sep);
const readAsset = (url) => readFileSync(new URL(url, root));
const release = JSON.parse(readFileSync(entry));
const { profile, content } = release;
// An older staged entry can be checked against a successor with identical catalogue and region bytes.
if (release.source_commit) assert.deepEqual(show(release.source_commit, CATALOGUE), show(commit, CATALOGUE),
  'The entry source and requested ref have different catalogues');
const catalogue = readAsset(release.catalogue.url);
assert.deepEqual(catalogue, show(commit, CATALOGUE), 'Catalogue differs from firmware');
assert.equal(sha256(catalogue), release.catalogue.sha256, 'Catalogue differs from the entry hash');
assert.deepEqual(profile.features, catalogueFeatures(catalogueAtRef(show, commit)), 'Profile feature rows differ from firmware');
const profileHeader = source('beads/profile.h');
validateProfileFormat(release, profileHeader);
validateRegionFirmware(profile.region, { profileHeader, catalog: source('beads/blob/plaits_catalog.cc'),
  blobHeader: source('beads/blob/plaits_blob.h') });

const app = readFileSync(resolve(build, 'app.bin'));
const region = readAsset(content.region.url);
assertPin(app, 'app.bin', 'expected-hashes.sha256');
if (release.app_size !== undefined) assert.equal(app.length, release.app_size, 'App size differs from the entry');
if (release.app_sha256 !== undefined) assert.equal(sha256(app), release.app_sha256, 'App differs from the entry hash');
if (release.app !== undefined) assert.deepEqual(readAsset(release.app), app, 'The entry app asset differs from the build');
assertPin(region, 'region.bin', 'expected-hashes.sha256');
assert.equal(sha256(region), content.region.sha256, 'Region differs from the entry hash');
const block = encodeProfile(defaults(profile), profile);
assert(equal(block, app.subarray(profile.offset, profile.offset + profile.size)), 'Default profile differs from app.bin');
for (const { kind, offset, size, sha256: digest } of profile.region.default_layout) {
  const section = region.subarray(offset, offset + size);
  assert(section.length === size && sha256(section) === digest, `${kind} differs from its pinned layout`);
}
const rebuilt = await selectedRegion(release, defaultSelection(release), { wave: factoryTable() },
  async (url) => new Response(readAsset(url)));
assert(equal(rebuilt.region, region), 'The region writer does not reproduce the stock region');
const image = regionImage(app, region);
assertPin(image, 'image.bin', 'expected-hashes.sha256');
const wav = encode(image);
assertPin(wav, 'app.wav', 'expected-wav.sha256');
if (release.wav_sha256 !== undefined) assert.equal(sha256(wav), release.wav_sha256, 'WAV differs from the entry hash');
assert(equal(decode(wav, image.length), image), 'WAV round trip differs from the full image');
console.log(`PASS stock Beta 4 WAV matches ${commit}`);
