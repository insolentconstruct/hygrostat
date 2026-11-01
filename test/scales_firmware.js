// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Differential acceptance and decoded scale values against the current firmware parser.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, defaults, encodeProfile, decodeSettings } from '../static/js/profile.js';
import { factoryScales, effectiveScales, readScales } from '../static/js/scales.js';
const firmware = resolve(process.env.FIRMWARE_REPO || './firmware');
const release = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url))).releases[0];
const profile = { ...release.profile, version: 2, size: 4096,
  features: release.profile.features.map((f) => f.id === 1 ? { ...f, values: Array.from({ length: 16 }, (_, i) => `Scale ${i}`) } : f) };
const entries = defaults(profile);
const factory = factoryScales();
const encode = (bank) => encodeProfile(entries, profile, bank);
const samples = [encode(null), encode([]), encode(factory), encode(factory.slice().reverse()),
  encode([{ ...factory[0], id: 15, name: 'Microtonal é', repeat: 19.01955, notes: [0, 0.01, 7.5, 19] }]),
  encode([{ ...factory[0], name: ' ', repeat: Math.fround(0.01), notes: [0] }]),
  encode(Array.from({ length: 14 }, (_, i) => ({ ...factory[0], id: i + 2, name: `User ${i}`,
    notes: Array.from({ length: 24 }, (_, n) => n / 2) })))];
const reseal = (b) => {
  const view = new DataView(b.buffer);
  const end = 16 + view.getUint16(6, true);
  if (end + 4 <= b.length) view.setUint32(end, crc32(b.subarray(0, end)), true);
  return b;
};
const offset = 16 + entries.length * 6;
const wire = encode(factory);
for (let at = 0; at < offset + 144 * factory.length + 4; ++at) {
  for (const change of [1, 128]) {
    const b = wire.slice(); b[at] ^= change; samples.push(reseal(b));
  }
}
for (const at of [offset + 8, offset + 44, offset + 48]) {
  for (const value of [-0, NaN, Infinity, -Infinity, 1e-40, -1e-40, 0.001, 0.01, 128, 129]) {
    const b = wire.slice(); new DataView(b.buffer).setFloat32(at, value, true); samples.push(reseal(b));
  }
}
for (const name of [[0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xc2, 0x85], [0xc2, 0xa0], [0xef, 0xbb, 0xbf]]) {
  const b = wire.slice(); b.fill(0, offset + 12, offset + 44); b.set(name, offset + 12); samples.push(reseal(b));
}
const scratch = mkdtempSync(join(tmpdir(), 'scales-oracle-'));
try {
  const oracle = join(scratch, 'oracle');
  execFileSync('g++', ['-std=c++98', '-O1', '-Wall', '-Werror', '-I' + firmware,
    fileURLToPath(new URL('scales_oracle.cc', import.meta.url)), join(firmware, 'beads/profile.cc'), '-o', oracle]);
  const stride = 3 + 14 * 144;
  const answers = execFileSync(oracle, [], { input: Buffer.concat(samples), maxBuffer: samples.length * stride + 1 });
  assert.equal(answers.length, samples.length * stride);
  samples.forEach((b, i) => {
    let decoded;
    try { decoded = decodeSettings(b, profile); } catch {}
    assert.equal(Boolean(decoded), answers[i * stride] === 1, `firmware acceptance case ${i}`);
    if (decoded) {
      assert.equal(answers[i * stride + 1], Number(decoded.scales !== null));
      const count = answers[i * stride + 2];
      assert.equal(count, effectiveScales(decoded.scales).length);
      const records = Uint8Array.from(answers.subarray(i * stride + 3, (i + 1) * stride));
      assert.deepEqual(readScales(records, 0, count), effectiveScales(decoded.scales), `firmware decoded scales case ${i}`);
    }
  });
  console.log(`PASS ${samples.length} V2 firmware differential cases: acceptance, bank order, names, repeat, degrees, RGB and pulses.`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
