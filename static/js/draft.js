// Copyright 2026 Insolent Construct.
// MIT licence: see encoder.js.
// The setup kept in this browser so a reload reopens it. No DOM; storage is passed in.
// A draft is the share fragment plus a little context; see docs/DESIGN.md.

import { defaults, encodeProfile, equal, normalise, share, templates, unshare } from './profile.js?v=d3cdc8ee403b3861';

export const DRAFT = 'hygrostat-draft';
export const BEFORE_LINK = 'hygrostat-draft-before-link';
export const REFUSED = 'hygrostat-draft-refused';
const SCHEMA = 1;

// The page's own fresh state: Drizzlet defaults with factory scales on the newest release.
export const isFresh = (release, block, newest) => release === newest &&
  equal(block, encodeProfile(defaults(release.profile), release.profile));

// link marks a setup that started from a shared link rather than the person's own.
export function draftText(release, block, preset, now, link = false) {
  return JSON.stringify({ v: SCHEMA, saved: now, share: share(release, block), name: release.name,
    version: release.profile.version, format: release.profile.format,
    ...Object.hasOwn(templates(release.profile), preset) ? { preset } : {}, ...link ? { link } : {} });
}

const fromLink = (raw) => {
  try { return JSON.parse(raw)?.link === true; } catch { return false; }
};

// What a refused draft can still tell the person, from text this page could not open.
export function describe(raw) {
  try {
    const draft = JSON.parse(raw);
    const tag = typeof draft?.share === 'string' ? new URLSearchParams(draft.share).get('release') : null;
    return { name: typeof draft?.name === 'string' ? draft.name : tag,
      saved: Number.isFinite(draft?.saved) ? draft.saved : null,
      fragment: typeof draft?.share === 'string' ? draft.share : null };
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
    const draft = JSON.parse(raw);
    if (draft?.v !== SCHEMA || typeof draft.share !== 'string' || !Number.isFinite(draft.saved) ||
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
    if (!equal(encodeProfile(shared.entries, release.profile, scales), Uint8Array.from(
      params.get('profile').match(/../g), (v) => parseInt(v, 16)))) throw new Error('Draft bytes differ.');
    return { release, entries: normalise(shared.entries, release.profile), scales,
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

export function forgetDraft(storage) {
  return [DRAFT, BEFORE_LINK, REFUSED].map((key) => put(storage, key, null)).every(Boolean);
}

// When to save: after an edit only, never a shared setup that was merely opened.
// The first save after a link copies the draft to BEFORE_LINK, unless that slot already
// holds work and the draft itself came from a link.
export function keeper(storage) {
  let dirty = false, stash = false, paused = false, link = false;
  return {
    get paused() { return paused; },
    edited() { dirty = true; },
    linked() { dirty = false; stash = true; link = true; },
    settled(fromLink = false) { dirty = false; stash = false; link = fromLink; },
    clean() { dirty = false; },
    pause(on = true) { paused = on; },
    // Returns null (nothing to do), 'saved', 'removed' or 'failed'.
    save(release, block, preset, now, newest) {
      if (!dirty || paused || !storage) return null;
      dirty = false;
      if (stash) {
        let own, aside;
        try { own = storage.getItem(DRAFT); aside = storage.getItem(BEFORE_LINK); } catch { return 'failed'; }
        if (own !== null && (!fromLink(own) || aside === null) && !put(storage, BEFORE_LINK, own)) return 'failed';
        stash = false;
      }
      const fresh = isFresh(release, block, newest);
      return put(storage, DRAFT, fresh ? null : draftText(release, block, preset, now, link)) ? (fresh ? 'removed' : 'saved') : 'failed';
    }
  };
}
