// Copyright 2026 Insolent Construct.
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
// Scale identities are permanent. Array order is only the SEED-tap cycle.
export const SCALE_RECORD_SIZE = 144;
export const MAX_SCALES = 14;
export const MAX_DEGREES = 24;
export const PULSE_NAMES = ['Steady', 'Slow blink', 'Fast blink', 'Double pulse'];
const factory = [
  [2, 'Fifths', [255, 64, 32], 0, [0, 7]],
  [3, 'Major', [255, 160, 0], 0, [0, 2.0004, 3.9996, 5.0004, 6.9996, 9, 11.0004]],
  [4, 'Minor', [32, 96, 255], 0, [0, 2.0004, 3, 5.0004, 6.9996, 8.0004, 9.9996]],
  [5, 'Pentatonic major', [255, 160, 0], 1, [0, 2.0004, 3.9996, 6.9996, 9]],
  [6, 'Pentatonic minor', [32, 96, 255], 1, [0, 3, 5.0004, 6.9996, 9.9996]],
  [7, 'Pelog', [0, 220, 160], 0, [0, 1.53, 7.0596, 8.4804]],
  [8, 'Raag Bhairav', [160, 48, 255], 0, [0, 0.9024, 3.8628, 4.98, 7.02, 7.9212, 10.8828]],
  [9, 'Raag Shri', [255, 32, 144], 3, [0, 2.0388, 3.156, 4.98, 7.02, 9.0588, 10.1748]]
];
export const factoryScales = () => factory.map(([id, name, color, pulses, notes]) =>
  ({ id, name, color: color.slice(), pulses, repeat: 12, notes: notes.map(Math.fround) }));
export const effectiveScales = (scales) => scales === null ? factoryScales() : scales;

export function validateScales(scales) {
  if (scales === null) return null;
  if (!Array.isArray(scales) || scales.length > MAX_SCALES) throw new Error('Use at most 14 scales.');
  const seen = new Set();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  return scales.map((scale) => {
    if (!scale || typeof scale !== 'object' || !Number.isInteger(scale.id) ||
        scale.id < 2 || scale.id > 15 || seen.has(scale.id)) throw new Error('Invalid or repeated scale identity.');
    seen.add(scale.id);
    // eslint-disable-next-line no-control-regex -- Reject C0/C1 controls in scale names.
    if (typeof scale.name !== 'string' || !scale.name.length || /[\u0000-\u001f\u007f-\u009f]/u.test(scale.name) ||
        encoder.encode(scale.name).length > 31 || decoder.decode(encoder.encode(scale.name)) !== scale.name) {
      throw new Error('Scale names need 1–31 UTF-8 bytes and no control characters.');
    }
    if (!Array.isArray(scale.color) || scale.color.length !== 3 ||
        scale.color.some((v) => !Number.isInteger(v) || v < 0 || v > 255) ||
        !Number.isInteger(scale.pulses) || scale.pulses < 0 || scale.pulses > 3) {
      throw new Error('Invalid scale colour or flash pattern.');
    }
    const repeat = Math.fround(scale.repeat);
    if (typeof scale.repeat !== 'number' || !Number.isFinite(repeat) || repeat < Math.fround(0.01) || repeat > 128 ||
        !Array.isArray(scale.notes) || !scale.notes.length || scale.notes.length > MAX_DEGREES) {
      throw new Error('Use 1–24 notes and a repeat of 1–12,800 cents.');
    }
    const notes = scale.notes.map((note) => {
      if (typeof note !== 'number') throw new Error('Notes must be numbers.');
      return Math.fround(note);
    });
    if (notes[0] !== 0 || notes.some((note, i) => !Number.isFinite(note) || Object.is(note, -0) || note < 0 || (note > 0 && note < 2 ** -126) || note >= repeat ||
        (i > 0 && note <= notes[i - 1]))) {
      throw new Error('Notes must start at 0 and increase below the repeat.');
    }
    return { id: scale.id, name: scale.name, color: scale.color.slice(), pulses: scale.pulses, repeat, notes };
  });
}

export function writeScales(bytes, offset, scales) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const scale of scales) {
    bytes.fill(0, offset, offset + SCALE_RECORD_SIZE);
    bytes[offset] = scale.id;
    bytes[offset + 1] = scale.notes.length;
    bytes.set(scale.color, offset + 2);
    bytes[offset + 5] = scale.pulses;
    view.setFloat32(offset + 8, scale.repeat, true);
    bytes.set(new TextEncoder().encode(scale.name), offset + 12);
    scale.notes.forEach((note, i) => view.setFloat32(offset + 44 + 4 * i, note, true));
    offset += SCALE_RECORD_SIZE;
  }
}

export function readScales(bytes, offset, count) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const scales = [];
  for (let i = 0; i < count; ++i, offset += SCALE_RECORD_SIZE) {
    const size = bytes[offset + 1];
    const name = bytes.subarray(offset + 12, offset + 44);
    const end = name.indexOf(0);
    if (size < 1 || size > MAX_DEGREES || end < 1 ||
        name.subarray(end).some((v) => v !== 0) ||
        bytes.subarray(offset + 6, offset + 8).some((v) => v !== 0) ||
        bytes.subarray(offset + 44 + 4 * size, offset + SCALE_RECORD_SIZE).some((v) => v !== 0)) {
      throw new Error('Invalid scale record padding or length.');
    }
    scales.push({ id: bytes[offset], name: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(name.subarray(0, end)),
      color: Array.from(bytes.subarray(offset + 2, offset + 5)), pulses: bytes[offset + 5],
      repeat: view.getFloat32(offset + 8, true),
      notes: Array.from({ length: size }, (_, n) => view.getFloat32(offset + 44 + n * 4, true)) });
  }
  return validateScales(scales);
}

// Scala lists include the repeat as their last degree and omit the root.
export function importScala(text, id, color = [255, 160, 0], pulses = 0) {
  const lines = text.split(/\r?\n/).map((line) => line.split('!')[0].trim()).filter(Boolean);
  if (lines.length < 3 || !/^\d+$/.test(lines[1])) throw new Error('Invalid Scala file.');
  const count = Number(lines[1]);
  if (count < 1 || count > MAX_DEGREES || lines.length !== count + 2) throw new Error('Scala files need 1–24 degrees.');
  const values = lines.slice(2).map((line) => {
    const value = line.split(/\s+/)[0];
    if (/^\d+\/\d+$/.test(value)) {
      const [a, b] = value.split('/').map(Number);
      return a > 0 && b > 0 ? 12 * Math.log2(a / b) : NaN;
    }
    if (/^\d+$/.test(value)) return Number(value) > 0 ? 12 * Math.log2(Number(value)) : NaN;
    return /^\d+\.\d*$/.test(value) ? Number(value) / 100 : NaN;
  });
  const repeat = values.pop();
  return validateScales([{ id, name: lines[0], color, pulses, repeat, notes: [0, ...values] }])[0];
}
