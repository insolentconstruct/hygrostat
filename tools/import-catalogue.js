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

// Import a pinned firmware catalogue and region build for a future release.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUE, MANIFEST, readCatalogue, catalogueFeatures, firmwareDefinitions, firmwareRecord,
  checkDefinitions } from './catalogue.js';
import { PAGE_LEDS } from '../static/js/profile.js';
import { blobInfo, resolveBlobs } from '../static/js/region.js';

const [repo, ref, build, images] = process.argv.slice(2);
if (!images) throw new Error('Usage: node tools/import-catalogue.js FIRMWARE REF REGION_BUILD IMAGES_DIR');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const commit = git('rev-parse', '--verify', ref + '^{commit}').toString().trim();
const read = (file) => git('show', commit + ':' + file);
const text = (file) => read(file).toString();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const bytes = read(CATALOGUE);
const catalogue = readCatalogue(bytes, read(MANIFEST));
checkDefinitions(catalogue, firmwareDefinitions(text), firmwareRecord(text));
const firmware = text('beads/blob/plaits_catalog.cc');
const firmwareConstant = (source, name) => Number(new RegExp(`\\b${name} = (\\d+);`).exec(source)[1]);
const hexBytes = (row) => [...row.matchAll(/0x([0-9a-f]{2})/g)].map(([, byte]) => byte).join('');
const table = firmware.split('kPlaitsApprovedBlobs[][kPlaitsBlobDigestSize] = {')[1].split('};')[0];
const approved = new Set([...table.matchAll(/\{([^{}]+)\}/g)].map(([, row]) => hexBytes(row)));
if (approved.size !== firmwareConstant(firmware, 'kNumPlaitsApprovedBlobs')) {
  throw new Error('Incomplete firmware blob allowlist.');
}
const release = firmwareConstant(firmware, 'kPlaitsBlobRelease');
const region = readFileSync(join(build, 'region.bin'));
const regionHash = /^([0-9a-f]{64}) {2}region\.bin$/m.exec(text('beads/build/expected-hashes.sha256'))[1];
const kinds = { Wave: 'WAVE', Terrain: 'TERR', Plaits: 'PLTS', Rings: 'RNGS' };
const sections = firmware.split('kPlaitsDefaultLayout[] = {')[1].split('};')[0];
const layout = [...sections.matchAll(/kPlaitsSection(\w+), (\d+), (\d+),\s*\{([^{}]+)\}/g)]
  .map(([, kind, offset, size, digest]) => ({ kind: kinds[kind], offset: Number(offset),
    size: Number(size), sha256: hexBytes(digest) }));
if (!layout.length || layout.length !== firmwareConstant(firmware, 'kNumPlaitsDefaultSections') ||
    sha256(region) !== regionHash || !layout.every(({ kind, offset, size, sha256: digest }) =>
      kind && offset + size <= region.length && sha256(region.subarray(offset, offset + size)) === digest)) {
  throw new Error('Region or layout differs from the firmware build.');
}

const directory = 'beta4-catalogue';
const url = (name) => `images/${directory}/${name}`;
const inputs = join(build, 'blob');
const blobs = new Map();
for (const name of readdirSync(inputs).filter((name) => /^[a-z0-9_]+\.bin$/.test(name)).sort()) {
  const data = readFileSync(join(inputs, name));
  const sha = sha256(data);
  if (!approved.has(sha)) continue;
  if (blobs.has(sha)) throw new Error('Duplicate approved blob.');
  blobs.set(sha, { name, data, info: blobInfo(data), asset: { url: url('blob/' + name), sha256: sha } });
}
if (blobs.size !== approved.size) throw new Error('Missing approved blobs.');
const all = [...blobs.values()];
const models = all.filter(({ info }) => info.kind === 1);
const libraries = all.filter(({ info }) => info.kind === 2);
const rings = all.filter(({ info }) => info.kind === 3);
if (rings.length !== 1 || models.length + libraries.length + rings.length !== all.length ||
    models.reduce((count, { info }) => count + info.ids, 0) !== catalogue.plaits_models.length ||
    libraries.length !== catalogue.plaits_libraries.length) throw new Error('Unexpected blob counts.');
await resolveBlobs(models.map(({ data }) => data), libraries.map(({ data }) => data), catalogue);

