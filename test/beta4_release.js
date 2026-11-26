// Copyright 2026 Insolent Construct.
// MIT licence: see ../static/js/encoder.js.
//
// The staged Beta 4 entry is bound to its firmware build and stays unpublished.
// It reproduces the release WAV and the qualification custom WAV byte for byte.
//
// node test/beta4_release.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { encodeProfile, equal, unshare } from '../static/js/profile.js';
import { regionImage } from '../static/js/region.js';
import { lockSynth, selectedRegion, validateSelection, SYNTH_RATE } from '../static/js/palette.js';
import { factoryTable } from '../static/js/wavetables.js';
import { encode } from '../static/js/encoder.js';
import { decode } from '../static/js/decoder.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entry = 'releases/beta4-development.json';
const staged = JSON.parse(read(entry));
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
const app = new Uint8Array(read(image));
assert.equal(app.length, staged.app_size);
assert.equal(sha256(app), staged.app_sha256);
assert(pins('expected-hashes.sha256').includes(`${staged.app_sha256}  app.bin`), 'app.bin is pinned by the firmware');
assert(pins('expected-wav.sha256').includes(`${staged.wav_sha256}  app.wav`), 'app.wav is pinned by the firmware');
// The stock image: default profile, rebuilt region, full image and WAV against the same pins.
execFileSync(process.execPath, ['tools/check-beta4-wav.js', firmwareRepo, staged.source_commit,
  `releases/${staged.tag}`, entry], { cwd: fileURLToPath(root), stdio: 'inherit' });

// Plaits bank CPU is screened at the one rate this firmware's synth mode runs the codec at.
assert(firmwareShow(staged.source_commit, 'beads/beads.cc', { encoding: 'utf8' })
  .includes(`int sr = new_synth_mode ? ${SYNTH_RATE} : int(processor.sample_rate());`), 'Synth mode runs at 48 kHz');

// The custom qualification setup, from its profile bytes and selection, as the page builds it.
const custom = JSON.parse(read('test/fixtures/beta4-custom-r2.json'));
assert.equal(custom.firmware, staged.source_commit);
const link = new URLSearchParams({ release: staged.tag, profile: custom.profile, setup: JSON.stringify(custom.setup) });
const shared = unshare(link.toString(), [staged]);
const selection = validateSelection(shared.setup.selection);
const written = await selectedRegion(staged, selection, { wave: factoryTable(), terrain: null },
  async (url) => new Response(read('static/' + url)));
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
console.log(`PASS staged Beta 4 entry ${staged.tag}: release WAV ${staged.wav_sha256}, custom WAV ${custom.sha256['app.wav']}`);
