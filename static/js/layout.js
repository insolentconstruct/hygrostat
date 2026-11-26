// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// MIT licence: see encoder.js.
//
// Editor rules for the layout view: where each feature sits on the module and
// how a placement, swap or removal changes the six-byte entries. Every result
// goes through normalise(), so the validator stays the final gate.
import { normalise, initialEntry, pageLeds, pageSlots, amountSlots, GAIN, FEEDBACK_SLOT, SYNTH } from './profile.js?v=51ce921e4a13abc4';

export const KNOBS = ['FEEDBACK', 'DRY/WET', 'REVERB'];
// Entry byte for each kind of destination, and how many there are; a
// release's page positions come from slotCount.
export const KINDS = { page: { index: 3, count: 12 }, amount: { index: 4, count: 2 }, action: { index: 5, count: 3 } };
export const slotCount = (kind, profile) => kind === 'page' ? pageSlots(profile) :
  kind === 'amount' ? amountSlots(profile) : KINDS[kind].count;
export const pageOf = (slot) => Math.ceil(slot / 3);
export const knobOf = (slot) => KNOBS[(slot - 1) % 3];
export function placeName(kind, slot) {
  if (kind === 'page') return `page ${pageOf(slot)} · ${knobOf(slot)}`;
  if (kind === 'amount') return ['', '[A] + DRY/WET', '[A] + REVERB', '[A] + FEEDBACK'][slot];
  return ['', '[A] + SEED', '[A] + FREEZE', 'Hold [A]'][slot];
}
// What an action does, by feature.
export const ACTION_DOES = { 9: 'Start the synth', 13: 'Switch monophonic grains', 14: 'Trim the buffer',
  2: 'Switch reverb character', 4: 'Switch processor', 6: 'Switch frozen feedback', 7: 'Switch synth',
  23: 'Switch TIME modulation' };
export const GROUPS = [
  ['Sound', [2, 4, 5, 6, 7, 42, 11, 12, 24, 39, 41, 43, 44, 45, 46, 47, 48, 49, 31, 32, 33]],
  ['Playback', [1, 3, 8, 10, 13, 14, 23, 26, 28]],
  ['Controls', [9, 16, 21, 25, 27, 29, 30, 37, 38, 40]],
  ['Indicators', [15, 17, 18, 19, 20, 22]]
];
// Catalogue features without an explicit group appear under Sound.
export function libraryGroups(profile) {
  const known = new Set(GROUPS.flatMap(([, ids]) => ids));
  const ungrouped = profile.features.filter(({ id }) => !known.has(id)).map(({ id }) => id);
  return GROUPS.map(([name, ids]) => [name, name === 'Sound' ? [...ids, ...ungrouped] : ids]);
}
// Extras by what they change; an unlisted ID shows under Sound.
export const EXTRA_GROUPS = [
  ['Sound', [16, 23, 24, 26, 28, 30, 31, 32, 33]],
  ['Startup', [15, 27, 29, 39]],
  ['Indicators and interface', [17, 19, 20, 22, 25, 37, 38]]
];
export const extraGroup = (f) => EXTRA_GROUPS.find(([, ids]) => ids.includes(f.id))?.[0] ?? 'Sound';
// An extra's control: a switch for Off/On, a 0-255 number for a one-byte value, else a list.
export const extraControl = (f) => !f.values ? 'number' :
  f.values.length === 2 && f.values[0] === 'Off' && !f.page ? 'switch' : 'select';
export const fits = (f, kind) => Boolean(f[kind]);
// With hold_rules, only Synth start goes on the [A] hold, and it keeps a gesture.
const holdRules = (profile) => profile.hold_rules === true;
export const fitsSlot = (profile, f, kind, slot) => fits(f, kind) &&
  !(holdRules(profile) && kind === 'action' && slot === 3 && f.id !== 9) && !(kind === 'action' && slot === 2 && f.id === SYNTH);
// A setting with no destination, such as the Plaits bank, has its own gesture.
export const placeable = (f) => Object.keys(KINDS).some((kind) => fits(f, kind));
// In Plaits synth play [A] + FREEZE steps the bank, unless Synth start is there.
export function bankWarning(entries, profile) {
  if (!profile.features.some((f) => f.id === 31) || entries.find((e) => e[0] === 9)?.[5] !== 2) return '';
  return `Synth start is on ${placeName('action', 2)}, so the Plaits bank can’t be changed while the Plaits synth plays: ` +
    'it stays on its starting bank. Move Synth start to another gesture to step the banks.';
}

