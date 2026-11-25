// Copyright 2026 Insolent Construct.
// Portions copyright 2016 and 2022 Emilie Gillet (beads/resources/wavetables.py,
// plaits-editor wavetable.js), under the same licence.
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
// Beads wavetables (WAVE): Mutable Instruments' factory waves and integration, and
// WAV import and resampling after their Plaits editor, at 256 samples.
import { checkWaves, WAVE_ROWS, WAVE_ROW } from './region.js?v=0c0f009b84546262';

export const WAVE_SIZE = 256;
export const BANKS = 12;
export const WAVES_PER_BANK = 16;
export const WAVES = BANKS * WAVES_PER_BANK;
export const TABLE_BYTES = WAVE_ROWS * WAVE_ROW * 2;
export const MAX_IMPORT = 4 * 1024 * 1024;
// Longest single cycle read from a WAV, as in the Plaits editor.
export const MAX_CYCLE = 8192;

// Rows 172-234 of beads/resources/waves.bin (Braids' waves), 128 bytes each.
const BRAIDS_FIRST = 172;
const BRAIDS = Uint8Array.from(atob('GBkbHB0fICEiJCUmKCkqLC0vMDEzNDY3OTo8PT9AQkNFRkhJS0xOUFFTVFZYWVtdXmBiY2VnaGpsbm9xc3V3eHp8foCCg4WHiYuNj5GTlZeZmpyeoKKkp6mrra+xs7W3ubu9wMLExsjKzc/R09XY2tze4ePl6Ors7vHz9fj6/f8CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICgP///////////////////////////////////////////////////////////////////////////////////wAGDRMZHyYsMjc9Q0hNUldcYGRobG9ydXh6fH5/gIGBgoGBgH9+fHp4dXJvbGhkYFxXUk1IQz03MiwmHxkTDQYA/fbw6uTd19HMxsC7trGsp6Ofm5eUkY6LiYeFhIOCgoKCgoOEhYeJi46RlJebn6OnrLG2u8DGzNHX3eTq8Pb9gICAgICAgICwsLCwsLCwsNra2tra2tra9fX19fX19fX///////////X19fX19fX12tra2tra2tqwsLCwsLCwsICAgICAgICAT09PT09PT08lJSUlJSUlJQoKCgoKCgoKAAAAAAAAAAAKCgoKCgoKCiUlJSUlJSUlT09PT09PT09/hoySmJ6lqrC2vMHGy9DV2t7i5urt8PP1+Pr7/f7+/////v79+/r49fPw7erm4t7a1dDLxsG8trCqpZ6YkoyGgHlzbWdhWlVPSUM+OTQvKiUhHRkVEg8MCgcFBAIBAQAAAAEBAgQFBwoMDxIVGR0hJSovNDk+Q0lPVVphZ21zeYCAgICAgYOEh4mNkZWaoKats7rCydDX3uTq7/T4+/3////9+/j07+rk3tfQycK6s62moJqVkY2Jh4SDgYCAgICAf39/f358e3h2cm5qZV9ZUkxFPTYvKCEbFRALBwQCAAAAAgQHCxAVGyEoLzY9RUxSWV9lam5ydnh7fH5/f39/gICAgICAgICBgYKEhomNkZaco6qyu8TM1d7m7fP4/P7//vz48+3m3tXMxLuyqqOclpGNiYaEgoGBgICAgICAgIB/f39/f39/fn59e3l2cm5pY1xVTUQ7MyohGRIMBwMBAAEDBwwSGSEqMztETVVcY2lucnZ5e31+fn9/f39/f38ABAgMEBQYHCAkKC0xNTk9QUVJTVFVWV1hZWltcXV5fYKGio6SlpqeoqaqrrK2ur7CxsrO0tfb3+Pn6+/z9/v///v38+/r5+Pf29fSzsrGwr66trKuqqainpqWko6KhoJ9eXVxbWllYV1ZVVFNSUVBPTk1MS0oJCAcGBQQDAgEABgaHSAiJSgqLTAzNjk8P0JFSEtOUVVYW19iZmltcHR3e3+DhoqOkpaanqKmqq6ytru/w8jM0dXa3uPn7PH1+v8YGh0gIiUoKi0wMzY5PD9CRUhLTlFVWFtfYmZpbXB0d3t/g4aKjpKWmp6ipqqusra7v8PIzNHV2t7j5+zx9fr/BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBASB/////////////////////////////////////////wQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEgf////////////////////////////////////////8ADRomMj5JU11mbXR6foGDhIOBfnp0bWZdU0k+MiYaDQD67uHVyb60qqGak46JhoSEhIaJjpOaoaq0vsnV4e76AA0aJjI+SVNdZm10en6Bg4SDgX56dG1mXVNJPjImGg0A+u7h1cm+tKqhmpOOiYaEhISGiY6TmqGqtL7J1eHu+oCAgICwsLCw2tra2vX19fX/////9fX19dra2tqwsLCwgICAgE9PT08lJSUlCgoKCgAAAAAKCgoKJSUlJU9PT0+AgICAsLCwsNra2tr19fX1//////X19fXa2trasLCwsICAgIBPT09PJSUlJQoKCgoAAAAACgoKCiUlJSVPT09PgIyYpbC8xtDa4urw9fr9/v/+/fr18Ori2tDGvLClmIyAc2daT0M5LyUdFQ8KBQIBAAECBQoPFR0lLzlDT1pnc4CMmKWwvMbQ2uLq8PX6/f7//v369fDq4trQxrywpZiMgHNnWk9DOS8lHRUPCgUCAQABAgUKDxUdJS85Q09aZ3OAgICDh42VoK26ydfk7/j9//347+TXybqtoJWNh4OAgIB/f3x4cmpfUkU2KBsQBwIAAgcQGyg2RVJfanJ4fH9/gICAg4eNlaCtusnX5O/4/f/9+O/k18m6raCVjYeDgICAf398eHJqX1JFNigbEAcCAAIHEBsoNkVSX2pyeHx/f4CAgICBgoaN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'), (c) => c.charCodeAt(0));

