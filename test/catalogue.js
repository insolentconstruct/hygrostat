// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Catalogue format 2 against the firmware that generates it: the manifest
// digest, the firmware's definitions, its factory profile through Hygrostat's
// encoder, and the shared profile cases through both codecs.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { readCatalogue, catalogueAtRef, catalogueFeatures, firmwareDefinitions, checkDefinitions,
  CATALOGUE, MANIFEST } from '../tools/catalogue.js';
import { validate, encodeProfile, decodeProfile, defaults, equal, crc32, pageSlots,
  validateProfileFormat } from '../static/js/profile.js';
const read = (file) => readFileSync(new URL(file, import.meta.url));
// The firmware commit that introduced format 2 (override with CATALOGUE_FIRMWARE_REF).
const ref = process.env.CATALOGUE_FIRMWARE_REF || '44b7191718136a5dd628c2deb40504cea3f1ae87';
const show = (r, file) => firmwareShow(r, file, { stdio: ['ignore', 'pipe', 'pipe'] });
const text = (file) => show(ref, file).toString('utf8');

// The catalogue names the manifest it came from; malformed ones are refused.
const catalogue = catalogueAtRef(show, ref);
assert.equal(catalogue.format, 2);
const bytes = show(ref, CATALOGUE), manifestBytes = show(ref, MANIFEST);
assert.throws(() => readCatalogue(bytes, Buffer.concat([manifestBytes, Buffer.from('\n')])), /not generated from this/);
for (const [change, message] of [
  [(c) => { c.format = 3; }, /Unsupported catalogue format/],
  [(c) => { c.manifest_sha256 = c.manifest_sha256.toUpperCase(); }, /header/],
  [(c) => { c.record_version = 0; }, /header/],
  [(c) => { c.features[1].saved = c.features[0].saved; }, /already used/],
  [(c) => { c.features[1].saved = 56; }, /out of range/],
  [(c) => { c.features[1].field = 1; }, /unexpected fields/],
  [(c) => { delete c.features[1].saved; }, /unexpected fields/],
  [(c) => { c.features[1].id = 3; }, /IDs/],
  [(c) => { c.features[0].factory[2] = 5; }, /factory/],
  [(c) => { c.features[0].states = ['On']; }, /states/],
  [(c) => { c.features[0].cpu_cost = 1; }, /costs/]
]) {
  const forged = JSON.parse(bytes.toString('utf8')); change(forged);
  assert.throws(() => readCatalogue(Buffer.from(JSON.stringify(forged))), message);
}
// The page's own copy (Beta 2) is format 1 and still reads.
assert.equal(readCatalogue(read('../static/profile-features.json')).format, 1);

// Every row agrees with the firmware's definitions; a saved feature has its record byte.
const definitions = firmwareDefinitions(text);
checkDefinitions(catalogue, definitions);
const unsaved = structuredClone(catalogue);
unsaved.features.find((c) => c.id === 31).saved = null;
assert.throws(() => checkDefinitions(unsaved, definitions), /31 differs/);

// A synthetic release built from the catalogue alone; it is never offered.
const manifest = JSON.parse(read('../static/manifest.json'));
const release = structuredClone(manifest.releases.find((r) => r.slug === 'beta-3-smirr'));
Object.assign(release, { tag: 'drizzlet-dev-catalogue', name: 'Synthetic fixture (never offered)',
  development: true, source_commit: ref });
release.profile.features = catalogueFeatures(catalogue);
Object.assign(release.profile, { hold_rules: true, feedback_slot: true });
validateProfileFormat(release, text('beads/profile.h'));
assert(catalogue.features.every((c) => [0, pageSlots(release.profile)].includes(c.page_slots.length)));

// Hygrostat encodes the factory entries to the firmware's own block.
const factory = defaults(release.profile);
assert.deepEqual(factory, catalogue.features.filter((c) => c.factory).map((c) => c.factory));
const block = Uint8Array.from(text('beads/profile.cc').split('kProfileBlock[kProfileSize]')[1].split('};')[0]
  .match(/0x([0-9a-f]{2})/g), (v) => parseInt(v, 16));
assert.equal(block.length, 4096);
assert(equal(encodeProfile(factory, release.profile), block));

// The shared cases: Hygrostat's encoder and decoder, and the firmware's parser.
const reseal = (b) => {
  const v = new DataView(b.buffer), end = 16 + v.getUint16(6, true);
  v.setUint32(end, crc32(b.subarray(0, end)), true);
  return end;
};
const cases = text('beads/test/profile_cases.txt').split('\n').filter((l) => l && !l.startsWith('#')).map((line) => {
  const [head, list] = line.split(' : ').length === 2 ? line.split(' : ') : [line.replace(/ :$/, ''), ''];
  const [verdict, name, ...flags] = head.split(' ');
  assert(['accept', 'reject'].includes(verdict), line);
  const entries = list.trim() ? list.split(',').map((e) => e.trim().split(' ').map(Number)) : [];
  assert(entries.every((e) => e.length === 6 && e.every(Number.isInteger)), line);
  const b = encodeProfile([], release.profile);
  b[5] = entries.length; new DataView(b.buffer).setUint16(6, 6 * entries.length, true);
  entries.forEach((e, i) => b.set(e, 16 + 6 * i));
  for (const flag of flags) {
    if (flag.startsWith('format=')) new DataView(b.buffer).setUint32(8, Number(flag.slice(7)), true);
    else assert.equal(flag, 'crc', line);
  }
  const end = reseal(b);
  if (flags.includes('crc')) b[end] ^= 1;
  return { accept: verdict === 'accept', name, flags, entries, block: b };
});
assert(cases.filter((c) => c.accept).length >= 15 && cases.filter((c) => !c.accept).length >= 20);
for (const c of cases) {
  let decoded = null;
  try { decoded = decodeProfile(c.block, release.profile); } catch { /* refused */ }
  assert.equal(Boolean(decoded), c.accept, `Hygrostat decoder: ${c.name}`);
  if (decoded) assert.deepEqual(decoded, c.entries, c.name);
  if (!c.flags.length) {
    let encoded = null;
    try { encoded = encodeProfile(c.entries, release.profile); } catch { /* refused */ }
    assert.equal(Boolean(encoded), c.accept, `Hygrostat encoder: ${c.name}`);
    if (encoded) assert(equal(encoded, c.block), c.name);
    const valid = (() => { try { validate(c.entries, release.profile); return true; } catch { return false; } })();
    // validate() leaves the scale bank to the encoder.
    assert.equal(valid, c.accept || c.name === 'pitch-scale-not-in-bank', `validate: ${c.name}`);
  }
}
const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-catalogue-oracle-'));
try {
  mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
  for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) writeFileSync(join(scratch, 'beads', file), show(ref, 'beads/' + file));
  const oracle = join(scratch, 'profile-oracle');
  execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
    fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', oracle]);
  const answers = execFileSync(oracle, [], { input: Buffer.concat(cases.map((c) => Buffer.from(c.block))) });
  const stride = 493;
  assert.equal(answers.length, cases.length * stride);
  cases.forEach((c, i) => {
    assert.equal(answers[i * stride] === 1, c.accept, `firmware parser: ${c.name}`);
    if (c.accept) {
      assert.deepEqual(c.entries.flat(), Array.from(answers.subarray(i * stride + 1, i * stride + 1 + c.entries.length * 6)), c.name);
    }
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`PASS catalogue format 2 at ${ref.slice(0, 7)}: manifest digest, ${catalogue.features.length} firmware definitions, factory block and ${cases.length} shared profile cases in both codecs`);
