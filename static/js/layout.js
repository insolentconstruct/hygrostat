// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// MIT licence: see encoder.js.
//
// Editor rules for the layout view: where each feature sits on the module and
// how a placement, swap or removal changes the six-byte entries. Every result
// goes through normalise(), so the validator stays the final gate.
import { normalise, initialEntry } from './profile.js?v=a624ef0144a27b33';

export const KNOBS = ['FEEDBACK', 'DRY/WET', 'REVERB'];
// Entry byte for each kind of destination, and how many there are.
export const KINDS = { page: { index: 3, count: 12 }, amount: { index: 4, count: 2 }, action: { index: 5, count: 3 } };
export const pageOf = (slot) => Math.ceil(slot / 3);
export const knobOf = (slot) => KNOBS[(slot - 1) % 3];
export function placeName(kind, slot) {
  if (kind === 'page') return `page ${pageOf(slot)} · ${knobOf(slot)}`;
  if (kind === 'amount') return ['', '[A] + DRY/WET', '[A] + REVERB'][slot];
  return ['', '[A] + SEED', '[A] + FREEZE', 'Hold [A]'][slot];
}
// What an action does, by feature.
export const ACTION_DOES = { 9: 'Start the synth', 13: 'Switch monophonic grains', 14: 'Trim the buffer' };
export const GROUPS = [
  ['Sound', [2, 4, 5, 6, 7, 11, 12, 24]],
  ['Playback', [1, 3, 8, 10, 13, 14, 23]],
  ['Controls', [9, 16, 21]],
  ['Indicators', [15, 17, 18, 19, 20, 22]]
];
export const fits = (f, kind) => Boolean(f[kind]);

export const entryOf = (entries, f) => entries.find((e) => e[0] === f.id) || initialEntry(f);
export const occupant = (entries, kind, slot) => entries.find((e) => e[KINDS[kind].index] === slot);
export const places = (e) => Object.keys(KINDS).filter((k) => e[KINDS[k].index])
  .map((k) => ({ kind: k, slot: e[KINDS[k].index] }));

export function valueLabel(f, value) {
  if (!f.values) return String(value);
  return f.id === 5 && f.values[value] === 'Off' ? 'No limiter' : f.values[value];
}
export function stateLabel(f, state) {
  if (state === 0) return f.id === 12 ? 'No diffusion' : 'Use stock behaviour';
  return state === 1 ? 'Always use this value' : 'Change on the module';
}
// One line for a feature's current setting.
export function summary(f, e) {
  if (!e[1]) return f.id === 12 ? 'No diffusion' : 'Stock';
  return (e[1] === 1 ? 'Always ' : 'Starts ') + valueLabel(f, e[2]);
}

// The previous editor's change rule, unchanged: k is the entry byte.
export function edit(entries, profile, f, k, value) {
  const candidate = entries.map((e) => e.slice());
  let edited = candidate.find((e) => e[0] === f.id);
  if (!edited) { edited = initialEntry(f); candidate.push(edited); }
  edited[k] = value;
  if (k === 1 && value === 1 && f.values?.[0] === 'Off' && !edited[2]) edited[2] = 1;
  if (k === 1 && value !== 2) {
    edited[3] = edited[4] = 0;
    if (!value || !edited[2] || !f.stateless) edited[5] = 0;
  }
  return normalise(candidate, profile);
}

const feature = (profile, id) => profile.features.find((f) => f.id === id);

// Take a feature off one destination. If nothing else controls it, it keeps
// its value as Fixed, or goes back to Off at value 0. A gesture-only setting
// (Fixed and stateless) does nothing without its gesture, so it goes Off.
export function unplace(entries, profile, id, kind) {
  const f = feature(profile, id);
  if (kind === 'action' && entryOf(entries, f)[1] === 1 && f.stateless) return edit(entries, profile, f, 1, 0);
  const next = edit(entries, profile, f, KINDS[kind].index, 0);
  const e = entryOf(next, f);
  if (e[1] !== 2 || places(e).length) return next;
  try {
    return edit(next, profile, f, 1, e[2] ? 1 : 0);
  } catch {
    return edit(next, profile, f, 1, 0); // Synth start Manual needs its gesture.
  }
}
// What unplace() would leave, in words: "goes back to stock behaviour".
export function afterUnplace(entries, profile, id, kind) {
  const f = feature(profile, id);
  const e = entryOf(unplace(entries, profile, id, kind), f);
  if (!e[1]) return f.id === 12 ? 'turns diffusion off' : 'goes back to stock behaviour';
  if (e[1] === 1) return `always uses ${valueLabel(f, e[2])}`;
  return `stays on ${places(e).map((p) => placeName(p.kind, p.slot)).join(' and ')}`;
}

// Put a feature on a destination. mode is 'swap' or 'replace' when the
// destination is taken: swap moves the occupant to the feature's old place of
// the same kind, replace takes the occupant off.
export function place(entries, profile, id, kind, slot, mode = 'replace') {
  const f = feature(profile, id);
  const index = KINDS[kind].index;
  if (!fits(f, kind) || slot < 1 || slot > KINDS[kind].count) throw new Error(`${f.name} cannot go on ${placeName(kind, slot)}.`);
  let next = entries.map((e) => e.slice());
  const own = entryOf(next, f);
  if (own[index] === slot) return normalise(next, profile);
  const taken = occupant(next, kind, slot);
  if (taken && mode === 'swap' && own[index]) {
    // Both already fit this kind; change the two slots together.
    taken[index] = own[index];
    own[index] = slot;
    return normalise(next, profile);
  }
  if (taken) next = unplace(next, profile, taken[0], kind);
  const e = entryOf(next, f);
  if (!(kind === 'action' && e[1] === 1 && e[2] && f.stateless) && e[1] !== 2) next = edit(next, profile, f, 1, 2);
  return edit(next, profile, f, index, slot);
}
export const canSwap = (entries, profile, id, kind, slot) => {
  const own = entryOf(entries, feature(profile, id));
  return Boolean(own[KINDS[kind].index]) && own[KINDS[kind].index] !== slot && Boolean(occupant(entries, kind, slot));
};
// First free destination of a kind, or 0.
export function freeSlot(entries, kind) {
  for (let slot = 1; slot <= KINDS[kind].count; ++slot) if (!occupant(entries, kind, slot)) return slot;
  return 0;
}
// Features that differ from a starting point; omitted entries are Off.
export function changes(entries, start, profile) {
  return profile.features.filter((f) => entryOf(entries, f).join() !== entryOf(start, f).join());
}
