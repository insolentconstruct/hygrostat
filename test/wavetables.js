// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
//
// The wavetable editor: factory bytes against wavetables.py and resources.cc,
// WAVE refusals, WAV import, resampling, preview and saved content.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo } from './firmware.js';
import { FACTORY, WAVES, WAVE_SIZE, TABLE_BYTES, MAX_IMPORT, factoryWave, factoryRows, factoryTable, factoryIntegrate, integrate,
  table, rows, shape, parseWav, resample, cycles, preview } from '../static/js/wavetables.js';
import { checkWaves, writeRegion, WAVE_ROW } from '../static/js/region.js';
import { encodeContent, decodeContent, readContent, saveContent, regionContent, CONTENT } from '../static/js/content.js';
import { terrain } from '../static/js/terrain.js';

// The drizzlet commit whose generator and resources.cc are compared (override with WAVETABLES_FIRMWARE_REF).
const ref = process.env.WAVETABLES_FIRMWARE_REF || '39532747124763440cf505622fa22f15c0e02b69';
const FACTORY_SHA256 = 'b2def01e627851aed92252e65ee60116cd141011fb6ec081da9cb2bf045e8bfc';
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const show = (file, options = {}) => execFileSync('git', ['-C', firmwareRepo, 'show', `${ref}:${file}`],
  { maxBuffer: 1 << 26, ...options });

// The factory table: pinned, equal to resources.cc and to wavetables.py run under numpy.
const factoryBytes = factoryTable();
assert.equal(factoryBytes.length, TABLE_BYTES);
assert.equal(sha256(factoryBytes), FACTORY_SHA256);
const resources = show('beads/resources.cc', { encoding: 'utf8' });
const values = resources.split('wav_integrated_waves[] = {')[1].split('};')[0].split(',').map((s) => s.trim())
  .filter(Boolean).map(Number);
assert.deepEqual(new Int16Array(factoryBytes.buffer), Int16Array.from(values), 'equals resources.cc');
const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-wavetables-'));
try {
  execFileSync('tar', ['-x', '-C', scratch], { input: execFileSync('git', ['-C', firmwareRepo, 'archive', ref,
    'beads/resources/wavetables.py', 'beads/resources/waves.bin']) });
  const generated = execFileSync(process.env.PYTHON || 'python3', ['-I',
    fileURLToPath(new URL('wavetables_py.py', import.meta.url)), 'beads/resources/wavetables.py'],
  { cwd: scratch, maxBuffer: 1 << 24 });
  assert.equal(sha256(generated), FACTORY_SHA256, 'equals wavetables.py output');
} finally {
  rmSync(scratch, { recursive: true });
}
assert.equal(FACTORY.length, 12);
assert(FACTORY.every(([, waves]) => waves.length === 16));
const factory = factoryRows();
assert.equal(Math.max(...factory.map((r) => Math.max(...Array.from(r, Math.abs)))), 26345, 'factory peak');

