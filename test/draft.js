// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaults, encodeProfile, share, templates, unshare } from '../static/js/profile.js';
import { factoryScales, validateScales } from '../static/js/scales.js';
import { DRAFT, BEFORE_LINK, REFUSED, draftText, describe, readDraft, setAside, put, forgetDraft, keeper, isFresh } from '../static/js/draft.js';

const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
const release = manifest.releases.at(-1);
assert.equal(release.profile.version, 2, 'the newest release carries a scale bank');
const profile = release.profile;
const releases = [release];
const store = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k) };
};
const now = Date.UTC(2026, 10, 3);
const saveText = (entries, scales = null, preset = 'Drizzlet', r = release) =>
  draftText(r, encodeProfile(entries, r.profile, scales), preset, now);

// Every template, and edited and explicit banks, round trip byte for byte.
const custom = [{ id: 6, name: 'Pentatonic, edited', repeat: 12, notes: [0, 3, 5, 7.25, 10], color: [255, 0, 0], pulses: 1 },
  { id: 15, name: 'Bohlen–Pierce', repeat: 12 * Math.log2(3), notes: [0, 1, 3.5, 9], color: [0, 1, 255], pulses: 2 }];
const cases = [...Object.entries(templates(profile)).map(([name, entries]) => [name, entries, null]),
  ['factory explicit', defaults(profile), factoryScales()], ['reversed', defaults(profile), factoryScales().reverse()],
  ['custom', defaults(profile), custom], ['empty bank', defaults(profile), []]];
for (const [name, entries, bank] of cases) {
  const block = encodeProfile(entries, profile, bank);
  const s = store({ [DRAFT]: draftText(release, block, name, now) });
  const draft = readDraft(s, releases);
  assert(!draft.refused, name);
  assert.equal(draft.release, release);
  assert.deepEqual(encodeProfile(draft.entries, profile, draft.scales), block, `${name}: bytes`);
  assert.deepEqual(draft.scales, bank === null ? null : validateScales(bank), `${name}: bank`);
  assert.equal(draft.preset, Object.hasOwn(templates(profile), name) ? name : 'Drizzlet');
  assert.equal(draft.saved, now);
  assert.equal(draft.moved, false);
}
// The stored fragment is exactly a share link.
const pitched = templates(profile)['Pitched grains'];
const text = JSON.parse(saveText(pitched, custom, 'Pitched grains'));
assert.equal(text.share, share(release, encodeProfile(pitched, profile, custom)));
assert.deepEqual(Object.keys(text).sort(), ['format', 'name', 'preset', 'saved', 'share', 'v', 'version']);
assert(JSON.stringify(text).length < 9 * 1024);
// Only template names are kept as presets.
for (const preset of ['toString', '__proto__', 'Unknown', '']) {
  assert.equal(JSON.parse(saveText(pitched, null, preset)).preset, undefined);
  const raw = JSON.stringify({ ...JSON.parse(saveText(pitched)), preset });
  assert.equal(readDraft(store({ [DRAFT]: raw }), releases).preset, 'Drizzlet');
}

// Fresh state removes the draft; any other starting point is kept with its name.
const older = { ...structuredClone(release), tag: 'drizzlet-2026.11.01', name: 'Older' };
assert(isFresh(release, encodeProfile(defaults(profile), profile), release));
assert(!isFresh(older, encodeProfile(defaults(profile), profile), release));
assert(!isFresh(release, encodeProfile(defaults(profile), profile, factoryScales()), release));
{
  const s = store();
  const k = keeper(s);
  assert.equal(k.save(release, encodeProfile(pitched, profile), 'Pitched grains', now, release), null, 'no edit, no save');
  k.edited();
  assert.equal(k.save(release, encodeProfile(pitched, profile), 'Pitched grains', now, release), 'saved');
  assert.equal(readDraft(s, releases).preset, 'Pitched grains');
  k.edited();
  const stock = templates(profile)['Stock plus fixes'];
  assert.equal(k.save(release, encodeProfile(stock, profile), 'Stock plus fixes', now, release), 'saved');
  assert.equal(readDraft(s, releases).preset, 'Stock plus fixes');
  k.edited();
  assert.equal(k.save(release, encodeProfile(defaults(profile), profile), 'Drizzlet', now, release), 'removed');
  assert.equal(s.getItem(DRAFT), null);
}

// A link load after an edit does not save the link; the next edit keeps the own draft aside first.
{
  const own = saveText(pitched, custom, 'Pitched grains');
  const s = store({ [DRAFT]: own });
  const k = keeper(s);
  k.edited();
  k.linked();
  const link = encodeProfile(templates(profile).Spectral, profile);
  assert.equal(k.save(release, link, 'Drizzlet', now, release), null, 'the pending edit does not save the link');
  assert.equal(s.getItem(DRAFT), own);
  assert(k.linking);
  k.edited();
  assert.equal(k.save(release, link, 'Drizzlet', now + 1, release), 'saved');
  assert.equal(s.getItem(BEFORE_LINK), own);
  assert.equal(JSON.parse(s.getItem(DRAFT)).share, share(release, link));
  assert(!k.linking);
  // Later edits replace only the draft.
  k.edited();
  assert.equal(k.save(release, encodeProfile(pitched, profile), 'Drizzlet', now + 2, release), 'saved');
  assert.equal(s.getItem(BEFORE_LINK), own);
  // An edit back to the fresh state still keeps the own draft aside first.
  const t = store({ [DRAFT]: own });
  const kt = keeper(t);
  kt.linked();
  kt.edited();
  assert.equal(kt.save(release, encodeProfile(defaults(profile), profile), 'Drizzlet', now, release), 'removed');
  assert.equal(t.getItem(BEFORE_LINK), own);
  // If the own draft cannot be kept aside, the draft is not replaced.
  const u = store({ [DRAFT]: own });
  u.setItem = (key, value) => { if (key === BEFORE_LINK) throw new Error('full'); u.data.set(key, value); };
  const ku = keeper(u);
  ku.linked();
  ku.edited();
  assert.equal(ku.save(release, link, 'Drizzlet', now, release), 'failed');
  assert.equal(u.getItem(DRAFT), own);
}

