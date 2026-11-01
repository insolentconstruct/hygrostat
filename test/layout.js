// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Layout editor rules: placements, swaps and removals always give valid
// profiles and touch only the features involved; edits keep the previous
// editor's exact bytes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaults, encodeProfile, validate, templates, normalise, initialEntry, modes } from '../static/js/profile.js';
import { KINDS, GROUPS, ACTION_DOES, edit, place, unplace, afterUnplace, canSwap, freeSlot, changes, occupant,
  entryOf, places, valueLabel, stateLabel, summary, placeName } from '../static/js/layout.js';
const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
const profile = manifest.releases[0].profile;
const features = profile.features;
const bytes = (entries) => encodeProfile(entries, profile).join();

// The previous editor's change handler, copied verbatim as the oracle.
function oldChange(entries, f, k, value) {
  const candidate = entries.map((e) => e.slice());
  let e = entries.find((e) => e[0] === f.id);
  if (!e) e = initialEntry(f);
  let edited = candidate.find((e) => e[0] === f.id);
  if (!edited) { edited = e.slice(); candidate.push(edited); }
  edited[k] = value;
  if (k === 1 && value === 1 && f.values?.[0] === 'Off' && !edited[2]) edited[2] = 1;
  if (k === 1 && value !== 2) {
    edited[3] = edited[4] = 0;
    if (!value || !edited[2] || !f.stateless) edited[5] = 0;
  }
  return normalise(candidate, profile);
}
let edits = 0;
for (const [, start] of Object.entries(templates(profile))) {
  for (const f of features) {
    for (const [state] of modes(f)) {
      assert.deepEqual(edit(start, profile, f, 1, state), oldChange(start, f, 1, state));
      const changed = edit(start, profile, f, 1, state);
      for (const value of f.values ? f.values.keys() : [0, 1, 128, 255]) {
        let ours, theirs;
        try { ours = edit(changed, profile, f, 2, value); } catch { ours = 'refused'; }
        try { theirs = oldChange(changed, f, 2, value); } catch { theirs = 'refused'; }
        assert.deepEqual(ours, theirs, `${f.name} value ${value}`);
        edits++;
      }
    }
  }
}

// Every feature returns to the exact Stock bytes from Fixed.
const stock = templates(profile)['Stock plus fixes'];
for (const f of features) {
  assert.equal(bytes(edit(edit(stock, profile, f, 1, 1), profile, f, 1, 0)), bytes(stock), `${f.name}: Off bytes`);
}

const others = (a, b, ids) => features.filter((f) => !ids.includes(f.id))
  .every((f) => entryOf(a, f).join() === entryOf(b, f).join());
let placements = 0;
for (const [name, start] of Object.entries(templates(profile))) {
  for (const kind of Object.keys(KINDS)) {
    const index = KINDS[kind].index;
    for (const f of features.filter((f) => f[kind])) {
      for (let slot = 1; slot <= KINDS[kind].count; ++slot) {
        const taken = occupant(start, kind, slot);
        const before = entryOf(start, f);
        for (const mode of ['replace', 'swap']) {
          const next = place(start, profile, f.id, kind, slot, mode);
          validate(next, profile);
          assert.equal(entryOf(next, f)[index], slot, `${name}: ${f.name} on ${placeName(kind, slot)}`);
          assert.equal(occupant(next, kind, slot)[0], f.id);
          const ids = [f.id, ...(taken ? [taken[0]] : [])];
          assert(others(start, next, ids), `${name}: only ${ids} change`);
          if (taken && taken[0] !== f.id) {
            const y = features.find((g) => g.id === taken[0]);
            const after = entryOf(next, y);
            if (mode === 'swap' && before[index]) {
              assert(canSwap(start, profile, f.id, kind, slot));
              assert.equal(after[index], before[index], 'the occupant takes the old place');
              assert.equal(after[1], taken[1]); assert.equal(after[2], taken[2]);
            } else {
              assert.equal(after[index], 0, 'the occupant leaves');
              assert.deepEqual(after, entryOf(unplace(start, profile, y.id, kind), y));
            }
          }
          // The feature keeps its value wherever it goes.
          if (before[1]) assert.equal(entryOf(next, f)[2], before[2]);
          placements++;
        }
      }
    }
  }
}