// Rows: factory integration, user normalization, guard samples, silence and refusals.
for (const r of factory) assert.deepEqual(r.subarray(0, 4), r.subarray(WAVE_SIZE));
assert.deepEqual(factoryIntegrate(factoryWave(17)), factory[17]);
assert(integrate(new Float64Array(WAVE_SIZE)).every((v) => v === 0), 'silence is a row of zeros');
assert(integrate(new Float64Array(WAVE_SIZE).fill(0.3)).every((v) => v === 0), 'a constant is silence');
const square = Float64Array.from({ length: WAVE_SIZE }, (_, i) => (i < 128 ? 1 : -1));
const rowPeak = (row) => Math.max(...Array.from(row, Math.abs));
const squareRow = integrate(square);
assert.equal(squareRow.length, 260);
assert(rowPeak(squareRow) <= 32767);
assert.equal(rowPeak(squareRow), 32767);
assert.deepEqual(squareRow.subarray(256), squareRow.subarray(0, 4));
for (let k = 1; k < WAVE_SIZE; ++k) {
  const pulse = Float64Array.from({ length: WAVE_SIZE }, (_, i) => (i < k ? 1 : -1));
  assert(rowPeak(integrate(pulse)) <= 32767, `pulse width ${k}`);
}
// A user wave lines up with the factory rows (same 4-sample start), within the 32767/32768 scale and truncation.
for (const i of [0, 37, 100]) {
  const user = integrate(factoryWave(i));
  assert(user.every((v, k) => Math.abs(v - factory[i][k]) <= 2), `wave ${i} aligns with the factory row`);
}
const quietRow = integrate(square.map((v) => v * 0.25));
assert(Math.abs(rowPeak(quietRow) - rowPeak(squareRow) / 4) < 1, 'quiet waves retain their amplitude');
const narrow = Float64Array.from({ length: WAVE_SIZE }, (_, i) => (i < 64 ? 1 : -1 / 3));
assert(integrate(narrow).every((v) => v >= -32768 && v <= 32767));
assert.throws(() => integrate(new Float64Array(255)), /256 samples/);
assert.throws(() => integrate(Array(256).fill(0)), /256 samples/);
assert.throws(() => integrate(new Float64Array(WAVE_SIZE).fill(NaN)), /not a number/);
assert.throws(() => integrate(new Float64Array(WAVE_SIZE).fill(Infinity)), /not a number/);
assert.throws(() => integrate(new Float64Array(WAVE_SIZE).fill(Number.MAX_VALUE)), RangeError);
const alternating = Float64Array.from({ length: WAVE_SIZE }, (_, i) => (i % 2 ? 1 : -1));
assert.deepEqual(integrate(alternating.map((v) => v * Number.MAX_VALUE)), integrate(alternating));

// The table: 192 rows plus the guard row; malformed tables are refused like the writer refuses them.
assert.throws(() => table(factory.slice(1)), /192 waves/);
assert.throws(() => table([...factory.slice(1), new Int16Array(259)]), /malformed/);
const broken = factory.slice();
broken[5] = Int16Array.from(factory[5]);
broken[5][257] += 1;
assert.throws(() => table(broken), /samples 0-3/);
assert.deepEqual(rows(factoryBytes), factory);
assert.throws(() => rows(factoryBytes.subarray(2)), /193 rows/);
const badGuard = Uint8Array.from(factoryBytes);
badGuard[TABLE_BYTES - 10] ^= 1;
assert.throws(() => rows(badGuard), /guard row/);
const badRow = Uint8Array.from(factoryBytes);
badRow[2 * WAVE_ROW * 3] ^= 1;
assert.throws(() => rows(badRow), /row 3/);
assert.throws(() => checkWaves(badRow));
const peak = shape(factory[0]).reduce((p, v) => Math.max(p, Math.abs(v)), 0);
assert.equal(peak, 1);
assert(shape(new Int16Array(WAVE_ROW)).every((v) => v === 0));

