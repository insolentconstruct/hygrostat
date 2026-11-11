// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Options pages 5-7 are release-gated. The seven-page release here is a
// synthetic fixture: no such release exists yet, and none is offered.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firmwareRepo, firmwareRef, firmwareShow } from './firmware.js';
import { PAGE_LEDS, pageLeds, pageSlots, validate, encodeProfile, decodeProfile, defaults, templates,
  share, unshare, crc32 } from '../static/js/profile.js';
import { place, freeSlot, slotCount, usedPages, compaction, compact, pageLedName, entryOf } from '../static/js/layout.js';
import { guide } from '../static/js/guide.js';
const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
const beta2 = manifest.releases[0];
const seven = structuredClone(beta2);
seven.tag = 'drizzlet-synthetic-seven-pages';
seven.profile.page_leds = PAGE_LEDS[1].slice();
const p2 = beta2.profile, p7 = seven.profile;

// Capacity and LED masks come only from the two known layouts.
assert.equal(beta2.profile.page_leds, undefined, 'the published release keeps four pages');
assert.deepEqual(pageLeds(p2), [1, 2, 4, 7]);
assert.deepEqual(pageLeds(p7), [1, 2, 4, 3, 5, 6, 7]);
assert.equal(pageSlots(p2), 12);
assert.equal(pageSlots(p7), 21);
for (const bad of [[1, 2, 4], [1, 2, 4, 3, 5, 6, 8], [1, 2, 4, 7, 7], 'x', null, [1, 2, 4, '7'], {}]) {
  const broken = { ...p7, page_leds: bad };
  assert.throws(() => pageLeds(broken), /Unsupported options page layout/, JSON.stringify(bad));
  assert.throws(() => validate(defaults(p2), broken), /Unsupported options page layout/);
}
assert.deepEqual([1, 2, 3, 4].map((page) => pageLedName(p2, page)),
  ['FEEDBACK LED', 'DRY/WET LED', 'REVERB LED', 'all three LEDs']);
assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((page) => pageLedName(p7, page)),
  ['FEEDBACK LED', 'DRY/WET LED', 'REVERB LED', 'FEEDBACK and DRY/WET LEDs', 'FEEDBACK and REVERB LEDs',
    'DRY/WET and REVERB LEDs', 'all three LEDs']);

// Validation, placement and free positions follow the release.
const pitchAt = (slot) => [[1, 2, 0, slot, 0, 0]];
for (let slot = 0; slot <= 23; ++slot) {
  const ok = (profile) => { try { validate(pitchAt(slot), profile); return true; } catch { return false; } };
  assert.equal(ok(p2), slot <= 12, `Beta 2 slot ${slot}`);
  assert.equal(ok(p7), slot <= 21, `seven-page slot ${slot}`);
}
assert.throws(() => validate([[1, 2, 0, 21, 0, 0], [5, 2, 0, 21, 0, 0]], p7), /already used/);
assert.equal(slotCount('page', p2), 12);
assert.equal(slotCount('page', p7), 21);
assert.equal(slotCount('amount', p7), 2);
const drizzlet = defaults(p2);
assert.equal(freeSlot(drizzlet, 'page', p2), 0);
assert.equal(freeSlot(drizzlet, 'page', p7), 13);
assert.throws(() => place(drizzlet, p2, 23, 'page', 13));
const moved = place(drizzlet, p7, 1, 'page', 21);
assert.equal(entryOf(moved, p7.features[0])[3], 21);
assert.equal(moved.filter((e) => e[3] === 1).length, 0);

// Factory layouts stay on four pages in every release.
for (const [name, entries] of Object.entries(templates(p7))) {
  assert(entries.every((e) => e[3] <= 12), name);
  assert.deepEqual(entries, templates(p2)[name], name);
}

// Codec: high slots round-trip only where the release allows them.
const sparse = [[1, 2, 0, 1, 0, 0], [3, 2, 0, 14, 0, 0], [5, 2, 0, 21, 0, 0]];
const block = encodeProfile(sparse, p7);
assert.deepEqual(decodeProfile(block, p7), sparse);
assert.throws(() => decodeProfile(block, p2));
assert.throws(() => encodeProfile(sparse, p2));
const link = share(seven, block);
assert.deepEqual(unshare(link, [beta2, seven]).entries, sparse);
assert.equal(unshare(link, [beta2, seven]).release.tag, seven.tag);

// [M] cycles populated pages; compaction moves whole pages and keeps knobs.
assert.deepEqual(usedPages(sparse, p7), [1, 5, 7]);
assert.deepEqual(compaction(sparse, p7), [[5, 2], [7, 3]]);
assert.deepEqual(compact(sparse, p7), [[1, 2, 0, 1, 0, 0], [3, 2, 0, 5, 0, 0], [5, 2, 0, 9, 0, 0]]);
assert.deepEqual(usedPages(compact(sparse, p7), p7), [1, 2, 3]);
assert.deepEqual(compaction(compact(sparse, p7), p7), []);
const firstEmpty = [[3, 2, 0, 5, 0, 0], [5, 2, 0, 18, 0, 0]];
assert.deepEqual(compaction(firstEmpty, p7), [[2, 1], [6, 2]]);
assert.deepEqual(compact(firstEmpty, p7), [[3, 2, 0, 2, 0, 0], [5, 2, 0, 6, 0, 0]]);
assert.deepEqual(compaction(drizzlet, p7), [], 'trailing empty pages need no compaction');
assert.deepEqual(usedPages([], p7), []);
assert.deepEqual(compaction([], p7), []);
const beta2Sparse = [[1, 2, 0, 1, 0, 0], [5, 2, 0, 12, 0, 0]];
assert.deepEqual(compaction(beta2Sparse, p2), [[4, 2]]);
assert.deepEqual(compact(beta2Sparse, p2), [[1, 2, 0, 1, 0, 0], [5, 2, 0, 6, 0, 0]]);

