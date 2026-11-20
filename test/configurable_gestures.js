// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Beta 4 [A] toggles and the [A] + FEEDBACK slot (#301) on a synthetic release; no release has them yet.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { validate, encodeProfile, decodeProfile, defaults, templates, normalise, crc32, newGestures, gestureFirmware,
  GAIN } from '../static/js/profile.js';
import { KINDS, GROUPS, ACTION_DOES, place, adjust, unplace, afterUnplace, canSwap, freeSlot, fitsSlot, entryOf, occupant,
  places, placeName, slotCount, summary, stateLabel, edit } from '../static/js/layout.js';
import { guide } from '../static/js/guide.js';
import { featureHelp, actionHelp } from '../static/js/help.js';
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const text = (svg) => [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((m) => m[1]).join(' ');
// The firmware pull request's commit, and the parser before it; bump them (or set the variables) when that branch moves.
const ref = process.env.GESTURES_FIRMWARE_REF || '13bf966c838edde1401ae45deaeb29292d21d1d9';
const before = process.env.GESTURES_BASE_FIRMWARE_REF || 'f5f9212b55d0aec33f1e8c0ae1a1808d4cf88789';
const manifest = JSON.parse(read('../static/manifest.json'));
assert(manifest.releases.every((r) => !r.profile.feedback_slot && !r.profile.features.some((f) => f.id === GAIN)),
  'no release has the FEEDBACK slot yet');
const beta3 = manifest.releases.find((r) => r.slug === 'beta-3-smirr');
const release = structuredClone(beta3);
Object.assign(release, { tag: 'drizzlet-dev-gestures', name: 'Synthetic fixture (never offered)',
  development: true, source_commit: ref });
const TOGGLES = [2, 4, 6, 7, 23];
for (const f of release.profile.features) if (TOGGLES.includes(f.id)) f.action = true;
release.profile.features.push(...JSON.parse(read('fixtures/gesture-features.json')));
Object.assign(release.profile, { hold_rules: true, feedback_slot: true });
const profile = release.profile;
const byId = (id) => profile.features.find((f) => f.id === id);
const gain = byId(GAIN);
const factory = defaults(profile);

// The validator: toggles on SEED and FREEZE when Adjustable; never on the hold.
for (const id of TOGGLES) {
  for (let action = 1; action <= 3; ++action) {
    const e = [id, 2, 0, 0, 0, action];
    // The Synth toggle goes on [A] + SEED only.
    if (action === 3 || (id === 7 && action === 2)) assert.throws(() => validate([e], profile), /not allowed/);
    else validate([e], profile);
    assert.throws(() => validate([e], beta3.profile), /not allowed/);
    assert.throws(() => validate([[id, 1, 1, 0, 0, action]], profile), /not allowed/);
  }
  assert(fitsSlot(profile, byId(id), 'action', 1) && fitsSlot(profile, byId(id), 'action', 2) === (id !== 7));
  assert(!fitsSlot(profile, byId(id), 'action', 3));
  assert(ACTION_DOES[id] && actionHelp(byId(id)).includes('two values'));
  assert.equal(actionHelp(beta3.profile.features.find((f) => f.id === id)), '');
}
assert.match(actionHelp(byId(4)), /clears the recording/);
assert.match(actionHelp(byId(7)), /\[A\] \+ SEED only/);
assert.throws(() => place(defaults(profile), profile, 7, 'action', 2), /cannot go on \[A\] \+ FREEZE/);

// Manual gain: Off is FEEDBACK; a moved gain or another FEEDBACK amount needs the slot.
const W = 11, D = 12;
for (const entries of [[[GAIN, 0, 0, 0, 0, 0]], [[GAIN, 2, 0, 0, 1, 0]], [[GAIN, 2, 0, 0, 3, 0]], [[GAIN, 1, 0, 0, 0, 0]],
  [[GAIN, 1, 0, 0, 0, 0], [W, 2, 0, 0, 3, 0]], [[GAIN, 2, 0, 0, 1, 0], [W, 2, 0, 0, 3, 0], [D, 2, 0, 0, 2, 0]]]) {
  validate(entries, profile);
}
for (const entries of [[[W, 2, 0, 0, 3, 0]], [[GAIN, 0, 0, 0, 0, 0], [D, 2, 0, 0, 3, 0]], [[GAIN, 2, 0, 0, 3, 0], [W, 2, 0, 0, 3, 0]],
  [[GAIN, 2, 0, 0, 1, 0], [W, 2, 0, 0, 1, 0]], [[GAIN, 2, 0, 0, 0, 0]], [[GAIN, 1, 1, 0, 0, 0]], [[GAIN, 2, 0, 1, 1, 0]],
  [[GAIN, 2, 0, 0, 1, 1]], [[GAIN, 1, 0, 0, 2, 0]], [[GAIN, 2, 0, 0, 4, 0]]]) {
  assert.throws(() => validate(entries, profile), /not allowed|already|manual gain/, JSON.stringify(entries));
}
assert.throws(() => validate([[W, 2, 0, 0, 3, 0]], beta3.profile), /not allowed/);
assert.throws(() => validate([[GAIN, 1, 0, 0, 0, 0]], beta3.profile), /Unknown/);
assert.deepEqual(normalise([[GAIN, 2, 0, 0, 3, 0]], profile), []);
assert.equal(slotCount('amount', profile), 3);
assert.equal(slotCount('amount', beta3.profile), 2);
assert.equal(KINDS.amount.count, 2);
assert.equal(placeName('amount', 3), '[A] + FEEDBACK');
assert(GROUPS.some(([, ids]) => ids.includes(GAIN)));

// Profiles without the new gestures encode as before and need no new firmware.
assert.deepEqual(encodeProfile(factory, profile), encodeProfile(defaults(beta3.profile), beta3.profile));
for (const entries of Object.values(templates(beta3.profile))) {
  assert.deepEqual(encodeProfile(entries, profile), encodeProfile(entries, beta3.profile));
  assert(!newGestures(entries) && !gestureFirmware(entries));
}
assert.match(gestureFirmware([[4, 2, 0, 7, 0, 1]]), /Beta 4/);
assert(newGestures([[GAIN, 1, 0, 0, 0, 0]]) && newGestures([[W, 2, 0, 0, 3, 0], [GAIN, 1, 0, 0, 0, 0]]));
assert(!newGestures([[4, 2, 0, 7, 0, 0], [9, 2, 0, 9, 0, 1]]));

// The editor shows Off gain on FEEDBACK and keeps it Off in the bytes.
assert.deepEqual(entryOf(factory, gain), [GAIN, 2, 0, 0, 3, 0]);
assert.deepEqual(occupant(factory, 'amount', 3), [GAIN, 2, 0, 0, 3, 0]);
assert.equal(freeSlot(factory, 'amount', profile), 0);
assert.equal(summary(gain, entryOf(factory, gain)), 'Input gain');
assert.equal(stateLabel(gain, 1), 'On no knob');
const toDryWet = place(factory, profile, GAIN, 'amount', 1);
assert.deepEqual(entryOf(toDryWet, gain), [GAIN, 2, 0, 0, 1, 0]);
assert.deepEqual(entryOf(toDryWet, byId(W)), [W, 0, 0, 0, 0, 0], 'width at 0 goes back to stock');
assert(!occupant(toDryWet, 'amount', 3));
const swapped = place(factory, profile, GAIN, 'amount', 1, 'swap');
assert.deepEqual([entryOf(swapped, gain)[4], entryOf(swapped, byId(W))[4]], [1, 3]);
assert(canSwap(factory, profile, W, 'amount', 3));
const widthOnFeedback = place(factory, profile, W, 'amount', 3);
assert.deepEqual(entryOf(widthOnFeedback, gain), [GAIN, 1, 0, 0, 0, 0]);
assert.equal(afterUnplace(factory, profile, GAIN, 'amount'), 'is on no knob');
const fixed = unplace(factory, profile, GAIN, 'amount');
assert.deepEqual(entryOf(fixed, gain), [GAIN, 1, 0, 0, 0, 0]);
assert.deepEqual(adjust(fixed, profile, gain), factory, 'back on FEEDBACK is Off');
assert.deepEqual(edit(fixed, profile, gain, 1, 0), factory);
assert(!place(toDryWet, profile, GAIN, 'amount', 3).some((e) => e[0] === GAIN), 'back on FEEDBACK is Off');
for (const f of [byId(4), byId(23)]) {
  const on = place(factory, profile, f.id, 'action', 1);
  assert.deepEqual(places(entryOf(on, f)).find((p) => p.kind === 'action'), { kind: 'action', slot: 1 });
  assert.equal(entryOf(on, f)[1], 2);
  validate(on, profile);
}
// Every placement from every template gives a valid profile or is refused.
let placements = 0;
for (const entries of Object.values(templates(profile))) {
  for (const kind of ['amount', 'action']) {
    for (const f of profile.features.filter((f) => f[kind])) {
      for (let slot = 1; slot <= slotCount(kind, profile); ++slot) {
        for (const mode of ['replace', 'swap']) {
          if (!fitsSlot(profile, f, kind, slot)) continue;
          const next = place(entries, profile, f.id, kind, slot, mode);
          validate(next, profile);
          assert.equal(occupant(next, kind, slot)[0], f.id);
          ++placements;
        }
      }
      const off = unplace(entries, profile, f.id, kind);
      validate(off, profile);
    }
  }
}

// Guides name each gesture; stock wording is unchanged.
const lines = (entries) => text(guide(entries, release, 'abcd1234', false));
assert.match(lines(factory), /Manual gain: hold \[A\] and turn FEEDBACK\./);
assert.match(lines(swapped), /Manual gain: hold \[A\] and turn DRY\/WET\..*\[A\]\+FEEDBACK: Stereo width|\[A\]\+FEEDBACK: Stereo width.*Manual gain: hold \[A\] and turn DRY\/WET\./);
assert.match(lines(fixed), /Manual gain: on no knob\./);
assert.match(lines(place(factory, profile, 4, 'action', 2)), /\[A\]\+FREEZE: Processor\. Switch Granular \(Stock\) \/ Spectral.*clears the recording/);
assert(!lines(fixed).includes('Manual gain knob'));
const help = featureHelp(gain, release);
assert(help.description.length > 15 && help.description.length < 180);
assert.equal(new URL(help.url).hash, '#a-gestures-in-profiles');

// The firmware's catalogue, documentation and parser.
const catalogue = JSON.parse(firmwareShow(ref, 'beads/build/profile-features.json', { encoding: 'utf8' }));
const docs = firmwareShow(ref, 'beads/build/docs/FEATURES.md', { encoding: 'utf8' });
const row = catalogue.features.find((c) => c.id === GAIN);
assert.equal(row.name, gain.name);
assert.deepEqual([row.values, row.states, row.field, row.default_state], [gain.values, gain.states, gain.field, 'Off']);
assert.deepEqual([row.page_slots, row.amount_slots, row.actions], [[], [1, 2, 3], []]);
for (const id of TOGGLES) assert.deepEqual(catalogue.features.find((c) => c.id === id).actions, id === 7 ? [1] : [1, 2]);
for (const id of [W, D]) assert.deepEqual(catalogue.features.find((c) => c.id === id).amount_slots, [1, 2, 3]);
assert(docs.includes('\n### [A] gestures in profiles\n'));
assert(/\bAMOUNT_FEEDBACK\b/.test(firmwareShow(ref, 'beads/profile.h', { encoding: 'utf8' })));

const reseal = (b) => { const end = 16 + new DataView(b.buffer).getUint16(6, true); new DataView(b.buffer).setUint32(end, crc32(b.subarray(0, end)), true); return b; };
const listing = (entries) => {
  const b = encodeProfile([], profile);
  b[5] = entries.length; b[6] = 6 * entries.length;
  entries.forEach((e, i) => b.set(e, 16 + 6 * i));
  return reseal(b);
};
const cases = [encodeProfile(factory, profile), encodeProfile(swapped, profile), encodeProfile(fixed, profile),
  listing([[7, 2, 0, 0, 0, 1]]), listing([[7, 2, 0, 0, 0, 2]])];
for (const id of [...TOGGLES, 9, 11, 12, 13, 14, GAIN]) {
  for (let state = 0; state <= 3; ++state) for (const value of [0, 1, 2]) for (const page of [0, 1]) {
    for (let amount = 0; amount <= 4; ++amount) for (let action = 0; action <= 4; ++action) {
      cases.push(listing([[id, state, value, page, amount, action]]));
    }
  }
}
for (let a = 0; a <= 3; ++a) for (let b = 0; b <= 3; ++b) for (let g = 0; g <= 2; ++g) for (let s = 0; s <= 3; ++s) {
  cases.push(listing([[GAIN, g, 0, 0, s, 0], [W, 2, 0, 0, a, 0], [D, 2, 0, 0, b, 0]]));
  cases.push(listing([[W, 2, 0, 0, a, 0], [D, 2, 0, 0, b, 0]]));
}
const oracle = (commit) => {
  const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-gestures-oracle-'));
  try {
    mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
    for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) writeFileSync(join(scratch, 'beads', file), firmwareShow(commit, 'beads/' + file));
    const program = join(scratch, 'profile-oracle');
    execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
      fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', program]);
    return execFileSync(program, [], { input: Buffer.concat(cases.map((b) => Buffer.from(b))), maxBuffer: 1 << 28 });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};
const answers = oracle(ref);
const old = oracle(before);
// The firmware takes the Synth toggle on [A] + SEED and refuses it on [A] + FREEZE; the parser before it refuses both.
assert.deepEqual([3, 4].map((i) => answers[i * (answers.length / cases.length)]), [1, 0]);
assert.deepEqual([3, 4].map((i) => old[i * (old.length / cases.length)]), [0, 0]);
const stride = answers.length / cases.length;
assert(Number.isInteger(stride) && stride > 6 && old.length === answers.length);
let accepted = 0, unchanged = 0;
cases.forEach((b, i) => {
  let decoded = null;
  try { decoded = decodeProfile(b, profile); } catch { /* compared with the firmware below */ }
  const label = `firmware case ${i}: ${Array.from(b.subarray(16, 16 + 6 * b[5]))}`;
  assert.equal(Boolean(decoded), answers[i * stride] === 1, label);
  if (decoded) {
    ++accepted;
    assert.deepEqual(decoded.flat(), Array.from(answers.subarray(i * stride + 1, i * stride + 1 + decoded.length * 6)), label);
  }
  // Without the new gestures, the firmware before them answers the same.
  const entries = Array.from({ length: b[5] }, (_, k) => Array.from(b.subarray(16 + 6 * k, 22 + 6 * k)));
  if (!entries.some((e) => e[0] === GAIN || e[4] >= 3 || (e[5] && TOGGLES.includes(e[0])))) {
    assert.deepEqual(old.subarray(i * stride, (i + 1) * stride), answers.subarray(i * stride, (i + 1) * stride), label);
    ++unchanged;
  }
});
assert(accepted > 100 && accepted < cases.length, `accepted ${accepted} of ${cases.length}`);
console.log(`PASS [A] toggles and FEEDBACK slot: validator, editor (${placements} placements), guides, ` +
  `the firmware parser at ${ref.slice(0, 7)} (${accepted} of ${cases.length} accepted) and ${unchanged} unchanged against ${before.slice(0, 7)}`);
