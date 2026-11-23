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

// Synth start leaves the contextual bank and polyphony controls reachable.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { catalogueAtRef, catalogueFeatures } from '../tools/catalogue.js';
import { validate, encodeProfile, decodeProfile, crc32, pageSlots } from '../static/js/profile.js';

const ref = process.env.REACHABILITY_FIRMWARE_REF;
assert(ref, 'Set REACHABILITY_FIRMWARE_REF to the candidate firmware commit.');
const show = (r, file) => firmwareShow(r, file);
const catalogue = catalogueAtRef(show, ref);
const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
const profile = structuredClone(manifest.releases.find((r) => r.slug === 'beta-3-smirr').profile);
Object.assign(profile, { features: catalogueFeatures(catalogue), hold_rules: true,
  feedback_slot: true, reachability_rules: true });
const previous = { ...profile, reachability_rules: false };
const allowed = (entries, p) => {
  try { validate(entries, p); return true; } catch { return false; }
};
const raw = (entries) => {
  const b = encodeProfile([], profile);
  b[5] = entries.length;
  const view = new DataView(b.buffer);
  view.setUint16(6, entries.length * 6, true);
  entries.forEach((e, i) => b.set(e, 16 + 6 * i));
  const end = 16 + entries.length * 6;
  view.setUint32(end, crc32(b.subarray(0, end)), true);
  return b;
};
const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-reachability-'));
let checked = 0, refused = 0;
try {
  mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
  for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) {
    writeFileSync(join(scratch, 'beads', file), show(ref, 'beads/' + file));
  }
  const oracle = join(scratch, 'profile-oracle');
  execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
    fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', oracle]);
  let pending = [];
  const compare = () => {
    const blocks = pending.map(({ entries }) => raw(entries));
    const answers = execFileSync(oracle, [], { input: Buffer.concat(blocks.map((b) => Buffer.from(b))) });
    assert.equal(answers.length, pending.length * 493);
    pending.forEach(({ entries, expected }, i) => {
      assert.equal(allowed(entries, profile), expected, JSON.stringify(entries));
      assert.equal(answers[i * 493] === 1, expected, 'firmware: ' + JSON.stringify(entries));
      if (expected) {
        assert.deepEqual(decodeProfile(blocks[i], profile), entries);
        assert.deepEqual(Array.from(encodeProfile(entries, profile)), Array.from(blocks[i]));
        assert.deepEqual(Array.from(answers.subarray(i * 493 + 1, i * 493 + 1 + entries.length * 6)), entries.flat());
      } else assert.throws(() => decodeProfile(blocks[i], profile));
      ++checked;
    });
    pending = [];
  };
  const add = (synth, start) => {
    const entries = synth ? [synth, start] : [start];
    const blocked = Boolean(synth && (synth[1] === 2 || (synth[1] === 1 && synth[2])) && start[5] === 2);
    const prior = allowed(entries, previous);
    const expected = prior && !blocked;
    refused += Number(prior && blocked);
    pending.push({ entries, expected });
    if (pending.length === 256) compare();
  };
  for (let state = 0; state <= 2; ++state) {
    for (let value = 0; value < 3; ++value) {
      for (let page = 0; page <= pageSlots(profile); ++page) {
        const synth = [7, state, value, page, 0, 0];
        for (let startState = 0; startState <= 2; ++startState) {
          for (let startValue = 0; startValue < 2; ++startValue) {
            for (let startPage = 0; startPage <= pageSlots(profile); ++startPage) {
              for (let action = 0; action <= 3; ++action) {
                add(synth, [9, startState, startValue, startPage, 0, action]);
              }
            }
          }
        }
      }
    }
  }
  for (let state = 0; state <= 2; ++state) {
    for (let value = 0; value < 2; ++value) {
      for (let action = 0; action <= 3; ++action) add(null, [9, state, value, 0, 0, action]);
    }
  }
  if (pending.length) compare();
  assert(refused > 0, 'the generated profiles exercise the new refusal');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`PASS panel reachability: ${checked} generated profiles, ${refused} blocked synth controls, byte agreement at ${ref.slice(0, 7)}`);
