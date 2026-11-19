// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Beta 4 [A] hold rules (#291, #292) on a synthetic release; no release has them yet.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { validate, encodeProfile, decodeProfile, defaults, templates, crc32, modes } from '../static/js/profile.js';
import { KINDS, edit, place, adjust, unplace, afterUnplace, canSwap, freeSlot, fits, fitsSlot, entryOf, occupant,
  places } from '../static/js/layout.js';
// The firmware pull request's commit; bump it (or set HOLD_RULES_FIRMWARE_REF) when that branch moves.
const ref = process.env.HOLD_RULES_FIRMWARE_REF || '3619f9bb368c89afe2571618a3c9b4f0840335e0';
const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url), 'utf8'));
assert(manifest.releases.every((r) => !r.profile.hold_rules), 'no release has the hold rules yet');
const beta3 = manifest.releases.find((r) => r.slug === 'beta-3-smirr');
const release = structuredClone(beta3);
Object.assign(release, { tag: 'drizzlet-dev-hold-rules', name: 'Synthetic fixture (never offered)',
  development: true, source_commit: ref });
release.profile.hold_rules = true;
const profile = release.profile;
const features = profile.features;
const byId = (id) => features.find((f) => f.id === id);
const [start, mono, trim] = [9, 13, 14].map(byId);

// Only Synth start goes on the [A] hold; Synth start needs a gesture unless Automatic.
for (const f of [mono, trim]) {
  for (let action = 1; action <= 3; ++action) {
    const e = [f.id, 2, 0, 0, 0, action];
    if (action === 3) {
      assert.throws(() => validate([e], profile), /not allowed/);
      validate([e], beta3.profile);
    } else validate([e], profile);
  }
}
for (let action = 0; action <= 3; ++action) {
  const ok = action !== 0;
  for (const e of [[9, 2, 0, 9, 0, action], [9, 2, 1, 0, 0, action], [9, 1, 1, 0, 0, action]]) {
    if (ok) validate([e], profile); else assert.throws(() => validate([e], profile), /not allowed/);
  }
  validate([[9, 1, 0, 0, 0, 0]], profile);
}
validate([[9, 2, 0, 9, 0, 0]], beta3.profile);

// The editor never offers the hold to anything else, and keeps Synth start's gesture.
const factory = defaults(profile);
for (const f of [mono, trim]) {
  assert(!fitsSlot(profile, f, 'action', 3) && fitsSlot(beta3.profile, f, 'action', 3));
  assert.throws(() => place(factory, profile, f.id, 'action', 3), /cannot go on Hold \[A\]/);
  assert.notEqual(freeSlot([], 'action', profile, f), 3);
}
const startOnSeed = place(factory, profile, 9, 'action', 1);
assert.equal(freeSlot(startOnSeed, 'action', profile, mono), 0, 'trim on FREEZE, Synth start on SEED');
assert(!canSwap(factory, profile, 9, 'action', 2), 'trim cannot take the hold in a swap');
assert.deepEqual(entryOf(place(factory, profile, 9, 'action', 2, 'swap'), trim), [14, 0, 0, 0, 0, 0]);
const stock = templates(profile)['Stock plus fixes'];
assert.deepEqual(entryOf(place(stock, profile, 9, 'page', 9), start), [9, 2, 0, 9, 0, 3]);
assert.deepEqual(entryOf(adjust(stock, profile, start), start), [9, 2, 0, 1, 0, 3]);
assert.deepEqual(entryOf(unplace(factory, profile, 9, 'action'), start), [9, 0, 0, 0, 0, 0]);
assert.match(afterUnplace(factory, profile, 9, 'action'), /^goes back/);
assert.deepEqual(entryOf(unplace(factory, profile, 9, 'page'), start), [9, 2, 0, 0, 0, 3]);
assert.deepEqual(entryOf(adjust(startOnSeed, profile, mono), mono), [13, 2, 0, 0, 0, 0], 'no free gesture but the hold');
// The previous rules stay with the releases that have them.
assert.deepEqual(entryOf(place(stock, beta3.profile, 9, 'page', 9), start), [9, 2, 0, 9, 0, 0]);
assert.deepEqual(entryOf(place(factory, beta3.profile, 13, 'action', 3), mono), [13, 2, 0, 0, 0, 3]);

