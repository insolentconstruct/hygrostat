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
// Selection invariants and portable bank round trips.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateSelection, removeModel, lockSynth, synthLock, flashMeter, refit, stockBanks, bankCpu, SYNTH_RATE } from '../static/js/palette.js';
import { defaults, encodeProfile, decodeSettings, share, unshare } from '../static/js/profile.js';
import { draftText, readDraft, DRAFT } from '../static/js/draft.js';
const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
const release = structuredClone(manifest.releases.at(-1));
release.profile.region = { profile_version: 3, release: 20261121, services_version: 2 };
const selection = validateSelection({ wave: true, rings: false, models: [0, 1], banks: [Array(8).fill(0)] });
assert.throws(() => validateSelection({ ...selection, wave: false, models: [], banks: [] }), /Keep/);
assert.throws(() => removeModel(selection, 0), /replacement/);
assert.deepEqual(removeModel(selection, 0, 1).banks, [Array(8).fill(1)]);
const beads = removeModel({ ...selection, wave: false, models: [0] }, 0);
assert.equal(beads.wave, true);
assert.deepEqual(beads.banks, []);
const entries = defaults(release.profile);
assert.deepEqual(lockSynth([[31, 1, 14, 0, 0, 0]], beads), [[31, 2, 0, 0, 0, 0]]);
assert.doesNotThrow(() => encodeProfile(lockSynth(entries, beads), release.profile));
for (const [chosen, value] of [[beads, 0], [{ ...selection, wave: false }, 1]]) {
  assert.deepEqual(lockSynth(entries, chosen).find((e) => e[0] === 7), [7, 1, value, 0, 0, 0]);
  assert.match(synthLock(chosen), /locked/);
}
const directory = [{ kind: 0x45564157, offset: 0, size: 100396, crc: 123 }];
const plaits = { banks: selection.banks, directory };
const block = encodeProfile(entries, release.profile, null, plaits);
const setup = { selection, content: null };
const link = share(release, block, setup);
const restored = unshare(link, [release]);
assert.deepEqual(restored.setup, setup);
assert.deepEqual(restored.plaits, plaits);
const raw = draftText(release, block, 'Drizzlet', 42, false, setup);
const draft = readDraft({ getItem: (key) => key === DRAFT ? raw : null }, [release]);
assert.deepEqual(draft.setup, setup);
assert.deepEqual(decodeSettings(block, release.profile).plaits, plaits);
assert.deepEqual(stockBanks(), [[8, 9, 10, 11, 12, 13, 14, 15], [16, 17, 18, 19, 20, 21, 22, 23], [0, 1, 2, 3, 4, 5, 6, 7]]);
assert.equal(unshare(share(release, encodeProfile(entries, release.profile)), [release]).plaits, undefined);
const meter = flashMeter(660124, { region: new Uint8Array(100396), directory }, block);
assert.equal(meter.free, 917504 - 663552 - 100396);
assert.equal(meter.profile + meter.profileFree, 4096);
assert(meter.seconds > 0 && meter.fits);
assert.equal(flashMeter(917505, null, block).fits, false);
assert.deepEqual(refit(selection, { content: { models: [{ id: 1 }] } }, { free: -42 }),
  { missing: [0], ringsMissing: false, deficit: 42 });
// Plaits banks are screened at 48 kHz only: figures at 32 and 24 kHz never change the result.
const cpu = { screening_ratio: 1.044, working_limits: { 48000: 96.5, 32000: 97, 24000: 90 } };
const rows = [{ id: 0, seed3_peak: { 48000: 50, 32000: 99, 24000: 95 } }, { id: 1, seed3_peak: { 48000: 93, 32000: 10, 24000: 10 } }, { id: 2 }];
assert.equal(SYNTH_RATE, 48000);
const quiet = bankCpu([0, 0], rows, cpu);
assert.deepEqual({ ...quiet, screened: quiet.screened.toFixed(3) },
  { rate: 48000, peak: 50, screened: '52.200', limit: 96.5, complete: true, over: false });
const loud = bankCpu([0, 1], rows, cpu);
assert.deepEqual([loud.peak, loud.screened.toFixed(3), loud.over], [93, '97.092', true]);
assert.deepEqual(bankCpu([0, 2], rows, cpu), { ...quiet, complete: false });
assert.deepEqual(bankCpu([2], rows, cpu), { rate: 48000, peak: null, screened: null, limit: 96.5, complete: false, over: false });
// The rate stays a parameter for work that follows the codec rate.
assert.deepEqual([bankCpu([0], rows, cpu, 24000).over, bankCpu([1], rows, cpu, 24000).over], [true, false]);
console.log('PASS palette: synth locks, explicit replacement, profile/link/draft banks, flash, refit and 48 kHz bank CPU');
