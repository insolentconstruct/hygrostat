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
// The editor's wavetables and terrains, kept in this browser for the region writer:
// regionContent gives writeRegion's wave (factory bytes unless edited) and terrain (null: no grids).
import { checkWaves } from './region.js?v=6a1c50a3577e20b3';
import { factoryTable } from './wavetables.js?v=6a1c50a3577e20b3';
import { grids, readGrids, parse, MAX_GRIDS } from './terrain.js?v=6a1c50a3577e20b3';

export const CONTENT = 'hygrostat-content';
const SCHEMA = 1;

const toBase64 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// wave: a WAVE payload or null; terrains: [{ equation (text or null for an image), grid: Int8Array }].
export function encodeContent({ wave = null, terrains = [] }) {
  if (wave !== null) checkWaves(wave);
  if (!Array.isArray(terrains) || terrains.length > MAX_GRIDS) throw new Error('Use at most 16 terrains.');
  const payload = terrains.length ? grids(terrains.map((t) => t.grid)) : null;
  return JSON.stringify({ v: SCHEMA, wave: wave && toBase64(wave), terrain: payload && toBase64(payload),
    equations: terrains.map((t) => (typeof t.equation === 'string' ? t.equation : null)) });
}

// The saved content, validated as the writer does; throws on anything malformed.
export function decodeContent(raw) {
  const saved = JSON.parse(raw);
  if (saved?.v !== SCHEMA || !Array.isArray(saved.equations)) throw new Error('Unknown saved content.');
  const wave = saved.wave === null ? null : fromBase64(saved.wave);
  if (wave !== null) checkWaves(wave);
  const list = saved.terrain === null ? [] : readGrids(fromBase64(saved.terrain));
  if (list.length !== saved.equations.length) throw new Error('Saved terrains do not match their equations.');
  saved.equations.forEach((e) => { if (e !== null) parse(e); });
  return { wave, terrains: list.map((grid, i) => ({ equation: saved.equations[i], grid })) };
}

// Reads storage: null when nothing is saved, else the content or { error }.
export function readContent(storage) {
  let raw;
  try { raw = storage.getItem(CONTENT); } catch { return null; }
  if (raw === null) return null;
  try { return decodeContent(raw); } catch (error) { return { error }; }
}

export function saveContent(storage, content) {
  const text = encodeContent(content);
  if (!content.wave && !content.terrains.length) storage.removeItem(CONTENT);
  else storage.setItem(CONTENT, text);
}

// The payloads for writeRegion({ wave, terrain }): wave is never null (the writer reads null as no WAVE).
export function regionContent(storage) {
  const content = readContent(storage);
  if (content?.error) throw new Error('The saved wavetables or terrains are damaged.', { cause: content.error });
  const terrains = content?.terrains ?? [];
  return { wave: content?.wave ?? factoryTable(), terrain: terrains.length ? grids(terrains.map((t) => t.grid)) : null };
}