// Without the rules, "Change on the module" keeps the previous editor's bytes.
const previous = (entries, p, f) => {
  let next = edit(entries, p, f, 1, 2);
  if (!places(entryOf(next, f)).length) {
    const kind = ['page', 'amount', 'action'].find((k) => fits(f, k) && freeSlot(next, k, p));
    if (kind) next = edit(next, p, f, KINDS[kind].index, freeSlot(next, kind, p));
  }
  return next;
};
for (const entries of Object.values(templates(beta3.profile))) {
  for (const f of beta3.profile.features.filter((f) => modes(f).some(([state]) => state === 2))) {
    let ours, theirs;
    try { ours = adjust(entries, beta3.profile, f); } catch { ours = 'refused'; }
    try { theirs = previous(entries, beta3.profile, f); } catch { theirs = 'refused'; }
    assert.deepEqual(ours, theirs, f.name);
  }
}

// Every placement from every template either gives a valid profile or is refused.
let placements = 0;
for (const [name, entries] of Object.entries(templates(profile))) {
  for (const kind of Object.keys(KINDS)) {
    for (const f of features.filter((f) => f[kind])) {
      for (let slot = 1; slot <= KINDS[kind].count; ++slot) {
        for (const mode of ['replace', 'swap']) {
          if (!fitsSlot(profile, f, kind, slot)) {
            assert.throws(() => place(entries, profile, f.id, kind, slot, mode), /cannot go on/);
            continue;
          }
          const next = place(entries, profile, f.id, kind, slot, mode);
          validate(next, profile);
          assert.equal(occupant(next, kind, slot)[0], f.id, `${name}: ${f.name}`);
          ++placements;
        }
      }
    }
    for (const f of features.filter((f) => f[kind])) validate(adjust(entries, profile, f), profile);
  }
}

// The firmware's own parser agrees on every Synth start, monophonic and trim entry.
const reseal = (b) => { const end = 16 + new DataView(b.buffer).getUint16(6, true); new DataView(b.buffer).setUint32(end, crc32(b.subarray(0, end)), true); return b; };
const listing = (entries) => {
  const b = encodeProfile([], profile);
  b[5] = entries.length; b[6] = 6 * entries.length;
  entries.forEach((e, i) => b.set(e, 16 + 6 * i));
  return reseal(b);
};
const cases = [encodeProfile(factory, profile)];
for (const id of [9, 13, 14]) {
  for (let state = 0; state <= 2; ++state) {
    for (let value = 0; value <= 1; ++value) {
      for (const page of [0, 9]) for (let action = 0; action <= 3; ++action) cases.push(listing([[id, state, value, page, 0, action]]));
    }
  }
}
const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-hold-oracle-'));
try {
  mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
  for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) writeFileSync(join(scratch, 'beads', file), firmwareShow(ref, 'beads/' + file));
  const oracle = join(scratch, 'profile-oracle');
  execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
    fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', oracle]);
  const answers = execFileSync(oracle, [], { input: Buffer.concat(cases.map((b) => Buffer.from(b))) });
  const stride = 493;
  assert.equal(answers.length, cases.length * stride);
  let accepted = 0;
  cases.forEach((b, i) => {
    let decoded = null;
    try { decoded = decodeProfile(b, profile); } catch { /* compared with the firmware below */ }
    assert.equal(Boolean(decoded), answers[i * stride] === 1, `firmware case ${i}: ${Array.from(b.subarray(16, 22))}`);
    if (decoded) {
      ++accepted;
      assert.deepEqual(decoded.flat(), Array.from(answers.subarray(i * stride + 1, i * stride + 1 + decoded.length * 6)));
    }
  });
  assert(accepted > 10 && accepted < cases.length, `accepted ${accepted} of ${cases.length}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`PASS [A] hold rules: validator, editor (${placements} placements) and the firmware parser at ${ref.slice(0, 7)}`);
