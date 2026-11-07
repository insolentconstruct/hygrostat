// Copyright 2026 Insolent Construct.
// MIT licence: see ../static/js/encoder.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { crc32, defaults, encodeProfile, decodeSettings, decodeProfile, decodeScaleBank, share, unshare, cpuUsage, featureDelta } from '../static/js/profile.js';
import { factoryScales, validateScales, importScala } from '../static/js/scales.js';
import { guide } from '../static/js/guide.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const original = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url))).releases[0];
const release = structuredClone(original);
release.profile.version = 2; release.profile.size = 4096;
release.profile.features.find((f) => f.id === 1).values = Array.from({ length: 16 }, (_, i) => `Scale ${i}`);
const profile = release.profile;
const entries = defaults(profile);
const scales = factoryScales();
const encode = (bank) => encodeProfile(entries, profile, bank);
const reseal = (bytes) => {
  const view = new DataView(bytes.buffer);
  const end = 16 + view.getUint16(6, true);
  view.setUint32(end, crc32(bytes.subarray(0, end)), true);
  return bytes;
};
for (const bank of [null, [], scales, scales.slice().reverse(), [
  { id: 15, name: 'Bohlen–Pierce', repeat: 12 * Math.log2(3), notes: [0, 1, 3.5, 9], color: [0, 1, 255], pulses: 2 }
]]) {
  const block = encode(bank);
  assert.equal(block.length, 4096);
  assert.deepEqual(decodeSettings(block, profile), { entries, scales: validateScales(bank) });
  assert.deepEqual(decodeProfile(block, profile), entries);
  assert.deepEqual(decodeScaleBank(block, profile), validateScales(bank));
  const shared = unshare(share(release, block), [release]);
  assert.deepEqual(shared.entries, entries);
  assert.deepEqual(shared.scales, validateScales(bank));
}
const full = Array.from({ length: 14 }, (_, i) => ({ id: i + 2, name: `Scale ${i}`, color: [i, 255, 0], pulses: i % 4,
  repeat: 12, notes: Array.from({ length: 24 }, (_, n) => n / 2) }));
assert.deepEqual(decodeScaleBank(encode(full), profile), full);
const malformed = [
  [...scales, scales[0]],
  [{ ...scales[0], id: 1 }], [{ ...scales[0], id: 16 }], [{ ...scales[0], name: '' }],
  [{ ...scales[0], name: 'x'.repeat(32) }], [{ ...scales[0], name: '\u0085' }], [{ ...scales[0], name: '\ud800' }],
  [{ ...scales[0], color: [256, 0, 0] }], [{ ...scales[0], pulses: 4 }],
  [{ ...scales[0], repeat: NaN }], [{ ...scales[0], repeat: Infinity }], [{ ...scales[0], repeat: 0 }],
  [{ ...scales[0], repeat: 0.001 }], [{ ...scales[0], notes: [-0, 7] }], [{ ...scales[0], notes: [0, 1e-40] }], [{ ...scales[0], repeat: 129 }], [{ ...scales[0], notes: [] }], [{ ...scales[0], notes: [1, 7] }],
  [{ ...scales[0], notes: [0, 7, 7] }], [{ ...scales[0], notes: [0, 12] }], [{ ...scales[0], notes: [0, NaN] }],
  [{ ...scales[0], notes: [0, 7, 7 + 1e-10] }], [...full, { ...full[0], id: 16 }]
];
for (const bank of malformed) assert.throws(() => encode(bank));
const valid = encode(scales);
const offset = 16 + entries.length * 6;
const corruptions = [[12, 2], [13, 15], [14, 1], [15, 1], [offset, 1], [offset + 1, 25],
  [offset + 5, 4], [offset + 6, 1], [offset + 7, 1], [offset + 43, 1], [offset + 139, 1], [offset + 143, 1]];