// Removing a feature from its only control keeps its value as Fixed, or Off at 0.
const drizzlet = defaults(profile);
for (const e of drizzlet) {
  const f = features.find((f) => f.id === e[0]);
  for (const p of places(e)) {
    const next = unplace(drizzlet, profile, f.id, p.kind);
    validate(next, profile);
    const after = entryOf(next, f);
    assert.equal(after[KINDS[p.kind].index], 0);
    assert(others(drizzlet, next, [f.id]));
    if (places(e).length === 1 && e[1] === 2) assert.deepEqual(after.slice(1, 3), e[2] ? [1, e[2]] : [0, 0]);
    assert.match(afterUnplace(drizzlet, profile, f.id, p.kind), /^(goes back|always uses|stays on|turns)/);
  }
}
// Gesture-only settings go Off without their gesture; Synth start Fixed Manual too.
assert.deepEqual(entryOf(unplace(drizzlet, profile, 14, 'action'), features[13]), [14, 0, 0, 0, 0, 0]);
const manual = edit(edit(drizzlet, profile, features[8], 2, 1), profile, features[8], 1, 1);
assert.deepEqual(entryOf(manual, features[8]), [9, 1, 1, 0, 0, 3]);
assert.deepEqual(entryOf(unplace(manual, profile, 9, 'action'), features[8]), [9, 0, 0, 0, 0, 0]);
// Swapping gestures with Fixed Manual Synth start keeps both valid.
const swapped = place(manual, profile, 13, 'action', 3, 'swap');
assert.deepEqual(entryOf(swapped, features[8]), [9, 1, 1, 0, 0, 1]);
assert.equal(entryOf(swapped, features[12])[5], 3);
assert.deepEqual(entryOf(place(manual, profile, 9, 'action', 2, 'swap'), features[13]), [14, 1, 1, 0, 0, 3]);
// A Fixed stateless setting keeps Fixed when its gesture moves.
assert.deepEqual(entryOf(place(drizzlet, profile, 14, 'action', 1, 'swap'), features[13]), [14, 1, 1, 0, 0, 1]);
assert.equal(entryOf(place(drizzlet, profile, 14, 'action', 1, 'swap'), features[12])[5], 2);
assert.throws(() => place(drizzlet, profile, 15, 'page', 1));
assert.throws(() => place(drizzlet, profile, 1, 'page', 13));
assert.equal(freeSlot(drizzlet, 'page'), 10);
assert.equal(freeSlot(drizzlet, 'amount'), 0);
assert.equal(changes(drizzlet, drizzlet, profile).length, 0);
assert.deepEqual(changes(stock, drizzlet, profile).length, 14);

assert.equal(valueLabel(features[4], 2), 'No limiter');
assert.equal(valueLabel(features[0], 0), 'Off');
assert.equal(stateLabel(features[11], 0), 'No diffusion');
assert.deepEqual([0, 1, 2].map((s) => stateLabel(features[0], s)),
  ['Use stock behaviour', 'Always use this value', 'Change on the module']);
assert.equal(summary(features[0], [1, 2, 3, 1, 0, 0]), 'Starts Major');
assert.equal(summary(features[4], [5, 1, 2, 0, 0, 0]), 'Always No limiter');
assert.deepEqual(GROUPS.flatMap(([, ids]) => ids).sort((a, b) => a - b), features.map((f) => f.id));
for (const f of features.filter((f) => f.action)) assert(ACTION_DOES[f.id], f.name);
console.log(`PASS layout: ${edits} edits match the previous editor, ${placements} placements and swaps valid and local, removals keep values`);