// Manual gain left Off is on [A] + FEEDBACK: the editor shows and edits that
// placement, and normalise() writes it back as Off.
const IMPLICIT_GAIN = [GAIN, 2, 0, 0, FEEDBACK_SLOT, 0];
const gainOff = (entries) => !entries.some((e) => e[0] === GAIN && e[1]);
export const entryOf = (entries, f) => f.id === GAIN && gainOff(entries) ? IMPLICIT_GAIN.slice() :
  entries.find((e) => e[0] === f.id) || initialEntry(f);
export const occupant = (entries, kind, slot) => entries.find((e) => e[KINDS[kind].index] === slot) ||
  (kind === 'amount' && slot === FEEDBACK_SLOT && gainOff(entries) ? IMPLICIT_GAIN.slice() : undefined);
// Working copy with the implicit gain entry, for releases that have it.
const explicit = (entries, profile) => {
  const copy = entries.filter((e) => e[0] !== GAIN || e[1]).map((e) => e.slice());
  return profile.features.some((f) => f.id === GAIN) && gainOff(entries) ? [...copy, IMPLICIT_GAIN.slice()] : copy;
};
export const places = (e) => Object.keys(KINDS).filter((k) => e[KINDS[k].index])
  .map((k) => ({ kind: k, slot: e[KINDS[k].index] }));

export function valueLabel(f, value) {
  if (!f.values) return String(value);
  if (f.id === GAIN) return 'On no knob';
  return f.id === 5 && f.values[value] === 'Off' ? 'No limiter' : f.values[value];
}
export function stateLabel(f, state) {
  if (f.id === GAIN) return ['On [A] + FEEDBACK', 'On no knob', 'On a knob'][state];
  if (state === 0) return f.id === 12 ? 'No diffusion' : 'Use stock behaviour';
  if (f.id === 39) return 'Start in this quality';
  return state === 1 ? 'Always use this value' : 'Change on the module';
}
// The hint under each state choice.
export function stateHint(f, state) {
  if (f.id === GAIN) return state === 1 ? 'Hold [A] still returns to automatic gain.' : 'Hold [A] and turn it; releasing [A] saves the gain.';
  if (state === 0) return f.id === 12 ? 'Grains go to the reverb unsoftened.' : 'As in Mutable Instruments’ firmware.';
  if (state === 1) return f.id === 39 ? 'Each start-up until something is saved; [A] still changes it, and once saved your choice wins.' : 'No control on the module.';
  return placeable(f) ? 'On a control; your changes are saved.' : 'Its own gesture changes it; your changes are saved.';
}
// One line for a feature's current setting.
export function summary(f, e) {
  if (f.id === GAIN) return e[1] === 1 ? 'On no knob' : 'Input gain';
  if (!e[1]) return f.id === 12 ? 'No diffusion' : 'Stock';
  // Start in quality applies at each start-up until something is saved.
  if (f.id === 39) return e[2] ? 'Starts in ' + valueLabel(f, e[2]) : valueLabel(f, 0);
  return (e[1] === 1 ? 'Always ' : 'Starts ') + valueLabel(f, e[2]);
}