// WAV import: formats, padding and refusals.
function wav(format, bits, channels, frames, value, extra = []) {
  const bytes = bits / 8;
  const fmt = format === 0xfffe ? 40 : 16;
  const data = frames * bytes * channels;
  const buffer = new ArrayBuffer(12 + 8 + fmt + extra.length + 8 + data + (data & 1));
  const v = new DataView(buffer);
  const tag = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  v.setUint32(4, buffer.byteLength - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, fmt, true);
  v.setUint16(20, format, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, 48000, true);
  v.setUint16(34, bits, true);
  if (format === 0xfffe) {
    v.setUint16(44, 3, true);
    [0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71].forEach((b, i) => v.setUint8(46 + i, b));
  }
  let at = 20 + fmt;
  new Uint8Array(buffer).set(extra, at);
  at += extra.length;
  tag(at, 'data');
  v.setUint32(at + 4, data, true);
  for (let i = 0; i < frames; ++i) {
    for (let c = 0; c < channels; ++c) {
      const x = c ? -1 : value(i);
      const p = at + 8 + (i * channels + c) * bytes;
      if (format === 1 && bits === 8) v.setUint8(p, Math.round(x * 127) + 128);
      if (format === 1 && bits === 16) v.setInt16(p, Math.round(x * 32767), true);
      if (format === 1 && bits === 24) {
        const s = Math.round(x * 8388607);
        v.setUint8(p, s & 255);
        v.setUint8(p + 1, (s >> 8) & 255);
        v.setInt8(p + 2, s >> 16);
      }
      if (format === 1 && bits === 32) v.setInt32(p, Math.round(x * 2147483647), true);
      if (bits === 32 && format !== 1) v.setFloat32(p, x, true);
      if (bits === 64) v.setFloat64(p, x, true);
    }
  }
  return buffer;
}
const sine = (n) => (i) => Math.sin(2 * Math.PI * i / n) * 0.8;
for (const [format, bits, tolerance] of [[1, 8, 1 / 64], [1, 16, 1e-4], [1, 24, 1e-6], [1, 32, 1e-8], [3, 32, 1e-7],
  [3, 64, 0], [0xfffe, 32, 1e-7]]) {
  const samples = parseWav(wav(format, bits, 2, 601, sine(601), [0x4c, 0x49, 0x53, 0x54, 1, 0, 0, 0, 7, 0]));
  assert.equal(samples.length, 601, `${format}:${bits}`);
  assert(samples.every((x, i) => Math.abs(x - sine(601)(i)) <= tolerance), `${format}:${bits} reads the first channel`);
}
assert.throws(() => parseWav(new ArrayBuffer(8)), /Not a WAV/);
assert.throws(() => parseWav(new Uint8Array(64).buffer), /Not a WAV/);
assert.throws(() => parseWav(wav(2, 16, 1, 10, sine(10))), /PCM or float/);
assert.throws(() => parseWav(wav(1, 12, 1, 10, sine(10))), /PCM or float/);
assert.throws(() => parseWav(wav(1, 16, 1, 0, sine(10))), /no audio/);
assert.throws(() => parseWav(wav(1, 16, 1, 10, sine(10)).slice(0, 60)), /cut short/);
assert.throws(() => parseWav(new ArrayBuffer(MAX_IMPORT + 1)), /4 MB/);
const longer = wav(1, 16, 1, 10, sine(10));
new DataView(longer).setUint32(4, longer.byteLength, true);
assert.throws(() => parseWav(longer), /cut short/, 'RIFF size beyond the file');
const shorter = wav(1, 16, 1, 10, sine(10));
new DataView(shorter).setUint32(4, 30, true);
assert.throws(() => parseWav(shorter), /cut short|no audio/, 'chunks beyond the RIFF size');
const odd = wav(1, 16, 2, 10, sine(10));
new DataView(odd).setUint32(40, 39, true);
assert.throws(() => parseWav(odd), /cut short/, 'an incomplete frame');
const guid = wav(0xfffe, 32, 1, 10, sine(10));
new DataView(guid).setUint8(57, 0);
assert.throws(() => parseWav(guid), /PCM or float/, 'a non-KSDATAFORMAT subformat');
assert.throws(() => parseWav(wav(3, 32, 1, 10, () => NaN)), /not a number/);
assert.throws(() => parseWav('RIFF'), /4 MB|Not a WAV/);

// Resampling to 256 samples keeps a sine; cycles split banks of 256-sample waves.
const resampled = resample(Float64Array.from({ length: 1000 }, (_, i) => sine(1000)(i)));
assert.equal(resampled.length, WAVE_SIZE);
assert(resampled.every((x, i) => Math.abs(x - sine(WAVE_SIZE)(i)) < 1e-9));
const aligned = resample(Float64Array.from({ length: 1000 }, (_, i) => Math.cos(2 * Math.PI * i / 1000)), true);
assert(aligned.every((x, i) => Math.abs(x - Math.sin(2 * Math.PI * i / WAVE_SIZE)) < 1e-9), 'phases aligned to sine');
assert(resample(Float64Array.from({ length: 20000 }, (_, i) => sine(20000)(i))).every(Number.isFinite), 'long files are cut to 8192');
assert.equal(cycles(new Float64Array(512)).length, 2);
assert.equal(cycles(new Float64Array(4096)).length, 16);
assert.throws(() => cycles(new Float64Array(300)), /1 to 16 cycles/);
assert.throws(() => cycles(new Float64Array(17 * 256)), /1 to 16 cycles/);
assert.throws(() => cycles(new Float64Array(0)), /1 to 16 cycles/);

