// Copyright 2026 Insolent Construct.
// MIT licence: see ../static/js/encoder.js.
//
// The staged RC1 entry is bound to its firmware build and stays unpublished.
// It reproduces the release WAV and the qualification custom WAV byte for byte.
//
// node test/rc1_release.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { defaults, encodeProfile, equal, MANUAL_DELAY, unshare } from '../static/js/profile.js';
import { edit, place, unplace } from '../static/js/layout.js';
import { regionImage } from '../static/js/region.js';
import { lockSynth, selectedRegion, validateSelection } from '../static/js/palette.js';
import { factoryTable } from '../static/js/wavetables.js';
import { encode } from '../static/js/encoder.js';
import { decode } from '../static/js/decoder.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entry = 'releases/rc1-development.json';
const staged = JSON.parse(read(entry));
const index = JSON.parse(read('static/images/rc1-catalogue/index.json'));
assert.equal(staged.source_commit, '6d9792888ddc1e3a7fcdc4d16b8fc244bc33e99d');
assert.equal(staged.profile.processor_spectral_toggle, true);
assert.deepEqual(staged.profile, { ...index.profile, processor_spectral_toggle: true });
for (const key of ['source_commit', 'catalogue', 'content']) assert.deepEqual(staged[key], index[key]);
const manifest = JSON.parse(read('static/manifest.json'));

// Staged: a development entry named after its source commit, with no release tag or date yet.
assert(staged.development === true && /^drizzlet-dev-[0-9a-f]{8}$/.test(staged.tag) &&
  /^[0-9a-f]{40}$/.test(staged.source_commit) && staged.source_commit.startsWith(staged.tag.slice('drizzlet-dev-'.length)) &&
  /unreleased/i.test(staged.name) && staged.date === undefined,
  'The staged entry is an explicitly unreleased development build');
// Unpublished: the release list offers neither the entry nor its image, and no served file is the image (links are refused).
assert(!manifest.releases.some((r) => r.tag === staged.tag || r.slug === staged.slug ||
  r.app_sha256 === staged.app_sha256 || r.wav_sha256 === staged.wav_sha256), 'The staged entry is not in the release list');
assert(!JSON.stringify(manifest).includes(staged.tag));
const image = `releases/${staged.tag}/app.bin`;
const served = readdirSync(new URL('static/', root), { recursive: true, withFileTypes: true });
assert(served.length > 100 && staged.app === undefined && !served.some((file) => file.isSymbolicLink() ||
  (file.isFile() && sha256(readFileSync(`${file.parentPath}/${file.name}`)) === staged.app_sha256)), 'The staged image is not served');

// The entry's hashes are the firmware's own pins at its source commit.
const pins = (file) => firmwareShow(staged.source_commit, `beads/build/${file}`, { encoding: 'utf8' }).split('\n');
for (const name of ['options-guide.svg', 'options-guide-mobile.svg']) {
  assert.deepEqual(read('static/images/rc1-catalogue/' + name),
    firmwareShow(staged.source_commit, 'beads/build/docs/' + name));
}
const app = new Uint8Array(read(image));
assert.equal(app.length, staged.app_size);
assert.equal(sha256(app), staged.app_sha256);
assert(pins('expected-hashes.sha256').includes(`${staged.app_sha256}  app.bin`), 'app.bin is pinned by the firmware');
assert(pins('expected-wav.sha256').includes(`${staged.wav_sha256}  app.wav`), 'app.wav is pinned by the firmware');
// The stock image: default profile, rebuilt region, full image and WAV against the same pins.
execFileSync(process.execPath, ['tools/check-beta4-wav.js', firmwareRepo, staged.source_commit,
  `releases/${staged.tag}`, entry], { cwd: fileURLToPath(root), stdio: 'inherit' });

const manualDelay = staged.profile.features.find(({ id }) => id === MANUAL_DELAY);
const initial = defaults(staged.profile);
const placed = place(initial, staged.profile, MANUAL_DELAY, 'action', 1);
assert.deepEqual(placed.find(([id]) => id === MANUAL_DELAY), [MANUAL_DELAY, 1, 1, 0, 0, 1]);
const removed = unplace(placed, staged.profile, MANUAL_DELAY, 'action');
assert(!removed.some(([id, state]) => id === MANUAL_DELAY && state));
const importedOff = [...removed.filter(([id]) => id !== MANUAL_DELAY), [MANUAL_DELAY, 1, 0, 0, 0, 0]];
assert.deepEqual(edit(importedOff, staged.profile, manualDelay, 2, 1).find(([id]) => id === MANUAL_DELAY),
  [MANUAL_DELAY, 1, 1, 0, 0, 1]);
assert.throws(() => encodeProfile([[MANUAL_DELAY, 1, 1, 0, 0, 0]], staged.profile), /not allowed/);

// The custom qualification setup, from its profile bytes and selection, as the page builds it.
const custom = JSON.parse(read('test/fixtures/rc1-custom.json'));
assert.equal(custom.firmware, staged.source_commit);
const link = new URLSearchParams({ release: staged.tag, profile: custom.profile, setup: JSON.stringify(custom.setup) });
const shared = unshare(link.toString(), [staged]);
const selection = validateSelection(shared.setup.selection);
const written = await selectedRegion(staged, selection, { wave: factoryTable(), terrain: null },
  async (url) => new Response(read('static/' + url)));
assert.notEqual(sha256(written.region), staged.content.region.sha256);
const block = encodeProfile(lockSynth(shared.entries, selection), staged.profile, shared.scales,
  { banks: selection.banks, directory: written.directory });
assert.equal(Buffer.from(block).toString('hex'), custom.profile, 'The profile round-trips through the editor');
const customApp = app.slice();
customApp.set(block, staged.profile.offset);
const customImage = regionImage(customApp, written.region);
const wav = encode(customImage);
assert.deepEqual({ 'app.bin': sha256(customApp), 'region.bin': sha256(written.region), 'image.bin': sha256(customImage),
  'app.wav': sha256(wav), 'profile.bin': sha256(block) }, custom.sha256);
assert.equal(customImage.length, custom.image_size);
assert(equal(decode(wav, customImage.length), customImage), 'The custom WAV decodes to its image');
assert.notEqual(custom.sha256['app.wav'], staged.wav_sha256);
console.log(`PASS staged RC1 entry ${staged.tag}: release WAV ${staged.wav_sha256}, custom WAV ${custom.sha256['app.wav']}`);
