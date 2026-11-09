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
import { decodeProfile, defaults, encodeProfile, equal, validateProfileFormat } from '../static/js/profile.js';
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
  const wav = encode(app);
  check(equal(decode(wav, app.length), app), `${release.tag}: WAV decodes byte for byte`);
  check(hash(wav) === release.wav_sha256, `${release.tag}: .wav byte-identical`);
  const ref = release.development ? release.source_commit : `refs/tags/${release.tag}`;
  const header = firmwareShow(ref, 'beads/profile.h', { encoding: 'utf8' });
  try { validateProfileFormat(release, header); check(true, `${release.tag}: firmware profile format`); }
  catch { check(false, `${release.tag}: firmware profile format`); }
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
        const pins = firmwareShow(release.source_commit, `beads/build/${file}`, { encoding: 'utf8' });
        check(pins.split('\n').includes(line), `${release.tag}: ${file} preserves the offered image`);
      }
    }
  } else {
    const pinned = (file) => firmwareShow(`refs/tags/${release.tag}`, `beads/build/${file}`,
        { encoding: 'utf8' }).split('\n');
    check(pinned('expected-hashes.sha256').includes(`${release.app_sha256}  app.bin`),
        `${release.tag}: app SHA-256 pinned at the tag`);
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
