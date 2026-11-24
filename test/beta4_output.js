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

import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { catalogueAtRef, catalogueFeatures, firmwareDefinitions, firmwareRecord, checkDefinitions } from '../tools/catalogue.js';
import { defaults, encodeProfile, decodeProfile } from '../static/js/profile.js';
import { guide } from '../static/js/guide.js';
import { featureHelp } from '../static/js/help.js';
const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
const cases = [
  ['1af0258a63975422597cee6f08207d4d1de40f09', [32, 50, 51]],
  ['0e78bfa03e7b39f781366c549ea039c545bc5116', [52]]
];
for (const [ref, ids] of cases) {
  const read = (file) => firmwareShow(ref, file, { encoding: 'utf8' });
  const catalogue = catalogueAtRef(firmwareShow, ref);
  checkDefinitions(catalogue, firmwareDefinitions(read), firmwareRecord(read));
  const release = structuredClone(manifest.releases.at(-1));
  release.development = true;
  release.source_commit = ref;
  release.profile.features = catalogueFeatures(catalogue);
  const candidates = [];
  for (const id of ids) {
    const f = release.profile.features.find((f) => f.id === id);
    assert(f);
    assert(featureHelp(f, release).description.length > 30);
    assert(featureHelp(f, release).url.includes(ref));
    for (let value = 0; value < f.values.length; ++value) {
      const entries = defaults(release.profile).filter((e) => e[0] !== id);
      entries.push([id, 1, value, 0, 0, 0]);
      entries.sort((a, b) => a[0] - b[0]);
      const block = encodeProfile(entries, release.profile);
      assert.deepEqual(decodeProfile(block, release.profile), entries);
      candidates.push({ entries, block });
    }
    if (id === 52) {
      assert(f.page && f.states.includes('Adjustable'));
      assert.equal(f.saved, 28);
      const entries = defaults(release.profile).filter((e) => e[0] !== 52 && e[3] !== 21);
      entries.push([52, 2, 3, 21, 0, 0]);
      entries.sort((a, b) => a[0] - b[0]);
      const block = encodeProfile(entries, release.profile);
      assert.deepEqual(decodeProfile(block, release.profile), entries);
      candidates.push({ entries, block });
      assert.match(guide(entries, release, 'fixture', false), /Gain ceiling/);
      const card = guide(entries, release, 'fixture', true).split('REVERB: Gain ceiling</text>')[1].split('Default:')[0];
      assert.match(card, /<circle[^>]*fill="#a87900"[^>]*stroke-dasharray="6 4"[^>]*\/>\s*<text[^>]*>\+12 dB<\/text>\s*<text[^>]*>yellow; slow blink<\/text>/);
      assert.match(read('beads/options.cc'), /FEATURE_GAIN_CEILING, 3, \{ 255, 255, 0 \}, PULSE_SLOW/);
    } else assert(!f.page);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-output-oracle-'));
  try {
    mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
    for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) {
      writeFileSync(join(scratch, 'beads', file), read('beads/' + file));
    }
    const oracle = join(scratch, 'profile-oracle');
    execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
      fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', oracle]);
    const answers = execFileSync(oracle, [], { input: Buffer.concat(candidates.map((c) => Buffer.from(c.block))) });
    assert.equal(answers.length, candidates.length * 493);
    candidates.forEach((c, i) => {
      assert.equal(answers[i * 493], 1);
      assert.deepEqual(Array.from(answers.subarray(i * 493 + 1, i * 493 + 1 + c.entries.length * 6)), c.entries.flat());
    });
  } finally { rmSync(scratch, { recursive: true, force: true }); }

}
const oldMix = manifest.releases.at(-1).profile.features.find((f) => f.id === 32);
assert(!featureHelp(oldMix, manifest.releases.at(-1)).description.includes('Send'));
console.log('PASS Beta 4 output: firmware manifest digest, definitions, saved bytes, values and page assignment');
