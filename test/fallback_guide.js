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
// Fallback gestures appear only in guides for matching firmware.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guide } from '../static/js/guide.js';
import { defaults, encodeProfile } from '../static/js/profile.js';

const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
const release = structuredClone(manifest.releases.at(-1));
release.tag = 'drizzlet-synthetic-fallback';
release.profile.reachability_rules = true;
const entries = [[7, 1, 0, 0, 0, 0], [9, 1, 1, 0, 0, 2]];
const bytes = encodeProfile(entries, release.profile);
const before = structuredClone({ release, entries });
for (const mobile of [false, true]) {
  const svg = guide(entries, release, 'fallback', mobile);
  const text = [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((m) => m[1]).join(' ');
  assert.match(text, /missing or damaged Beads waves force the Plaits fallback/);
  assert.match(text, /\[A\]\+FREEZE steps its bank while it plays/);
  assert.match(text, /Synth start on Manual, \[A\] hold starts or stops it/);
  assert.match(text, /both inputs unplugged and FREEZE off/);
  assert.match(text, /Repairing the wave content restores your profile gestures/);
  assert.match(text, /profile and saved settings are kept/);
  const previous = structuredClone(release);
  previous.profile.reachability_rules = false;
  assert.doesNotMatch(guide(entries, previous, 'previous', mobile), /Plaits fallback/);
}
const factory = structuredClone(manifest.releases[0]);
factory.profile.reachability_rules = true;
for (const mobile of [false, true]) {
  assert.match(guide(defaults(factory.profile), factory, 'factory', mobile), /Plaits fallback/);
}
assert.deepEqual({ release, entries }, before);
assert.deepEqual(encodeProfile(entries, release.profile), bytes);
console.log('PASS fallback guide: desktop, mobile, release gate and unchanged profile bytes');
