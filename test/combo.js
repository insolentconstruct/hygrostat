// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// MIT licence: see static/js/encoder.js.
//
// ST-Link combo files: for every release, the default profile's combo .bin
// and .hex equal the release files byte for byte (hashes pinned at the tag and
// from the release's SHA256SUMS); a custom profile changes only its block; the
// HEX parses back to the .bin; a wrong bootloader or layout is refused.
// COMBO_RELEASE_DIR=<dir with <tag>-combo.bin/.hex> also compares the files.
//
// node test/combo.js

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { firmwareShow, firmwareRef } from './firmware.js';
import { comboImages, comboHex, parseHex, COMBO_ADDRESS, BOOTLOADER_SIZE } from '../static/js/combo.js';
import { defaults, encodeProfile, equal, filenames, fingerprint, templates } from '../static/js/profile.js';

const root = new URL('../static/', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root)));
const releaseDir = process.env.COMBO_RELEASE_DIR;
const rejects = async (promise, pattern) => assert.rejects(promise, pattern);
let checked = 0;

for (const release of manifest.releases) {
  if (release.development && !release.combo) continue;
  const { combo, tag } = release;
  const app = new Uint8Array(readFileSync(new URL(release.app, root)));
  const bootloader = new Uint8Array(readFileSync(new URL(combo.bootloader, root)));
  const pins = firmwareShow(firmwareRef(release), 'beads/build/expected-hashes.sha256', { encoding: 'utf8' }).split('\n');
  assert.equal(hash(bootloader), combo.bootloader_sha256, `${tag}: bootloader asset`);
  assert(pins.includes(`${combo.bootloader_sha256}  bootloader-padded.bin`), `${tag}: padded bootloader pinned at the tag`);
  assert(pins.includes(`${combo.bin_sha256}  combo.bin`), `${tag}: combo.bin pinned at the tag`);

  // The untouched default is the release's combo, as release_package.py checks it.
  const { bin, hex } = await comboImages(release, bootloader, app.slice());
  assert.equal(hash(bin), combo.bin_sha256, `${tag}: combo .bin byte-identical`);
  assert.equal(hash(hex), combo.hex_sha256, `${tag}: combo .hex byte-identical`);
  if (releaseDir) {
    for (const [suffix, bytes] of [['bin', bin], ['hex', hex]]) {
      const file = join(releaseDir, `${tag}-combo.${suffix}`);
      assert(existsSync(file), file);
      assert(equal(new Uint8Array(readFileSync(file)), bytes), `${tag}: equals the release's ${file}`);
    }
    const layout = execFileSync(process.execPath, [new URL('../tools/combo-layout.js', import.meta.url).pathname,
      join(releaseDir, `${tag}-combo.hex`)], { encoding: 'utf8' });
    assert.deepEqual(JSON.parse(layout), combo.hex, `${tag}: manifest layout from the release HEX`);
  }
  assert(equal(bin.subarray(0, BOOTLOADER_SIZE), bootloader) && equal(bin.subarray(BOOTLOADER_SIZE), app));
  const text = new TextDecoder().decode(hex);
  const parsed = parseHex(text);
  assert.equal(parsed.address, COMBO_ADDRESS);
  assert(equal(parsed.bytes, bin), `${tag}: HEX parses back to the .bin`);
  assert.deepEqual(parsed.starts, combo.hex.map((part) => parseInt(part.start, 16)), `${tag}: start address records`);
  const lines = text.split('\r\n');
  assert.equal(lines[0], ':020000040802F0', `${tag}: the app part opens at 0x0802xxxx`);
  assert.equal(lines.at(-1), ':00000001FF\n', `${tag}: one final EOF record`);
  assert.equal(text.match(/:00000001FF/g).length, 1);
  assert(lines.slice(0, -1).every((l) => /^:[0-9A-F]+$/.test(l)), `${tag}: CRLF records only`);
  assert(lines.includes(':020000040800F2'), `${tag}: the bootloader part at 0x0800xxxx`);
  for (const line of lines.slice(0, -1)) {
    const bytes = Buffer.from(line.slice(1), 'hex');
    assert.equal(bytes.reduce((a, v) => a + v, 0) & 0xff, 0, `${tag}: record checksum ${line}`);
    assert(bytes[0] <= 16 && bytes.length === bytes[0] + 5);
  }

  // A custom profile: the release combo with only the profile block changed.
  const entries = Object.values(templates(release.profile)).find((e) =>
    !equal(encodeProfile(e, release.profile), encodeProfile(defaults(release.profile), release.profile)));
  const block = encodeProfile(entries, release.profile);
  const custom = app.slice();
  custom.set(block, release.profile.offset);
  const mine = await comboImages(release, bootloader, custom);
  const offset = BOOTLOADER_SIZE + release.profile.offset;
  assert(equal(mine.bin.subarray(0, BOOTLOADER_SIZE), bootloader));
  assert(equal(mine.bin.subarray(BOOTLOADER_SIZE), custom));
  assert(equal(mine.bin.subarray(offset, offset + release.profile.size), block));
  assert(!equal(mine.bin, bin) && equal(mine.bin.subarray(0, offset), bin.subarray(0, offset)) &&
      equal(mine.bin.subarray(offset + release.profile.size), bin.subarray(offset + release.profile.size)),
  `${tag}: custom combo differs only in the profile block`);
  const mineLines = new TextDecoder().decode(mine.hex).split('\r\n');
  assert.equal(mineLines.length, lines.length, `${tag}: custom HEX keeps the record layout`);
  const changed = mineLines.flatMap((l, n) => l === lines[n] ? [] : [n]);
  assert(changed.length > 0);
  for (const n of changed) {
    const at = 0x08020000 + parseInt(mineLines[n].slice(3, 7), 16);
    assert(mineLines[n].slice(0, 9) === lines[n].slice(0, 9) && at >= COMBO_ADDRESS + offset &&
        at < COMBO_ADDRESS + offset + release.profile.size, `${tag}: changed HEX record ${n} is in the profile block`);
  }
  assert(equal(parseHex(new TextDecoder().decode(mine.hex)).bytes, mine.bin));
  const fp = await fingerprint(block);
  assert.equal(filenames(release, fp, false).comboHex, `${tag}-${fp}-combo.hex`);
  assert.equal(filenames(release, fp, false).comboBin, `${tag}-${fp}-combo.bin`);
  assert.equal(filenames(release, fp, true).comboHex, `${tag}-combo.hex`);
  assert.equal(filenames(release, fp, true).comboBin, `${tag}-combo.bin`);

  // Negative controls: another bootloader, a layout that skips bytes, a damaged HEX.
  const wrong = bootloader.slice();
  wrong[0x100] ^= 1;
  await rejects(comboImages(release, wrong, app.slice()), /bootloader image does not match/);
  await rejects(comboImages(release, bootloader.subarray(0, BOOTLOADER_SIZE - 1), app.slice()), /bootloader image does not match/);
  await rejects(comboImages({ ...release, combo: { ...combo, bootloader_sha256: '0'.repeat(64) } }, bootloader, app.slice()),
      /bootloader image does not match/);
  const skipping = structuredClone(combo.hex);
  skipping[0].ranges.splice(1, 1);
  await rejects(comboImages({ ...release, combo: { ...combo, hex: skipping } }, bootloader, app.slice()),
      /does not program the combo image/);
  const overlapping = structuredClone(combo.hex);
  overlapping[0].ranges[1][0] = overlapping[0].ranges[0][0];
  assert.throws(() => comboHex(bin, overlapping), /layout/);
  const past = structuredClone(combo.hex);
  past[0].ranges.at(-1)[1] += 1;
  assert.throws(() => comboHex(bin, past), /layout/);
  const crc = text.replace(':020000040802F0', ':020000040802F3');
  assert.throws(() => parseHex(crc), /checksum/);
  assert.throws(() => parseHex(text.slice(0, -':00000001FF\n'.length)), /end-of-file/);
  assert.throws(() => parseHex(text.replace(':020000040800F2', ':020000020800F4')), /record type 2/);
  assert.throws(() => parseHex(text.replace(/\r\n(:[^\r]+)\r\n/, '\r\n$1\r\n$1\r\n')), /overlapping/);
  checked++;
  console.log(`PASS ${tag}: combo .bin ${combo.bin_sha256.slice(0, 8)} and .hex ${combo.hex_sha256.slice(0, 8)} byte-identical; custom ${fp} changes ${changed.length} records`);
}
assert(checked === manifest.releases.filter((r) => !r.development).length && checked > 0);
console.log(`PASS combo files for ${checked} releases${releaseDir ? ', compared with the release files' : ''}`);