for (const [at, value] of corruptions) {
  const block = valid.slice(); block[at] = value;
  assert.throws(() => decodeSettings(reseal(block), profile), `corruption at ${at}`);
}
for (const bad of [-0, 1e-40]) {
  const block = valid.slice(); new DataView(block.buffer).setFloat32(offset + 44, bad, true);
  assert.throws(() => decodeSettings(reseal(block), profile));
}
for (const at of [offset + 8, offset + 44, offset + 48]) {
  const block = valid.slice(); new DataView(block.buffer).setFloat32(at, NaN, true);
  assert.throws(() => decodeSettings(reseal(block), profile));
}
const truncated = valid.subarray(0, 512);
assert.throws(() => decodeSettings(truncated, profile));
const tooLong = valid.slice(); tooLong[6] = 255; tooLong[7] = 255;
assert.throws(() => decodeSettings(tooLong, profile));
const defaultBlock = encode(null);
assert.equal(defaultBlock[12], 0); assert.equal(defaultBlock[13], 0);
const emptyBlock = encode([]);
assert.equal(emptyBlock[12], 1); assert.equal(emptyBlock[13], 0);
assert.notDeepEqual(defaultBlock, emptyBlock);
assert.deepEqual(decodeScaleBank(encode(scales.slice().reverse()), profile).map((s) => s.id), scales.map((s) => s.id).reverse());
const imported = importScala('! Comment\nSimple thirds\n3\n400.0\n3/2\n2/1\n', 10);
assert.equal(imported.repeat, 12);
assert.deepEqual(imported.notes, [0, 4, Math.fround(12 * Math.log2(1.5))]);
assert.throws(() => importScala('Wrong\n2\n1200.0\n700.0', 10));
assert.throws(() => importScala('Wrong\n1\n0/1', 10));
assert.throws(() => importScala('Wrong\n25\n', 10));
const missingDefault = entries.map((e) => e[0] === 1 ? [1, 2, 15, 1, 0, 0] : e);
assert.throws(() => encodeProfile(missingDefault, profile), /present/);
assert.throws(() => encodeProfile(missingDefault, profile, []), /present/);
assert.doesNotThrow(() => encodeProfile(missingDefault, profile, full));
const enabled = entries.map((e) => e[0] === 1 ? [1, 2, 15, 1, 0, 0] : e);
const customCPU = cpuUsage(enabled, release, full);
assert.equal(customCPU.percent, null); assert(customCPU.warning); assert.deepEqual(customCPU.unknown, ['Custom pitch scales']);
const unknownFeature = { ...profile.features[0], cpu: { kind: 'measured', engines: { synth: { off: 0, fixed: [0], adjustable: [0] } } } };
assert.equal(featureDelta([1, 1, 15], unknownFeature, 'synth'), null);
const legacyProfile = { ...original.profile, version: 1, size: 512,
  features: original.profile.features.filter((f) => f.id <= 23).map((f) =>
    f.id === 1 ? { ...f, values: f.values.slice(0, 10) } : f) };
assert.throws(() => encodeProfile(defaults(legacyProfile), legacyProfile, scales));
const legacy = encodeProfile(defaults(legacyProfile), legacyProfile);
assert.equal(legacy.length, 512); assert.deepEqual(decodeProfile(legacy, legacyProfile), defaults(legacyProfile));
assert.throws(() => unshare(share(release, legacy), [release]), /size/);
const embeddedLegacy = new Uint8Array(profile.size).fill(255);
embeddedLegacy.set(legacy);
assert.deepEqual(decodeSettings(embeddedLegacy, profile), { entries: defaults(legacyProfile), scales: null });
assert.throws(() => unshare(share(release, embeddedLegacy), [release]), /version mismatch/);
const wrongLegacyId = embeddedLegacy.slice(); wrongLegacyId[8] ^= 1; reseal(wrongLegacyId);
assert.throws(() => decodeSettings(wrongLegacyId, profile));
const wrongLegacyFlags = embeddedLegacy.slice(); wrongLegacyFlags[12] = 1; reseal(wrongLegacyFlags);
assert.throws(() => decodeSettings(wrongLegacyFlags, profile));
for (const mobile of [false, true]) {
  const svg = guide(enabled, release, '12345678', mobile, [{ ...full[0], name: '<Scale & test>', notes: [0, 7] }]);
  assert(svg.includes('&lt;Scale &amp; test&gt;'));
  assert(svg.includes('#00ff00'));
  assert(svg.includes('repeat 1200 cents'));
  assert(!svg.includes('<Scale & test>'));
  for (const character of ['\ufffe', '\uffff']) {
    const bank = [{ ...full[0], name: `Scale${character} & <test>`, notes: [0, 7] }];
    const block = encodeProfile(entries, profile, bank);
    const decoded = unshare(share(release, block), [release]);
    assert.equal(decoded.scales[0].name, bank[0].name);
    const drawing = guide(entries, release, '12345678', mobile, decoded.scales);
    assert(drawing.includes('Scale\ufffd &amp; &lt;test&gt;'));
    assert(!drawing.includes(character));
    assert.deepEqual(encodeProfile(decoded.entries, profile, decoded.scales), block);
  }
}
console.log('PASS V2 scale banks, malformed wire records, Scala import, stable order/identity, CPU provenance and guides; V1 round-trip retained.');