// Preview: the factory sine plays at the asked pitch, bounded.
const tone = preview(factory.slice(0, 16), 0, 480 / 48000, 48000);
assert.equal(tone.length, 48000);
assert(tone.every(Number.isFinite));
let crossings = 0;
for (let i = 1; i < tone.length; ++i) if (tone[i - 1] < 0 && tone[i] >= 0) ++crossings;
assert(Math.abs(crossings - 480) <= 1, `sine preview at 480 Hz: ${crossings}`);
assert(Math.max(...tone.map(Math.abs)) < 1.5);
for (let b = 0; b < 12; ++b) {
  assert(preview(factory.slice(16 * b, 16 * b + 16), 1, 0.4, 2000).every(Number.isFinite), `bank ${b} at the end`);
}

// Saved content and the writer's payloads.
const store = (items = {}) => ({ getItem: (k) => items[k] ?? null, setItem: (k, v) => { items[k] = v; },
  removeItem: (k) => { delete items[k]; }, items });
const empty = store();
assert.equal(readContent(empty), null);
assert.deepEqual(regionContent(empty), { wave: null, terrain: null });
const edited = factory.slice();
edited[40] = integrate(narrow);
const custom = table(edited);
const terrains = [{ equation: 'x * y', grid: terrain('x * y') }, { equation: null, grid: terrain('r') }];
const saved = store();
saveContent(saved, { wave: custom, terrains });
assert.deepEqual(decodeContent(saved.items[CONTENT]).wave, custom);
assert.deepEqual(decodeContent(saved.items[CONTENT]).terrains, terrains);
const payloads = regionContent(saved);
assert.deepEqual(payloads.wave, custom);
assert.equal(payloads.terrain.length, 2 * 4096);
saveContent(saved, { wave: null, terrains: [] });
assert.equal(saved.items[CONTENT], undefined, 'nothing custom leaves nothing saved');
const tamper = (edit) => {
  const content = JSON.parse(encodeContent({ wave: custom, terrains }));
  edit(content);
  return store({ [CONTENT]: JSON.stringify(content) });
};
for (const bad of [
  (c) => { c.v = 2; },
  (c) => { c.wave = c.wave.slice(0, -8); },
  (c) => { c.terrain = c.terrain.slice(0, -8); },
  (c) => { c.equations.pop(); },
  (c) => { c.equations[0] = 'constructor'; },
  (c) => { c.equations = 'x'; }
]) {
  const s = tamper(bad);
  assert(readContent(s).error, 'damaged content is reported');
  assert.throws(() => regionContent(s), /damaged/);
}
assert(readContent(store({ [CONTENT]: '{' })).error);
assert.equal(readContent({ getItem: () => { throw new Error('blocked'); } }), null);
assert.throws(() => encodeContent({ wave: custom.subarray(2), terrains: [] }));

// The writer takes the editor's table: the default region's WAVE is the factory bytes verbatim.
const { region } = writeRegion({ release: 20261121, wave: factoryBytes });
assert.deepEqual(region.subarray(32, 32 + TABLE_BYTES), factoryBytes);
writeRegion({ release: 20261121, wave: custom, terrain: payloads.terrain });
assert.equal(WAVES, 192);
console.log(`wavetables: factory table ${FACTORY_SHA256.slice(0, 12)} equals wavetables.py and resources.cc at ${ref.slice(0, 7)}; ok`);