// Forget during a pending refresh stays forgotten.
{
  const s = store({ [DRAFT]: saveText(pitched), [BEFORE_LINK]: saveText(pitched), [REFUSED]: '{' });
  const k = keeper(s);
  k.edited();
  assert(forgetDraft(s));
  k.settled();
  assert.equal(k.save(release, encodeProfile(pitched, profile), 'Drizzlet', now, release), null);
  assert.equal(s.data.size, 0);
}

// Carry-over: the tag is gone, a release with the same version and format exists.
{
  const newer = { ...structuredClone(release), tag: 'drizzlet-2099.01.01', name: 'Newer' };
  const s = store({ [DRAFT]: saveText(pitched, custom, 'Pitched grains', older) });
  const draft = readDraft(s, [release, newer]);
  assert.equal(draft.release, newer, 'the newest compatible release');
  assert.equal(draft.moved, true);
  assert.equal(draft.from, 'Older');
  assert.deepEqual(encodeProfile(draft.entries, newer.profile, draft.scales), encodeProfile(pitched, profile, custom));
  assert.equal(readDraft(s, [release]).release, release);
}

// Refusals keep the raw text.
const good = saveText(pitched);
const tweak = (change) => { const d = JSON.parse(good); change(d); return JSON.stringify(d); };
const flip = (hex, at) => hex.slice(0, at) + (hex[at] === '0' ? '1' : '0') + hex.slice(at + 1);
const refusals = {
  json: '{not json',
  schema: tweak((d) => { d.v = 2; }),
  missing: tweak((d) => { delete d.saved; }),
  gone: tweak((d) => { d.share = d.share.replace(release.tag, 'drizzlet-1999.01.01'); d.format = 99; }),
  format: tweak((d) => { d.format += 1; }),
  version: tweak((d) => { d.version = 1; }),
  fragment: tweak((d) => { d.share = 'release=' + release.tag + '&profile=zz'; }),
  checksum: tweak((d) => {
    const p = new URLSearchParams(d.share);
    p.set('profile', flip(p.get('profile'), 40));
    d.share = p.toString();
  }),
  // Bytes after the payload are outside the CRC; a draft must still match exactly.
  trailing: tweak((d) => {
    const p = new URLSearchParams(d.share);
    p.set('profile', p.get('profile').slice(0, -2) + '00');
    d.share = p.toString();
  })
};
for (const [kind, raw] of Object.entries(refusals)) {
  const draft = readDraft(store({ [DRAFT]: raw }), releases);
  assert.equal(draft.refused, true, kind);
  assert.equal(draft.raw, raw, kind);
}
assert.equal(describe(refusals.format).name, release.name);
assert.equal(describe(refusals.format).saved, now);
assert.equal(describe(refusals.format).fragment, JSON.parse(refusals.format).share);
assert.deepEqual(describe('{'), { name: null, saved: null, fragment: null });
assert.equal(describe(tweak((d) => { delete d.name; })).name, release.tag);

// Setting aside: empty slot moves the text; an occupied slot or failing write leaves both.
{
  const s = store({ [DRAFT]: refusals.json });
  assert(setAside(s, DRAFT, refusals.json));
  assert.equal(s.getItem(REFUSED), refusals.json);
  assert.equal(s.getItem(DRAFT), null);
  const t = store({ [DRAFT]: refusals.format, [REFUSED]: refusals.json });
  assert(!setAside(t, DRAFT, refusals.format));
  assert.equal(t.getItem(DRAFT), refusals.format);
  assert.equal(t.getItem(REFUSED), refusals.json);
  const u = store({ [DRAFT]: refusals.format });
  u.setItem = () => { throw new Error('full'); };
  assert(!setAside(u, DRAFT, refusals.format));
  assert.equal(u.getItem(DRAFT), refusals.format);
  // A paused keeper never writes.
  const k = keeper(t);
  k.pause();
  k.edited();
  assert.equal(k.save(release, encodeProfile(pitched, profile), 'Drizzlet', now, release), null);
  assert.equal(t.getItem(DRAFT), refusals.format);
  k.pause(false);
  k.edited();
  assert.equal(k.save(release, encodeProfile(pitched, profile), 'Drizzlet', now, release), 'saved');
}

// Throwing storage: nothing throws and nothing is saved.
{
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); } };
  assert.equal(readDraft(broken, releases), null);
  assert.equal(put(broken, DRAFT, 'x'), false);
  assert.equal(setAside(broken, DRAFT, 'x'), false);
  assert.equal(forgetDraft(broken), false);
  const k = keeper(broken);
  k.edited();
  assert.equal(k.save(release, encodeProfile(pitched, profile), 'Drizzlet', now, release), 'failed');
  k.linked();
  k.edited();
  assert.equal(k.save(release, encodeProfile(pitched, profile), 'Drizzlet', now, release), 'failed');
  assert.equal(keeper(null).save(release, encodeProfile(pitched, profile), 'Drizzlet', now, release), null);
}
// The share link and the draft agree, so a restored setup is the shared one.
assert.deepEqual(unshare(JSON.parse(good).share, releases).entries, pitched);
console.log('draft: ok');