// Guides: Beta 2 output is byte-identical to the previous editor; seven-page
// releases name every cue and the profile's own page order.
const BETA2_GUIDES = {
  'Drizzlet/false': 'f3fed34c133232ff', 'Drizzlet/true': 'c5e2e6c61629c8f4',
  'Stock plus fixes/false': '76dfc29efb2910ae', 'Stock plus fixes/true': '7edbcece376a94e8',
  'Cloud textures/false': '58ec02e3cbe457a7', 'Cloud textures/true': '93cbd207c4ded996',
  'Pitched grains/false': '0b80c3a045896999', 'Pitched grains/true': '2b0b5512dcd21a0c',
  'Drum grains/false': 'c4dee31b65d15ad1', 'Drum grains/true': '838781a1da428d51',
  'Delay & freeze/false': 'b0c312ccf142ddb5', 'Delay & freeze/true': '35faf2f742cc4ad5',
  'Spectral/false': '39fe85cf6f0ea0e0', 'Spectral/true': 'e571694048091595',
  'Plaits voice/false': '4e6a7ff331e7f4d0', 'Plaits voice/true': '78f4916b9503cbde',
  'Live essentials/false': 'bc5746b7f8c27a9b', 'Live essentials/true': 'b4a8da913ba83a76'
};
for (const [name, entries] of Object.entries(templates(p2))) {
  for (const mobile of [false, true]) {
    const svg = guide(entries, beta2, 'abcdef12', mobile, null);
    assert.equal(createHash('sha256').update(svg).digest('hex').slice(0, 16), BETA2_GUIDES[`${name}/${mobile}`], `${name} ${mobile}`);
  }
}
const text = (svg) => [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((m) => m[1]).join(' ');
for (const mobile of [false, true]) {
  const words = text(guide(sparse, seven, 'abcdef12', mobile, null));
  for (const heading of ['PAGE 1 — FEEDBACK LED pulsing', 'PAGE 5 — FEEDBACK and REVERB LEDs pulsing',
    'PAGE 7 — all three LEDs pulsing']) assert(words.includes(heading), heading);
  assert(!words.includes('PAGE 2'));
  assert(words.includes('1 → 5 → 7'));
  assert(words.includes('4 FEEDBACK+DRY/WET'));
  const factory = text(guide(defaults(p7), seven, 'abcdef12', mobile, null));
  assert(factory.includes('PAGE 4 — FEEDBACK and DRY/WET LEDs pulsing'));
  assert(text(guide([], seven, 'abcdef12', mobile, null)).includes('This profile has no options pages. Hold [M] does nothing.'));
}

// Firmware agreement: Beta 2's parser refuses slots 13 and up; a seven-page
// firmware revision, when given, accepts exactly slots 1-21.
const reseal = (b) => {
  const end = 16 + b[5] * 6;
  new DataView(b.buffer).setUint32(end, crc32(b.subarray(0, end)), true);
  return b;
};
function firmwareAgrees(ref, profile, label) {
  const base = encodeProfile(defaults(p2), p2);
  const cases = [];
  for (const f of profile.features.filter((f) => f.page)) {
    for (let slot = 0; slot <= 23; ++slot) {
      const b = base.slice(); b[5] = 1; b[6] = 6; b[7] = 0;
      b.set([f.id, 2, 0, slot, 0, 0], 16);
      cases.push(reseal(b));
    }
  }
  const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-pages-'));
  try {
    mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
    for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) {
      writeFileSync(join(scratch, 'beads', file), firmwareShow(ref, 'beads/' + file));
    }
    const oracle = join(scratch, 'profile-oracle');
    execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
      fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', oracle]);
    const answers = execFileSync(oracle, [], { input: Buffer.concat(cases.map((b) => Buffer.from(b))), maxBuffer: 40000000 });
    cases.forEach((b, i) => {
      let accepted = true;
      try { decodeProfile(b, profile); } catch { accepted = false; }
      assert.equal(accepted, answers[i * 493] === 1, `${label}: feature ${b[16]} slot ${b[19]}`);
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return cases.length;
}
const checked = firmwareAgrees(firmwareRef(beta2), p2, beta2.tag);
let sevenNote = 'seven-page firmware agreement skipped (set FIRMWARE_PAGES_REF)';
if (process.env.FIRMWARE_PAGES_REF) {
  const count = firmwareAgrees(process.env.FIRMWARE_PAGES_REF, p7, process.env.FIRMWARE_PAGES_REF);
  sevenNote = `${count} seven-page cases agree with firmware ${process.env.FIRMWARE_PAGES_REF}`;
}
console.log(`PASS option pages: release gate, synthetic seven-page fixture, compaction, guides; ${checked} Beta 2 firmware cases agree; ${sevenNote}`);
