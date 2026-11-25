// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// MIT licence: see static/js/encoder.js.
//
// Every release the page offers: the pinned app image matches its size and
// SHA-256, those hashes are the ones pinned at the release tag, and the image
// encodes to the release's .wav byte for byte. Needs the release tags.
//
// node test/manifest.js

import { createHash } from 'node:crypto';
import { firmwareShow, firmwareRepo } from './firmware.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { decodeProfile, defaults, encodeProfile, equal, validateProfileFormat, pageSlots, regionSupport } from '../static/js/profile.js';
import { regionImage, validateRegionFirmware } from '../static/js/region.js';
import { decode } from '../static/js/decoder.js';
import { encode, MAX_APP_SIZE } from '../static/js/encoder.js';

const root = new URL('../static/', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
let failures = 0;
const check = (ok, text) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${text}`);
  failures += !ok;
};

check(manifest.format === 3 && manifest.releases.length > 0, 'manifest format 3 with releases');
for (const release of manifest.releases) {
  const app = readFileSync(new URL(release.app, root));
  check(app.length === release.app_size && app.length <= MAX_APP_SIZE,
      `${release.tag}: app size ${app.length}`);
  check(hash(app) === release.app_sha256, `${release.tag}: app SHA-256`);
  check(release.profile && release.profile.offset === 1024 && release.profile.size === (release.profile.version === 2 ? 4096 : 512) && [1, 2].includes(release.profile.version), `${release.tag}: profile metadata`);
  check(equal(encodeProfile(defaults(release.profile), release.profile), app.subarray(1024, 1024 + release.profile.size)), `${release.tag}: default profile equals firmware`);
  const ref = release.development ? release.source_commit : `refs/tags/${release.tag}`;
  const pinned = (file) => firmwareShow(ref, `beads/build/${file}`, { encoding: 'utf8' }).split('\n');
  let image = app;
  if (release.profile.region !== undefined) {
    const asset = release.content.region;
    const region = readFileSync(new URL(asset.url, root));
    check(hash(region) === asset.sha256 && pinned('expected-hashes.sha256').includes(`${asset.sha256}  region.bin`),
        `${release.tag}: stock region SHA-256 pinned in firmware`);
    for (const { kind, offset, size, sha256 } of release.profile.region.default_layout) {
      const section = region.subarray(offset, offset + size);
      check(section.length === size && hash(section) === sha256, `${release.tag}: ${kind} section SHA-256`);
    }
    check(pinned('expected-hashes.sha256').includes(`${hash(app)}  app.bin`),
        `${release.tag}: app SHA-256 pinned in firmware`);
    image = regionImage(app, region);
    check(pinned('expected-hashes.sha256').includes(`${hash(image)}  image.bin`),
        `${release.tag}: full image SHA-256 pinned in firmware`);
  }
  const wav = encode(image);
  check(equal(decode(wav, image.length), image), `${release.tag}: WAV decodes byte for byte`);
  const hasWavHash = release.wav_sha256 !== undefined;
  if (hasWavHash) {
    check(hash(wav) === release.wav_sha256, `${release.tag}: .wav byte-identical`);
    if (release.profile.region !== undefined && release.development && !release.binary_source_commit) {
      check(pinned('expected-wav.sha256').includes(`${release.wav_sha256}  app.wav`),
          `${release.tag}: .wav SHA-256 pinned in firmware`);
    }
  } else {
    check(release.development === true, `${release.tag}: missing release WAV hash`);
  }
  const header = firmwareShow(ref, 'beads/profile.h', { encoding: 'utf8' });
  try { validateProfileFormat(release, header); check(true, `${release.tag}: firmware profile format`); }
  catch { check(false, `${release.tag}: firmware profile format`); }
  // Options page capacity (page_leds) must match the firmware's slot bound.
  const pageBound = /\bkNumPageSlots\s*=\s*(\d+)\s*;/.exec(header);
  let pagesMatch;
  try { pagesMatch = Boolean(pageBound) && pageSlots(release.profile) === Number(pageBound[1]) - 1; } catch { pagesMatch = false; }
  check(pagesMatch, `${release.tag}: options page capacity matches the firmware`);
  // The [A] + FEEDBACK slot (feedback_slot) must match the firmware's amount slots.
  check((release.profile.feedback_slot === true) === /\bAMOUNT_FEEDBACK\b/.test(header) &&
      (release.profile.feedback_slot === true) === release.profile.features.some((f) => f.id === 40),
      `${release.tag}: [A] + FEEDBACK slot matches the firmware`);
  // A declared region (profile version 3) must match the blob firmware's constants.
  if (release.profile.region !== undefined) {
    const source = (file) => firmwareShow(ref, file, { encoding: 'utf8' });
    let matches;
    try {
      regionSupport(release.profile);
      validateRegionFirmware(release.profile.region, { profileHeader: header,
        catalog: source('beads/blob/plaits_catalog.cc'), blobHeader: source('beads/blob/plaits_blob.h') });
      matches = true;
    } catch { matches = false; }
    check(matches, `${release.tag}: region metadata matches the firmware`);
  }
  if (release.development) {
    check(/^drizzlet-dev-[0-9a-f]+$/.test(release.tag) && release.app.includes('-dev-') &&
        /unreleased/i.test(release.name), `${release.tag}: explicitly unreleased development entry`);
    if (release.binary_source_commit) {
      const changed = execFileSync('git', ['-C', firmwareRepo, 'diff', '--no-renames', '--name-only',
        release.binary_source_commit, release.source_commit], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
      check(changed.every((file) => /^beads\/(test\/|build\/(docs\/|release-notes\/|README\.(md|txt)$|expected-(hashes|wav)\.sha256$|tools\/options_(guide|tables_test)\.py$))/.test(file)),
          `${release.tag}: later source revision changes only documentation, pins and tests`);
      for (const [file, line] of [['expected-hashes.sha256', `${release.app_sha256}  app.bin`],
        ['expected-wav.sha256', `${release.wav_sha256}  app.wav`]]) {
        if (file === 'expected-wav.sha256' && !hasWavHash) continue;
        const pins = firmwareShow(release.source_commit, `beads/build/${file}`, { encoding: 'utf8' });
        check(pins.split('\n').includes(line), `${release.tag}: ${file} preserves the offered image`);
      }
    }
  } else {
    if (release.profile.region === undefined) {
      check(pinned('expected-hashes.sha256').includes(`${release.app_sha256}  app.bin`),
          `${release.tag}: app SHA-256 pinned at the tag`);
    }
    check(pinned('expected-wav.sha256').includes(`${release.wav_sha256}  app.wav`),
        `${release.tag}: .wav SHA-256 pinned at the tag`);
    const date = new Date(`${release.date}T00:00:00Z`);
    check(/^\d{4}-\d{2}-\d{2}$/.test(release.date) && !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === release.date, `${release.tag}: publication date set`);
  }
  if (release.cpu.estimate_reference) {
    const reference = release.cpu.estimate_reference;
    const source = firmwareShow(reference.source_commit, 'beads/profile.cc', { encoding: 'utf8' });
    const block = source.split('const volatile uint8_t kProfileBlock[kProfileSize]')[1].split('};')[0];
    const bytes = Uint8Array.from([...block.matchAll(/0x([0-9a-f]{2})/g)], (m) => parseInt(m[1], 16));
    // Decode the original producer bytes under their own header word; never re-encode history.
    const header = firmwareShow(reference.source_commit, 'beads/profile.h', { encoding: 'utf8' });
    const word = Number(/\bkProfile(?:ReleaseId|Format)\s*=\s*(0x[0-9a-f]+|\d+)\s*;/i.exec(header)?.[1]);
    let decoded = null;
    try { decoded = decodeProfile(bytes, { ...release.profile, format: word }); } catch { /* reported below */ }
    check(hash(bytes) === reference.profile_sha256 && new DataView(bytes.buffer).getUint32(8, true) === word &&
        JSON.stringify(decoded) === JSON.stringify(reference.profile),
        `${release.tag}: historical estimator defaults match their original firmware source`);
  }
}
let refused = false;
try {
  encode(new Uint8Array(MAX_APP_SIZE + 1));
} catch (error) {
  refused = error instanceof RangeError;
}
check(refused, 'an image reaching the frozen-buffer area is refused');
process.exit(failures ? 1 : 0);