const header = text('beads/profile.h');
const constant = (name) => firmwareConstant(header, name);
const pageLeds = PAGE_LEDS.find((leds) => leds.length * 3 === constant('kNumPageSlots') - 1);
if (!pageLeds) throw new Error('Unsupported firmware page layout.');
const optionTables = text('beads/build/tools/options_tables.cc');
const namedColors = [...optionTables.matchAll(/\{ \{ (\d+), (\d+), (\d+) \}, "(coral|amber|blue|teal|violet|pink)" \}/g)];
const bootCue = /const Leds::Color cue = \{\s*0, uint8_t\(lit \? (\d+) : 0\), uint8_t\(lit \? (\d+) : 0\)/.exec(text('beads/ui.cc'));
const dimming = /FEATURE_BRIGHTNESS, 3, \{ (\d+), (\d+), (\d+) \}, PULSE_SLOW/.exec(text('beads/options.cc'));
const features = catalogueFeatures(catalogue);
const leds = features.find(({ id }) => id === 18)?.values[3] === '15%' ? {
  colors: Object.fromEntries(namedColors.map(([, r, g, b, name]) => [name, [r, g, b].map(Number)])),
  scale_colors: Object.fromEntries([...text('beads/options.cc').matchAll(
    /FEATURE_PITCH, (\d+), \{ (\d+), (\d+), (\d+) \}, PULSE_/g)]
    .map(([, id, r, g, b]) => [id, [r, g, b].map(Number)])),
  boot: [0, Number(bootCue[1]), Number(bootCue[2])],
  brightness_15: dimming.slice(1).map(Number),
  brightness_zone_band: Number(/kOptionsProfileZoneBand = ([\d.]+)f;/.exec(text('beads/options.h'))[1])
} : undefined;
if (leds && (namedColors.length !== 6 || Object.keys(leds.scale_colors).length !== 8)) {
  throw new Error('Incomplete firmware LED tables.');
}
const measurements = JSON.parse(readFileSync(new URL('../costs/hygrostat-model-costs.json', import.meta.url)));
const modelKey = (id, sha) => id + ':' + sha;
const measuredModels = new Map([...measurements.content.models.filter(({ cpu }) => cpu),
  ...measurements.unmatched_model_costs].map(({ id, cpu }) => [modelKey(id, cpu.asset_sha256), cpu]));
const modelCpu = {
  source: 'Seed3',
  firmware_source: measurements.firmware_source,
  screening_ratio: measurements.historical_ratio_screen,
  working_limits: measurements.working_limits_percent
};

const index = {
  copyright: catalogue.copyright,
  source_commit: commit,
  catalogue: { url: url('profile-features.json'), sha256: sha256(bytes) },
  profile: {
    offset: 1024, size: constant('kProfileSize'), version: 2, format: constant('kProfileFormat'),
    page_leds: pageLeds, hold_rules: true, feedback_slot: true, reachability_rules: true,
    features,
    leds,
    region: { profile_version: constant('kProfileVersionBlobs'), release, services_version: 2, default_layout: layout }
  },
  content: {
    models: catalogue.plaits_models.map((row) => {
      const blob = models.find(({ info }) => row.id >= info.first && row.id < info.first + info.ids);
      if (!blob || (row.blob_size !== undefined && blob.info.size !== row.blob_size)) throw new Error(`Blob size differs for model ${row.id}.`);
      const cpu = measuredModels.get(modelKey(row.id, blob.asset.sha256));
      const seed3_peak = cpu ?
        Object.fromEntries(Object.entries(cpu.rates).map(([rate, capture]) => [rate, capture.peak_percent])) : undefined;
      return { ...row, ...blob.asset, bytes: blob.info.size, seed3_peak };
    }),
    model_cpu: modelCpu,
    libraries: catalogue.plaits_libraries.map((row) => {
      const blob = libraries.find(({ info }) => info.first === row.id);
      if (!blob) throw new Error(`Missing library ${row.id}.`);
      return { ...row, ...blob.asset };
    }),
    rings: rings[0].asset,
    region: { url: url('region.bin'), sha256: regionHash }
  }
};
const out = join(images, directory);
mkdirSync(join(out, 'blob'), { recursive: true });
for (const { name, data } of all) writeFileSync(join(out, 'blob', name), data);
writeFileSync(join(out, 'region.bin'), region);
writeFileSync(join(out, 'profile-features.json'), bytes);
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n');
if (leds) {
  for (const name of ['options-guide.svg', 'options-guide-mobile.svg']) {
    writeFileSync(join(out, name), read('beads/build/docs/' + name));
  }
}
