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
// Selection, banks and physical flash accounting; no DOM.
import { knownModel, validatePlaits, SECTION_NAMES, SECTION_KINDS, SYNTH, sha256 } from './profile.js?v=44fb6759b0ce7548';
import { writeRegion, resolveBlobs, blobInfo, checkInstallable, regionStart, REGION_END, APP_START } from './region.js?v=44fb6759b0ce7548';
import { sampleCount } from './encoder.js?v=44fb6759b0ce7548';

export const stockBanks = () => Array.from({ length: 3 }, (_, b) => Array.from({ length: 8 }, (_, i) => [8, 16, 0][b] + i));

export function validateSelection(value) {
  if (!value || typeof value.wave !== 'boolean' || typeof value.rings !== 'boolean' ||
      !Array.isArray(value.models) || !value.models.every(knownModel) ||
      new Set(value.models).size !== value.models.length) throw new Error('Invalid model selection.');
  const { banks } = validatePlaits({ banks: value.banks, directory: [] });
  if (banks.some((bank) => bank.some((id) => !value.models.includes(id)))) throw new Error('A bank uses a model that is not selected.');
  if (value.models.length && !banks.length) throw new Error('Selected Plaits models need a bank.');
  if (!value.wave && !value.models.length) throw new Error('Keep Beads wavetables or at least one Plaits model.');
  return { wave: value.wave, rings: value.rings, models: value.models.slice(), banks };
}

// Add one bank without replacing any selected models, sections or existing bank slots.
export function addStarterBank(selection, bank, release) {
  validateSelection(selection);
  if (!bank || !Array.isArray(bank.models) || bank.models.length !== 8 ||
      !bank.models.every(knownModel)) throw new Error('A starter bank needs eight known models.');
  if (selection.banks.length >= 15) throw new Error('Remove a bank before adding another; fifteen banks is the limit.');
  const next = validateSelection({ ...selection,
    models: [...new Set([...selection.models, ...bank.models])],
    banks: [...selection.banks, bank.models.slice()] });
  const missing = refit(next, release);
  if (missing.missing.length || missing.ringsMissing) throw new Error('Refit required: keep or replace unavailable content before adding this bank.');
  return next;
}

export function defaultSelection(release) {
  const kinds = release.profile.region?.default_layout?.map((e) => e.kind) ?? [];
  return validateSelection({ wave: kinds.includes('WAVE'), rings: kinds.includes('RNGS'),
    models: kinds.includes('PLTS') ? stockBanks().flat() : [], banks: kinds.includes('PLTS') ? stockBanks() : [] });
}

// Removing a model requires explicit replacement in its bank slots; only the last model clears the banks.
export function removeModel(selection, id, replacement) {
  const models = selection.models.filter((m) => m !== id);
  if (!models.length) return validateSelection({ ...selection, models, banks: [], wave: true });
  const used = selection.banks.some((bank) => bank.includes(id));
  if (used && !models.includes(replacement)) throw new Error('Choose a replacement for the bank slots first.');
  return validateSelection({ ...selection, models, banks: selection.banks.map((bank) => bank.map((m) => m === id ? replacement : m)) });
}

// A single installed primary synth is fixed; its gestures and page placement are cleared too.
export function lockSynth(entries, selection) {
  const locked = !selection.models.length ? 0 : !selection.wave ? 1 : null;
  return entries.map((e) => e[0] === SYNTH && locked !== null ? [SYNTH, 1, locked, 0, 0, 0] :
    e[0] === 31 && !selection.models.length ? [31, 2, 0, 0, 0, 0] : e.slice());
}
export const synthLock = (selection) => !selection.models.length ? 'Synth locked to Beads: no Plaits models installed.' :
  !selection.wave ? 'Synth locked to Plaits: Beads wavetables removed.' : '';

export function flashMeter(appSize, written, block) {
  const start = written ? regionStart(appSize) : APP_START + appSize;
  const end = start + (written?.region.length ?? 0);
  const used = new DataView(block.buffer, block.byteOffset, block.byteLength).getUint16(6, true) + 20;
  return { app: appSize, padding: start - APP_START - appSize,
    sections: (written?.directory ?? []).map((e) => ({ kind: SECTION_NAMES[SECTION_KINDS.indexOf(e.kind)], bytes: e.size })),
    free: REGION_END - end, fits: end <= REGION_END, profile: used, profileFree: block.length - used,
    seconds: sampleCount(end - APP_START) / 48000 };
}

// The stock models are qualified; Palette models need module rows.
export const offeredModels = (release) => (release.content?.models ?? []).filter((row) => row.id < 28 || row.module_rows);

// Nothing is discarded: the caller presents missing models and the deficit before accepting a replacement.
export function refit(selection, release, meter = null) {
  const offered = offeredModels(release);
  return { missing: selection.models.filter((id) => !offered.some((m) => m.id === id)),
    ringsMissing: selection.rings && !release.content?.rings, deficit: Math.max(0, -(meter?.free ?? 0)) };
}

export async function fetchAsset(asset, fetcher = fetch) {
  if (!asset || typeof asset.url !== 'string' || !/^[0-9a-f]{64}$/.test(asset.sha256)) throw new Error('Missing pinned content asset.');
  const url = new URL(asset.url, 'https://hygrostat.invalid/');
  if (url.origin !== 'https://hygrostat.invalid' || !url.pathname.startsWith('/images/')) throw new Error('Content assets must be local images.');
  const response = await fetcher(asset.url);
  if (!response.ok) throw new Error('Could not download content.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (await sha256(bytes) !== asset.sha256) throw new Error('Content does not match its release hash.');
  return bytes;
}

export async function selectedRegion(release, selection, content, fetcher = fetch) {
  validateSelection(selection);
  const missing = refit(selection, release);
  if (missing.missing.length || missing.ringsMissing) throw new Error(`Refit required: unavailable models ${missing.missing.join(', ')}${missing.ringsMissing ? '; Rings unavailable' : ''}. Choose what to replace or remove.`);
  const assets = release.content;
  const models = await Promise.all(selection.models.map(async (id) => {
    const asset = assets.models.find((m) => m.id === id);
    const blob = await fetchAsset(asset, fetcher);
    const info = blobInfo(blob);
    if (info.kind !== 1 || id < info.first || id >= info.first + info.ids) throw new Error('Model asset ID differs from its catalogue.');
    return [asset.sha256, blob];
  }));
  const libraries = await Promise.all((assets.libraries ?? []).map((asset) => fetchAsset(asset, fetcher)));
  const resolved = await resolveBlobs([...new Map(models).values()], libraries);
  const blobs = resolved.blobs;
  if (selection.rings) blobs.push(await fetchAsset(assets.rings, fetcher));
  const written = writeRegion({ release: release.profile.region.release, wave: selection.wave ? content.wave : null,
    terrain: content.terrain, blobs });
  checkInstallable(written);
  return written;
}