const phase = Float64Array.from({ length: WAVE_SIZE }, (_, i) => i / WAVE_SIZE);
const map = (fn) => Float64Array.from(phase, fn);
const add = (x, y) => x.map((v, i) => v + y[i]);
const scale = (x, k) => x.map((v) => v * k);

// numpy's pairwise sum after its first element, as numpy's mean reduces.
function pairwise(a, start, n) {
  if (n < 8) {
    let sum = 0;
    for (let i = 0; i < n; ++i) sum += a[start + i];
    return sum;
  }
  if (n <= 128) {
    const r = Array.from({ length: 8 }, (_, j) => a[start + j]);
    let i = 8;
    for (; i < n - n % 8; i += 8) for (let j = 0; j < 8; ++j) r[j] += a[start + i + j];
    let sum = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; ++i) sum += a[start + i];
    return sum;
  }
  const half = Math.floor(n / 2) - Math.floor(n / 2) % 8;
  return pairwise(a, start, half) + pairwise(a, start + half, n - half);
}
const mean = (a) => (a[0] + pairwise(a, 1, a.length - 1)) / a.length;

// numpy.round: halves go to the even neighbour.
function roundEven(v) {
  const r = Math.round(v);
  return r - v === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function sine(frequency) {
  if (frequency >= WAVE_SIZE / 2) return new Float64Array(WAVE_SIZE);
  return map((t) => Math.sin(2 * Math.PI * t * frequency));
}

function series(n, term) {
  let x = new Float64Array(WAVE_SIZE);
  for (let i = 0; i < n; ++i) x = add(x, term(i));
  return x;
}

const tri = (n, f = 1) => series(n, (i) => scale(sine((2 * i + 1) * f), 1 / (2 * i + 1) ** 2));
const saw = (n, f = 1) => series(n, (i) => scale(sine((i + 1) * f), 1 / (i + 1)));
// Python 2 integer division: n / 3 is floored.
const triStack = (n) => series(n, (i) => tri(15 + 5 * n, i + Math.floor(n / 3)));

function drawbars(bars) {
  const pipes = [1, 3, 2, 4, 6, 8, 10, 12, 16];
  return series(9, (i) => scale(sine(pipes[i]), Number(bars[i]) / 8));
}

const trisaw = (h) => add(tri(80), scale(scale(saw(80, h), h !== 1 ? 1 : 0.25), 0.5));
const sawtri = (h) => add(scale(saw(80), 0.5), scale(tri(80, h), h !== 1 ? 1 : 0.25));

function burst(duty) {
  const d = duty ** 0.5;
  const s = sine(1 / duty);
  return phase.map((t, i) => -(i === WAVE_SIZE - 1 || t < d ? -1 : 0) * s[i]);
}

const bandpassFormant = (ratio) => {
  const s = sine(ratio * 1.5);
  return phase.map((t, i) => s[i] * (1 - t) * 0.5);
};

const centre = (f) => f.map((v) => v - (Math.max(...f) + Math.min(...f)) / 2);

function formant(index, digital) {
  const shape = digital ? (x) => x.map((v) => Math.atan(v * 8) / Math.PI) : (x) => x;
  const f1 = 3.9 * (index + 1) / 8;
  const f2 = f1 * (1 - Math.cos(f1 * Math.PI * 0.8));
  const a1 = phase.map((t) => (1 - t) ** 0.2 * Math.exp(-4 * t));
  const a2 = phase.map((t) => (1 - t) ** 0.2 * Math.exp(-2 * t));
  const [k1, k2, k3] = digital ? [3.2, 4.1, 2.9] : [3, 4, 2.8];
  const [g2, g3] = digital ? [0.7, 0.7] : [1.5, 1.7];
  const w3 = shape(sine(1 + k3 * (f2 + f1))).map((v, i) => v * a2[i] * g3);
  const w1 = shape(sine(1 + k1 * f1)).map((v, i) => v * a1[i]);
  const w2 = shape(sine(1 + k2 * f2)).map((v, i) => v * a2[i] * g2);
  return centre(w1.map((v, i) => v + w2[i] + w3[i]));
}

function fm(carrier, modulator, amount) {
  const m = sine(modulator);
  return phase.map((t, i) => Math.sin(2 * Math.PI * (t * carrier + m[i] * amount)));
}

// Braids wave i: its magnitude spectrum at -90 degrees, resynthesized at 256 samples (numpy rfft/irfft).
function braids(index) {
  const s = Array.from(BRAIDS.subarray((index - BRAIDS_FIRST) * 128, (index - BRAIDS_FIRST + 1) * 128), (v) => v - 128);
  const magnitude = [];
  for (let k = 0; k <= 64; ++k) {
    let re = 0;
    let im = 0;
    for (let j = 0; j < 128; ++j) {
      re += s[j] * Math.cos(2 * Math.PI * (j * k % 128) / 128);
      im -= s[j] * Math.sin(2 * Math.PI * (j * k % 128) / 128);
    }
    magnitude.push(Math.hypot(re, im));
  }
  const real = Math.cos(-Math.PI / 2);
  return Float64Array.from(phase, (_, t) => {
    let sum = magnitude[0] * real;
    for (let k = 1; k <= 64; ++k) {
      const e = 2 * Math.PI * (k * t % WAVE_SIZE) / WAVE_SIZE;
      sum += 2 * magnitude[k] * (real * Math.cos(e) + Math.sin(e));
    }
    return sum / WAVE_SIZE;
  });
}

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const sweep = range(0, 16).map((i) => (i === 15 ? 1 : i * (1 / 15)) ** 2);

// The 12 factory banks (A-L) of wavetables.py, 16 waves each, as named there.
export const FACTORY = [
  ['Sine harmonics', range(1, 17).map((f) => () => sine(f))],
  ['Triangle stacks', range(2, 18).map((n) => () => triStack(n))],
  ['Drawbars', ['688600000', '686040000', '666806000', '655550600', '665560060', '688500888', '660000888',
    '060000046', '867000006', '888876788', '668744354', '448644054', '327645222', '204675300', '002478500',
    '002050321'].map((b) => () => drawbars(b))],
  ['Triangle and saw', [...[1, 1.5, 2, 3, 4, 4.5, 5, 8].map((h) => () => trisaw(h)),
    ...[8, 5, 4.5, 4, 3, 2, 1.5, 1].map((h) => () => sawtri(h))]],
  ['Bursts and formants', [...[0.5, 0.4, 1 / 3, 0.25, 0.2, 0.125, 1 / 16, 1 / 32].map((d) => () => burst(d)),
    ...[16, 10, 9, 8, 6, 4, 3, 2].map((r) => () => bandpassFormant(r))]],
  ['Vowels', [...range(0, 8).map((i) => () => formant(i, false)),
    ...[7, 6, 5, 4, 3, 2, 1, 0].map((i) => () => formant(i, true))]],
  ['Digital and metal', [176, 189, 191, 193, 195, 197, 199, 201, 220, 222, 224, 226, 228, 230, 232, 234]
    .map((i) => () => braids(i))],
  ['Braids', range(172, 188).map((i) => () => braids(i))],
  ['FM 2:1', sweep.map((s) => () => fm(2, 1, 4 * s))],
  ['FM 1:0.5', sweep.map((s) => () => fm(1, 0.5, 8 * s))],
  ['FM 1:3', sweep.map((s) => () => fm(1, 3, 3 * s))],
  ['FM 1:8', sweep.map((s) => () => fm(1, 8, 2 * s))]
];

export const factoryWave = (index) => FACTORY[Math.floor(index / WAVES_PER_BANK)][1][index % WAVES_PER_BANK]();

function checkWave(wave) {
  if (!(wave instanceof Float64Array) || wave.length !== WAVE_SIZE) throw new Error('A wave is 256 samples.');
  if (!wave.every(Number.isFinite)) throw new Error('A wave sample is not a number.');
}

// A factory wave as its WAVE row, exactly as wavetables.py integrates it; samples 0-3 repeat at 256-259.
export function factoryIntegrate(wave) {
  checkWave(wave);
  const offset = ((wave[0] + wave[1]) + wave[2]) + wave[3];
  const x = Float64Array.from({ length: 2 * WAVE_SIZE }, (_, i) => wave[i % WAVE_SIZE] + offset);
  const m = mean(x);
  x.forEach((v, i) => { x[i] = v - m; });
  const peak = x.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
  if (!Number.isFinite(peak)) throw new RangeError('This wave is out of range.');
  const row = new Int16Array(WAVE_ROW);
  if (peak === 0) return row;
  let sum = 0;
  x.forEach((v, i) => { sum += v / peak; x[i] = sum; });
  const m2 = mean(x);
  for (let i = 0; i < WAVE_ROW; ++i) {
    const v = roundEven((x[2 * WAVE_SIZE - WAVE_ROW + i] - m2) * 512);
    if (!(v >= -32768 && v <= 32767)) throw new RangeError('This wave is out of range.');
    row[i] = v;
  }
  row.set(row.subarray(0, 4), WAVE_SIZE);
  return row;
}

// A user wave as its WAVE row, as the Plaits editor's integrate() does (centred, peak at most 1,
// scaled by 4 * 32767 / n, so it never overflows); rows start 4 samples early, as the factory rows do.
export function integrate(wave) {
  checkWave(wave);
  const n = WAVE_SIZE;
  let mean = 0;
  for (let i = 0; i < n; ++i) mean += wave[i];
  mean /= n;
  const x = wave.map((v) => v - mean);
  const amplitude = x.reduce((p, v) => Math.max(p, Math.abs(v)), 1);
  if (!Number.isFinite(mean) || !Number.isFinite(amplitude)) throw new RangeError('This wave is out of range.');
  x.forEach((v, i) => { x[i] = v / amplitude; });
  let integral = 0;
  let integralMean = 0;
  for (let i = 0; i < 2 * n; ++i) {
    integral += x[i % n];
    if (i >= n) integralMean += integral;
  }
  integralMean /= n;
  const values = new Float64Array(n);
  integral = 0;
  for (let i = 0; i < 2 * n; ++i) {
    integral += x[i % n];
    if (i >= n) values[i - n] = (integral - integralMean) * (4 * 32767 / n);
  }
  return Int16Array.from({ length: WAVE_ROW }, (_, k) => {
    const v = Math.trunc(values[(k + n - 4) % n]);
    if (!(v >= -32768 && v <= 32767)) throw new RangeError('This wave is out of range.');
    return v;
  });
}

// 192 rows (Int16Array of 260) as the WAVE payload: int16 LE, plus the guard row.
export function table(rows) {
  if (!Array.isArray(rows) || rows.length !== WAVES) throw new Error('A wavetable has 192 waves.');
  const bytes = new Uint8Array(TABLE_BYTES);
  const out = new DataView(bytes.buffer);
  [...rows, rows[WAVES - 1]].forEach((row, r) => {
    if (!(row instanceof Int16Array) || row.length !== WAVE_ROW) throw new Error(`Wave ${r + 1} is malformed.`);
    row.forEach((v, i) => out.setInt16(2 * (r * WAVE_ROW + i), v, true));
  });
  checkWaves(bytes);
  return bytes;
}

export const factoryRows = () => range(0, WAVES).map((i) => factoryIntegrate(factoryWave(i)));
export const factoryTable = () => table(factoryRows());

// A WAVE payload back to its 192 rows; refuses what the writer refuses.
export function rows(bytes) {
  checkWaves(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return range(0, WAVES).map((r) => Int16Array.from({ length: WAVE_ROW }, (_, i) => view.getInt16(2 * (r * WAVE_ROW + i), true)));
}

// The wave a row plays (its first difference, peak 1), for drawing.
export function shape(row) {
  const d = Float64Array.from({ length: WAVE_SIZE }, (_, i) => row[i + 1] - row[i]);
  const peak = d.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
  return peak ? d.map((v) => v / peak) : d;
}

// The first channel of a PCM or float WAV file, as numbers in -1..1; throws on anything else.
export function parseWav(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > MAX_IMPORT) throw new Error('WAV files are 4 MB at most.');
  const view = new DataView(buffer);
  const tag = (at) => String.fromCharCode(...new Uint8Array(buffer, at, 4));
  if (buffer.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file.');
  const end = 8 + view.getUint32(4, true);
  if (end > buffer.byteLength) throw new Error('The WAV file is cut short.');
  let fmt = null;
  let data = null;
  for (let at = 12; at + 8 <= end;) {
    const size = view.getUint32(at + 4, true);
    if (at + 8 + size > end) throw new Error('The WAV file is cut short.');
    if (tag(at) === 'fmt ' && size >= 16) fmt = new DataView(buffer, at + 8, size);
    if (tag(at) === 'data') data = new DataView(buffer, at + 8, size);
    at += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('The WAV file has no audio.');
  let format = fmt.getUint16(0, true);
  const channels = fmt.getUint16(2, true);
  const bits = fmt.getUint16(14, true);
  // WAVE_FORMAT_EXTENSIBLE: the format is the first word of a KSDATAFORMAT subformat GUID.
  if (format === 0xfffe) {
    const suffix = [0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
    if (fmt.byteLength < 40 || fmt.getUint16(26, true) !== 0 || suffix.some((b, i) => fmt.getUint8(28 + i) !== b)) {
      throw new Error('Use a PCM or float WAV file.');
    }
    format = fmt.getUint16(24, true);
  }
  const bytes = bits / 8;
  const reader = {
    '1:8': (at) => (data.getUint8(at) - 128) / 128,
    '1:16': (at) => data.getInt16(at, true) / 32768,
    '1:24': (at) => ((data.getUint8(at) | data.getUint8(at + 1) << 8 | data.getInt8(at + 2) << 16)) / 8388608,
    '1:32': (at) => data.getInt32(at, true) / 2147483648,
    '3:32': (at) => data.getFloat32(at, true),
    '3:64': (at) => data.getFloat64(at, true)
  }[`${format}:${bits}`];
  if (!reader || channels < 1) throw new Error('Use a PCM or float WAV file.');
  const frames = data.byteLength / (bytes * channels);
  if (!frames) throw new Error('The WAV file has no audio.');
  if (!Number.isInteger(frames)) throw new Error('The WAV file is cut short.');
  const samples = Float64Array.from({ length: frames }, (_, i) => reader(i * bytes * channels));
  if (!samples.every(Number.isFinite)) throw new Error('A WAV sample is not a number.');
  return samples;
}

// Resamples one cycle (at most 8192 samples) to 256 by its spectrum, as the Plaits editor does;
// phase alignment puts every harmonic in sine phase.
export function resample(x, phaseAlign = false) {
  const n = Math.min(x.length, MAX_CYCLE);
  const m = WAVE_SIZE;
  const nyquist = Math.min(n, m) / 2;
  const y = new Float64Array(m);
  for (let i = 1; i < nyquist; ++i) {
    let xr = 0;
    let xi = 0;
    for (let j = 0; j < n; ++j) {
      const e = j * i / n * 2 * Math.PI;
      xr += Math.cos(e) * x[j];
      xi += Math.sin(e) * x[j];
    }
    xr *= 2 / n;
    xi *= 2 / n;
    if (phaseAlign) {
      xi = Math.sqrt(xr * xr + xi * xi);
      xr = 0;
    }
    for (let j = 0; j < m; ++j) {
      const e = j * i / m * 2 * Math.PI;
      y[j] += Math.cos(e) * xr + Math.sin(e) * xi;
    }
  }
  return y;
}

// Back-to-back cycles of 256 samples, for a file that holds a bank.
export function cycles(samples) {
  const count = samples.length / WAVE_SIZE;
  if (!Number.isInteger(count) || count < 1 || count > WAVES_PER_BANK) {
    throw new Error('The file must hold 1 to 16 cycles of 256 samples.');
  }
  return Array.from({ length: count }, (_, i) => Float64Array.from(samples.subarray(i * WAVE_SIZE, (i + 1) * WAVE_SIZE)));
}

function hermite(row, index, fractional) {
  const xm1 = row[index];
  const x0 = row[index + 1];
  const x1 = row[index + 2];
  const x2 = row[index + 3];
  const c = (x1 - xm1) * 0.5;
  const v = x0 - x1;
  const w = c + v;
  const a = w + v + (x2 - x0) * 0.5;
  const bNeg = w + a;
  return (((a * fractional) - bNeg) * fractional + c) * fractional + x0;
}

// A preview of the Beads synth's read (wavetable_grain.h) at a bank position 0-1 and a
// frequency in cycles per sample, without its envelope and bit depth.
export function preview(bankRows, position, frequency, length) {
  const wave = position * (WAVES_PER_BANK - 1);
  const w = Math.min(Math.floor(wave), WAVES_PER_BANK - 1);
  const wf = wave - w;
  const next = bankRows[Math.min(w + 1, bankRows.length - 1)];
  const read = (p) => {
    const index = Math.floor(p * WAVE_SIZE);
    const x0 = hermite(bankRows[w], index, p * WAVE_SIZE - index);
    return x0 + (hermite(next, index, p * WAVE_SIZE - index) - x0) * wf;
  };
  frequency = Math.min(frequency, 0.25);
  const gain = 1 / (frequency * 131072);
  const cutoff = Math.min(WAVE_SIZE * frequency, 1);
  const out = new Float32Array(length);
  let p = 0;
  let previous = read(0);
  let lp = 0;
  let lp2 = 0;
  for (let i = 0; i < length; ++i) {
    p += frequency;
    if (p >= 1) p -= 1;
    const s = read(p);
    lp += ((s - previous) * gain - lp) * cutoff;
    lp2 += (lp - lp2) * cutoff;
    previous = s;
    out[i] = lp2;
  }
  return out;
}
