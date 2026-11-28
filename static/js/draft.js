// Copyright 2026 Insolent Construct.
// MIT licence: see encoder.js.
// The setup kept in this browser so a reload reopens it. No DOM; storage is passed in.
// A draft is the share fragment plus a little context; see docs/DESIGN.md.

import { defaults, encodeProfile, equal, normalise, share, templates, unshare, MAX_SHARE } from './profile.js?v=500cf3ddb012dbb1';

export const DRAFT = 'hygrostat-draft';
export const BEFORE_LINK = 'hygrostat-draft-before-link';
export const REFUSED = 'hygrostat-draft-refused';
const SCHEMA = 1;
// The longest share text with room for a draft's other fields: longer stored text is not parsed.
const MAX_DRAFT = MAX_SHARE + 1024;

// The page's own fresh state: Drizzlet defaults with default scales on the newest release.
export const isFresh = (release, block, newest) => release === newest &&
  equal(block, encodeProfile(defaults(release.profile), release.profile));

// link marks a setup that started from a shared link rather than the person's own.
export function draftText(release, block, preset, now, link = false, setup = null) {
  return JSON.stringify({ v: SCHEMA, saved: now, share: share(release, block, setup), name: release.name,
    version: release.profile.version, format: release.profile.format,
    ...Object.hasOwn(templates(release.profile), preset) ? { preset } : {}, ...link ? { link } : {} });
}

const fromLink = (raw) => {
  try { return JSON.parse(raw)?.link === true; } catch { return false; }
};

// What a refused draft can still tell the person, from text this page could not open.
export function describe(raw) {
  try {
    if (raw.length > MAX_DRAFT) throw new Error('Draft is too large.');
    const draft = JSON.parse(raw);
    const fragment = typeof draft?.share === 'string' && draft.share.length <= MAX_SHARE ? draft.share : null;
    return { name: typeof draft?.name === 'string' ? draft.name : fragment && new URLSearchParams(fragment).get('release'),
      saved: Number.isFinite(draft?.saved) ? draft.saved : null, fragment };
  } catch {
    return { name: null, saved: null, fragment: null };
  }
}

// Opens the draft under key: null when there is none, otherwise the setup or { refused, raw, error }.
export function readDraft(storage, releases, key = DRAFT) {
  let raw;
  try { raw = storage.getItem(key); } catch { return null; }
  if (raw === null) return null;
  try {
    if (raw.length > MAX_DRAFT) throw new Error('Draft is too large.');
    const draft = JSON.parse(raw);
    if (draft?.v !== SCHEMA || typeof draft.share !== 'string' || draft.share.length > MAX_SHARE || !Number.isFinite(draft.saved) ||
        !Number.isInteger(draft.version) || !Number.isInteger(draft.format)) {
      throw new Error('Unknown draft schema.');
    }
    const params = new URLSearchParams(draft.share);
    const compatible = (r) => r.profile.version === draft.version && r.profile.format === draft.format;
    let release = releases.find((r) => r.tag === params.get('release'));
    const moved = !release;
    if (!release) release = releases.findLast(compatible);
    if (!release || !compatible(release)) throw new Error('No compatible release.');
    params.set('release', release.tag);
    const shared = unshare(params.toString(), releases);
    const scales = shared.scales ?? null;
    const plaits = shared.plaits ?? null;
    if (!equal(encodeProfile(shared.entries, release.profile, scales, plaits), Uint8Array.from(
      params.get('profile').match(/../g), (v) => parseInt(v, 16)))) throw new Error('Draft bytes differ.');
    return { release, entries: normalise(shared.entries, release.profile, plaits?.banks.length), scales,
      ...plaits ? { plaits } : {}, ...shared.setup ? { setup: shared.setup } : {},
      preset: Object.hasOwn(templates(release.profile), draft.preset) ? draft.preset : 'Drizzlet',
      saved: draft.saved, moved, from: draft.name, link: draft.link === true, raw };
  } catch (error) {
    return { refused: true, raw, error };
  }
}

// Keeps refused text aside; only then removes it from key. False leaves both slots as they were.
export function setAside(storage, key, raw) {
  try {
    if (storage.getItem(REFUSED) !== null) return false;
    storage.setItem(REFUSED, raw);
    if (storage.getItem(REFUSED) !== raw) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// Writes text to key and reads it back; null removes the key.
export function put(storage, key, text) {
  try {
    if (text === null) storage.removeItem(key);
    else storage.setItem(key, text);
    return storage.getItem(key) === text;
  } catch {
    return false;
  }
}

// Copies the draft over the second slot before a new setup replaces it. False when it could not be kept.
export function keepAside(storage) {
  try {
    const own = storage.getItem(DRAFT);
    return own === null || put(storage, BEFORE_LINK, own);
  } catch {
    return false;
  }
}

export function forgetDraft(storage) {
  return [DRAFT, BEFORE_LINK, REFUSED].map((key) => put(storage, key, null)).every(Boolean);
}

// When to save: after an edit only, never a shared setup that was merely opened.
// The first save after a link copies the draft to BEFORE_LINK, unless that slot already
// holds work and the draft itself came from a link.
export function keeper(storage) {
  // shown is the draft text stored for the setup on screen: null for none, undefined when it is not that setup's.
  let dirty = false, stash = false, paused = false, link = false, shown = null;
  return {
    get paused() { return paused; },
    // Whether the stored draft is the setup on screen: not after a link, an unsaved edit or another tab's save.
    get kept() {
      if (dirty || paused || typeof shown !== 'string') return false;
      try { return storage.getItem(DRAFT) === shown; } catch { return false; }
    },
    edited() { dirty = true; },
    linked() { dirty = false; stash = true; link = true; shown = undefined; },
    settled(fromLink = false, raw = null) { dirty = false; stash = false; link = fromLink; shown = raw; },
    clean() { dirty = false; },
    pause(on = true) { paused = on; },
    // Returns null (nothing to do), 'saved', 'removed' or 'failed'.
    save(release, block, preset, now, newest, setup = null) {
      if (!dirty || paused || !storage) return null;
      dirty = false;
      if (stash) {
        let own, aside;
        try { own = storage.getItem(DRAFT); aside = storage.getItem(BEFORE_LINK); } catch { return 'failed'; }
        if (own !== null && (!fromLink(own) || aside === null) && !put(storage, BEFORE_LINK, own)) return 'failed';
        stash = false;
      }
      const fresh = !setup && isFresh(release, block, newest);
      const text = fresh ? null : draftText(release, block, preset, now, link, setup);
      shown = put(storage, DRAFT, text) ? text : undefined;
      return shown === undefined ? 'failed' : fresh ? 'removed' : 'saved';
    }
  };
}