// The previous editor's change rule, unchanged: k is the entry byte.
export function edit(entries, profile, f, k, value) {
  const candidate = explicit(entries, profile);
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

// Several bytes of one entry at once, so no step in between has to be valid.
function set(entries, profile, f, changes) {
  const candidate = explicit(entries, profile);
  let edited = candidate.find((e) => e[0] === f.id);
  if (!edited) { edited = initialEntry(f); candidate.push(edited); }
  for (const [k, value] of Object.entries(changes)) edited[k] = value;
  return normalise(candidate, profile);
}

// Take a feature off one destination. If nothing else controls it, it keeps
// its value as Fixed, or goes back to Off at value 0. A gesture-only setting
// (Fixed and stateless) does nothing without its gesture, so it goes Off.
export function unplace(entries, profile, id, kind) {
  const f = feature(profile, id);
  // Synth start without its gesture goes Off, page included.
  if (kind === 'action' && ((entryOf(entries, f)[1] === 1 && f.stateless) || (holdRules(profile) && id === 9))) {
    return edit(entries, profile, f, 1, 0);
  }
  // Manual gain off its knob is on no knob; Off would put it back on FEEDBACK.
  if (id === GAIN) return edit(entries, profile, f, 1, 1);
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
  if (id === GAIN) return 'is on no knob';
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
  if (!fitsSlot(profile, f, kind, slot) || slot < 1 || slot > slotCount(kind, profile)) throw new Error(`${f.name} cannot go on ${placeName(kind, slot)}.`);
  let next = explicit(entries, profile);
  const own = entryOf(next, f);
  if (own[index] === slot) return normalise(next, profile);
  const taken = occupant(next, kind, slot);
  if (taken && mode === 'swap' && own[index] && fitsSlot(profile, feature(profile, taken[0]), kind, own[index])) {
    // Both already fit this kind; change the two slots together.
    taken[index] = own[index];
    own[index] = slot;
    return normalise(next, profile);
  }
  if (taken) next = unplace(next, profile, taken[0], kind);
  const e = entryOf(next, f);
  const changes = { [index]: slot };
  if (!(kind === 'action' && e[1] === 1 && e[2] && f.stateless) && e[1] !== 2) changes[1] = 2;
  // Synth start on a page also takes the [A] hold, which only it can use.
  if (holdRules(profile) && f.id === 9 && kind !== 'action' && !e[5]) changes[5] = 3;
  return set(next, profile, f, changes);
}
// Change on the module: the first free control if it has none, and Synth
// start's gesture.
export function adjust(entries, profile, f) {
  const e = entryOf(entries, f);
  const changes = { 1: 2 };
  if (!places(e).length) {
    const kind = Object.keys(KINDS).find((k) => freeSlot(entries, k, profile, f));
    if (kind) changes[KINDS[kind].index] = freeSlot(entries, kind, profile, f);
  }
  if (holdRules(profile) && f.id === 9 && !e[5] && !changes[5]) changes[5] = 3;
  return set(entries, profile, f, changes);
}
export const canSwap = (entries, profile, id, kind, slot) => {
  const own = entryOf(entries, feature(profile, id));
  const taken = occupant(entries, kind, slot);
  return Boolean(own[KINDS[kind].index]) && own[KINDS[kind].index] !== slot && Boolean(taken) &&
    fitsSlot(profile, feature(profile, taken[0]), kind, own[KINDS[kind].index]);
};
// First free destination of a kind, or 0; with f, the first f can take.
export function freeSlot(entries, kind, profile, f = null) {
  for (let slot = 1; slot <= slotCount(kind, profile); ++slot) {
    if (!occupant(entries, kind, slot) && (!f || fitsSlot(profile, f, kind, slot))) return slot;
  }
  return 0;
}

// Options pages: LED names, the pages [M] cycles through and explicit compaction.
export function pageLedName(profile, page) {
  const mask = pageLeds(profile)[page - 1];
  if (mask === 7) return 'all three LEDs';
  const lit = KNOBS.filter((_, i) => mask & (1 << i));
  return lit.length > 1 ? `${lit.join(' and ')} LEDs` : `${lit[0]} LED`;
}
export const usedPages = (entries, profile) => pageLeds(profile).map((_, i) => i + 1)
  .filter((page) => entries.some((e) => e[3] && pageOf(e[3]) === page));
// Whole pages move down in order, keeping their knobs: [[from, to], ...].
export const compaction = (entries, profile) => usedPages(entries, profile)
  .map((page, i) => [page, i + 1]).filter(([from, to]) => from !== to);
export function compact(entries, profile) {
  const moves = new Map(compaction(entries, profile));
  return normalise(entries.map((e) => {
    const to = e[3] && moves.get(pageOf(e[3]));
    return to ? [...e.slice(0, 3), e[3] - (pageOf(e[3]) - to) * 3, ...e.slice(4)] : e.slice();
  }), profile);
}
// Features that differ from a starting point; omitted entries are Off.
export function changes(entries, start, profile) {
  return profile.features.filter((f) => entryOf(entries, f).join() !== entryOf(start, f).join());
}
