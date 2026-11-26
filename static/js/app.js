// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// MIT licence: see encoder.js.
//
// The page: pick a release and lay out its features on the module's controls,
// check the release's app image against the manifest, encode the update .wav
// in the browser, check the .wav, offer it for download.

import { defaults, decodeSettings, encodeProfile, equal, sha256, fingerprint, filenames, share, unshare, templates, validate, modes, GAIN,
  pageLeds, gestureFirmware, exactPageRule, offeredValues } from './profile.js?v=51ce921e4a13abc4';
import { effectiveScales, validateScales } from './scales.js?v=51ce921e4a13abc4';
import { scaleEditor } from './scale_editor.js?v=51ce921e4a13abc4';
import { mountCounts, recordDownload, recordBuild, recordVisit, afterInteraction } from './downloads.js?v=51ce921e4a13abc4';
import { featureHelp, actionHelp } from './help.js?v=51ce921e4a13abc4';
import { KNOBS, KINDS, libraryGroups, EXTRA_GROUPS, extraGroup, extraControl, ACTION_DOES, placeName, pageOf, entryOf, occupant, places, valueLabel, stateLabel,
  summary, stateHint, edit, place, adjust, unplace, afterUnplace, canSwap, freeSlot, changes, fitsSlot, placeable, bankWarning, slotCount,
  usedPages, compaction, compact } from './layout.js?v=51ce921e4a13abc4';
import { drawPanel, highlight } from './panel.js?v=51ce921e4a13abc4';
import { comboImages } from './combo.js?v=51ce921e4a13abc4';
import { DRAFT, BEFORE_LINK, REFUSED, readDraft, setAside, put, forgetDraft, keepAside, keeper, describe } from './draft.js?v=51ce921e4a13abc4';

import { regionSupport, SECTION_NAMES, SECTION_KINDS, MAX_SHARE } from './profile.js?v=51ce921e4a13abc4';
import { regionImage } from './region.js?v=51ce921e4a13abc4';
import { readContent, encodeContent, decodeContent, CONTENT } from './content.js?v=51ce921e4a13abc4';
import { grids } from './terrain.js?v=51ce921e4a13abc4';
import { factoryTable } from './wavetables.js?v=51ce921e4a13abc4';
import { modelInfo } from './model_info.js?v=51ce921e4a13abc4';
import { starterBanksHash } from './starter_banks.js?v=51ce921e4a13abc4';
import { stockBanks, offeredModels, addStarterBank, defaultSelection, validateSelection, removeModel, lockSynth, synthLock, flashMeter, refit, selectedRegion, fetchAsset } from './palette.js?v=51ce921e4a13abc4';

const $ = (id) => document.getElementById(id);
const cap = (text) => text.replace(/^./, (c) => c.toUpperCase());
function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on')) element[key] = value;
    else if (value !== false && value !== null && value !== undefined) element.setAttribute(key, value === true ? '' : value);
  }
  element.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return element;
}

function status(text, kind = '') {
  $('status').textContent = text;
  $('status').className = kind;
}

function encodeInWorker(app) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('js/worker.js?v=51ce921e4a13abc4', { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.ready) return;
      if (data.progress !== undefined) {
        $('progress').value = data.progress;
      } else {
        worker.terminate();
        data.error ? reject(new Error(data.error)) : resolve(data.wav);
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || 'encoder failed'));
    };
    worker.postMessage(app.buffer, [app.buffer]);
  });
}

let manifest;
let download;
let entries;
let scales = null;
let palette = null;
let starterBanks = [];
let portableContent = null;
let prepared = null;
let profileFile = null;
const assets = new Map();
const cachedFetch = (url) => {
  if (!assets.has(url)) assets.set(url, fetch(url).then(async (response) => {
    if (!response.ok) { assets.delete(url); throw new Error('Could not download content.'); }
    return new Uint8Array(await response.arrayBuffer());
  }).catch((error) => { assets.delete(url); throw error; }));
  return assets.get(url).then((bytes) => ({ ok: true, arrayBuffer: async () => bytes.slice().buffer }));
};
const setupData = () => palette || portableContent ? { selection: palette, content: portableContent } : null;
const payloads = () => {
  if (!portableContent) return { wave: factoryTable(), terrain: null };
  const content = decodeContent(portableContent);
  return { wave: content.wave ?? factoryTable(), terrain: content.terrains.length ? grids(content.terrains.map((t) => t.grid)) : null };
};

let revision = 0;
// The guide drawings are the largest module and only feed the guide downloads: fetched once the page is usable.
const guideModule = () => import('./guide.js?v=51ce921e4a13abc4')
  .catch((cause) => { throw new Error('Could not load the guide drawings. Reload the page.', { cause }); });
const guideURLs = [];
const comboURLs = [];
// The preset the change count is measured from, the selected destination
// ({ kind, slot }) or feature ({ id }), and the page shown on phones.
let preset = 'Drizzlet';
let selection = { kind: 'page', slot: 1 };
let pageTab = 1;
let pending = null; // An inspector placement waiting for Swap or Replace.
let presetPending = null; // A starting-point chip waiting for Replace.
let releaseShown = null; // The tag of the release on screen.
let releasePending = null; // A Firmware choice waiting for Switch.
let releaseSlots = null; // The saved setups its prompt described.
let templatePreview = null;
let compactPreview = false;
const startingPoints = [
  ['Process audio', [
    ['Cloud textures', 'Slow, evolving frozen textures.'],
    ['Pitched grains', 'Tonal grains with a minor-pentatonic scale.'],
    ['Drum grains', 'Keep attacks and follow a clock.'],
    ['Delay & freeze', 'Smooth-filter delay and fresh captures.'],
    ['Spectral', 'Spectral processing, with a way back to granular.']
  ]],
  ['Play a voice', [['Plaits voice', 'A synth voice started by hand.']]],
  ['Perform', [['Live essentials', 'Keep useful choices close on stage.']]]
];
const templateId = (name) => name.toLowerCase().replace(/\W+/g, '-');

// Blocked storage (private modes, site settings) leaves the page working without persistence.
const storage = (() => {
  try { return localStorage; } catch { return null; }
})();
const drafts = keeper(storage);
const notice = { restored: null, linked: false, undo: null, failed: false, dismissed: false };
const held = new Set(); // Keys of refused drafts that could not be set aside; saving pauses meanwhile.

async function build(release, app) {
  await guideModule(); // Before encoding: a build without its guides stops here.
  if (download) URL.revokeObjectURL(download);
  clearCombo();
  $('result').hidden = true;
  $('progress').value = 0;
  $('progress').hidden = false;
  if (app.length !== release.app_size) {
    throw new Error(`the app image must be ${release.app_size} bytes for ${release.tag}`);
  }
  const baseHash = await sha256(app);
  if (baseHash !== release.app_sha256) {
    throw new Error(`the app image does not match ${release.tag}: ${baseHash}`);
  }
  const chosen = entries.map((e) => e.slice());
  const chosenScales = validateScales(scales);
  validate(chosen, release.profile, palette?.banks.length);
  const built = await prepare(release);
  if (!built.meter.fits) throw new Error(`Remove ${-built.meter.free} bytes before building.`);
  const block = built.block;
  const original = app.slice(release.profile.offset, release.profile.offset + release.profile.size);
  if (!equal(original, encodeProfile(defaults(release.profile), release.profile))) {
    throw new Error('Release settings do not match the release list.');
  }
  const isDefault = equal(block, original) && !palette && !portableContent;
  const base = app.slice();
  app.set(block, release.profile.offset);
  const offset = release.profile.offset;
  if (!equal(app.subarray(0, offset), base.subarray(0, offset)) ||
      !equal(app.subarray(offset + release.profile.size), base.subarray(offset + release.profile.size)) ||
      JSON.stringify(decodeSettings(app.subarray(offset, offset + release.profile.size), release.profile)) !== JSON.stringify({ entries: chosen, scales: chosenScales, ...built.plaits ? { plaits: built.plaits } : {} })) {
    throw new Error('Updated firmware check failed.');
  }
  const appHash = await sha256(app);
  const fp = await fingerprint(block);
  const names = filenames(release, fp, isDefault);
  status('Building and checking…');
  const image = built.written ? regionImage(app, built.written.region) : app.slice();
  const wav = await encodeInWorker(image);
  const wavHash = await sha256(wav);
  $('app-hash').textContent = appHash;
  $('wav-hash').textContent = wavHash;
  $('expected-hash').textContent = release.wav_sha256;
  if (isDefault && wavHash !== release.wav_sha256) {
    throw new Error('the encoded .wav does not match the release: do not install it');
  }
  download = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  $('download').href = download;
  $('download').download = names.wav;
  $('download').textContent = `Download WAV (${(wav.length / 1e6).toFixed(1)} MB)`;
  $('download').title = names.wav;
  $('test-status').replaceChildren(...testStatus(release));
  $('result').hidden = false;
  status(isDefault ? 'Ready. Matches the release; audio checked.' : `Ready. Profile ${fp}; audio checked.`, 'ok');
  await updateGuides(release, chosen, fp, names, chosenScales);
  if (!built.written) await updateCombo(release, app, isDefault, fp, names);
  else $('combo-status').textContent = 'Use the WAV for this region image.';
  $('download').onclick = () => recordDownload(release);
  recordBuild(release);
  $('result-title').focus({ preventScroll: true });
  $('result').scrollIntoView({ block: 'nearest' });
}

function testStatus(release) {
  if (release.development) {
    return ['Development build, not a release.'];
  }
  return [`${release.name}, released ${release.date}. Testing: see the `,
    el('a', { href: `https://github.com/insolentconstruct/eurorack/releases/tag/${encodeURIComponent(release.tag)}`, text: 'release notes' }), '.'];
}

function selected() {
  return manifest.releases[$('release').selectedIndex];
}
const profile = () => {
  const original = selected().profile;
  if (original.version !== 2) return original;
  const bank = effectiveScales(scales);
  return { ...original, features: original.features.map((f) => f.id !== 1 ? f :
    { ...f, values: Array.from({ length: 16 }, (_, id) => id < 2 ? f.values[id] :
      bank.find((s) => s.id === id)?.name || 'Unavailable scale') }).map((f) => f.id === 31 && palette?.banks.length ?
      { ...f, values: palette.banks.map((_, i) => `Bank ${i + 1}`) } : f) };
};
const renderScales = scaleEditor($('scale-editor'), {
  get: () => scales,
  releaseKey: () => selected().tag,
  getLeds: () => selected().profile.leds,
  error: (message) => status(message, 'error'),
  set: (bank, message) => {
    if (busy || selected().profile.version !== 2) throw new Error('Scale editing is unavailable right now.');
    const available = effectiveScales(bank);
    const next = entries.map((e) => e[0] === 1 && e[2] >= 2 && !available.some((s) => s.id === e[2]) ?
      [e[0], e[1], 0, ...e.slice(3)] : e.slice());
    encodeProfile(next, selected().profile, bank);
    scales = bank;
    commit(() => next, message);
  }
});
const featureById = (id) => profile().features.find((f) => f.id === id);

let busy = false;

async function run() {
  if (busy) return;
  busy = true;
  $('palette-editor').inert = $('scale-editor').inert = $('workspace').inert = $('presets').inert = $('preset-confirm').inert = $('release-confirm').inert = $('template-gallery').inert = $('draft-notice').inert = true;
  $('build').disabled = $('release').disabled = true;
  $('result').hidden = true;
  try {
    const release = selected();
    await build(release, await fetchApp(release));
  } catch (error) {
    status(`Stopped: ${error.message}`, 'error');
  } finally {
    $('progress').hidden = true;
    $('build').disabled = $('release').disabled = false;
    busy = false;
    if (pendingShare) { pendingShare = false; loadSharedProfile(); }
    $('palette-editor').inert = $('scale-editor').inert = $('workspace').inert = $('presets').inert = $('preset-confirm').inert = $('release-confirm').inert = $('template-gallery').inert = $('draft-notice').inert = false;
  }
}

async function fetchApp(release) {
  status('Downloading firmware…');
  const response = await fetch(release.app, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`could not download the app image (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function clearCombo() {
  comboURLs.splice(0).forEach((url) => URL.revokeObjectURL(url));
  $('combo-files').hidden = true;
  $('combo-status').textContent = $('combo-hex-hash').textContent = $('combo-bin-hash').textContent = 'After building';
  $('combo-status').className = '';
}

// ST-Link files are optional: a refusal is shown with them and keeps the WAV.
async function updateCombo(release, app, isDefault, fp, names) {
  if (!release.combo) {
    $('combo-status').textContent = 'Not available for this release.';
    return;
  }
  $('recovery').href = `https://github.com/insolentconstruct/eurorack/blob/${encodeURIComponent(release.tag)}/beads/build/docs/RECOVERY.md`;
  try {
    const response = await fetch(release.combo.bootloader, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`could not download the bootloader (${response.status})`);
    const { bin, hex } = await comboImages(release, new Uint8Array(await response.arrayBuffer()), app);
    const binHash = await sha256(bin);
    const hexHash = await sha256(hex);
    if (isDefault && (binHash !== release.combo.bin_sha256 || hexHash !== release.combo.hex_sha256)) {
      throw new Error('the combo files do not match the release: do not install them');
    }
    $('combo-bin-hash').textContent = binHash;
    $('combo-hex-hash').textContent = hexHash;
    for (const [id, bytes, name, type] of [['combo-hex', hex, names.comboHex, 'text/plain'],
      ['combo-bin', bin, names.comboBin, 'application/octet-stream']]) {
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      comboURLs.push(url);
      const a = $(id);
      a.href = url; a.download = name; a.title = name;
    }
    $('combo-status').textContent = isDefault ? 'Ready. Matches the release combo files.' : `Ready. Profile ${fp}; HEX checked against the BIN.`;
    $('combo-files').hidden = false;
  } catch (error) {
    $('combo-status').textContent = `Combo files refused: ${error.message}`;
    $('combo-status').className = 'warn';
  }
}

// current says whether the caller's setup is still the one on screen once the drawings have loaded.
async function updateGuides(release, chosen, fp, names, chosenScales = scales, current = () => true) {
  const { guide } = await guideModule();
  if (!current()) return;
  guideURLs.splice(0).forEach((url) => URL.revokeObjectURL(url));
  for (const mobile of [false, true]) {
    const url = URL.createObjectURL(new Blob([guide(chosen, release, fp, mobile, chosenScales, palette)], { type: 'image/svg+xml' }));
    guideURLs.push(url);
    const a = $(mobile ? 'guide-mobile' : 'guide');
    a.href = url; a.download = names[mobile ? 'mobile' : 'desktop'];
  }
}

// Apply an edit; errors leave the profile as it was.
function commit(change, message = '') {
  templatePreview = presetPending = null;
  compactPreview = false;
  try {
    entries = exactPageRule(change(), profile());
    edited();
    status(message);
  } catch (error) {
    status(error.message, 'error');
  }
  pending = null;
  render();
}

function matchingTemplate() {
  const key = encodeProfile(entries, profile(), scales).join();
  return Object.entries(templates(profile())).find(([, value]) => encodeProfile(value, profile()).join() === key)?.[0];
}

function setupEditor() {
  // A new release or shared profile drops pending prompts and previews, and
  // keeps the selection and phone tab within its pages.
  pending = null; templatePreview = presetPending = null; compactPreview = false;
  if (selection.kind === 'page' && selection.slot > slotCount('page', profile())) selection = { kind: 'page', slot: 1 };
  if (pageTab > pageNumbers().length) pageTab = 1;
  releaseShown = selected().tag;
  releasePending = null;
  renderReleaseConfirm();
  $('development').hidden = !selected().development;
  $('expected-hash').textContent = selected().wav_sha256;
  preset = matchingTemplate() || preset;
  render();
}

// A Firmware change starts from that release's defaults. A starting point changes at once;
// any other setup asks first, and its saved draft is kept in the second slot to reopen.
function chooseRelease() {
  const tag = $('release').value;
  $('release').value = releaseShown;
  if (matchingTemplate() && !palette && !portableContent && (ownDraft() === null || drafts.kept)) { useRelease(tag, false); return; }
  releasePending = tag;
  renderReleaseConfirm();
  $('release-switch').focus();
}

// The draft Switch copies aside: the setup on screen or, after a link or an unsaved edit, the last saved one.
const ownDraft = () => drafts.paused ? null : saved(DRAFT);
function releaseHint() {
  if (drafts.paused) return 'Saving is paused: nothing saved in this browser changes';
  const own = ownDraft();
  const replaced = own !== null && ![null, own].includes(saved(BEFORE_LINK)) ? ', replacing the other saved setup' : '';
  return own === null ? 'This setup is not saved in this browser: copy the Share link first to keep it' :
    drafts.kept ? `Your setup stays saved in this browser to reopen${replaced}` :
      `This setup is not saved; your last saved setup stays in this browser to reopen${replaced}`;
}

// Writes the prompt's second line and notes the stored slots it describes.
const savedSlots = () => JSON.stringify([saved(DRAFT), saved(BEFORE_LINK), drafts.kept]);
function showReleaseHint() {
  releaseSlots = savedSlots();
  $('release-keep').textContent = releaseHint();
}

function useRelease(tag, confirmed) {
  if (confirmed && savedSlots() !== releaseSlots) {
    showReleaseHint();
    status('The saved setups changed. Check the prompt, then choose again.', 'error');
    return;
  }
  const keep = confirmed && ownDraft() !== null;
  if (keep && !keepAside(storage)) {
    status('This browser could not keep your setup, so the firmware was not changed. Copy the Share link, then use Forget saved setup.', 'error');
    return;
  }
  $('release').value = tag;
  $('template-gallery').hidden = true;
  entries = defaults(selected().profile);
  scales = null;
  palette = null; portableContent = null;
  preset = 'Drizzlet';
  notice.restored = null;
  notice.linked = false;
  if (keep) notice.dismissed = false;
  drafts.settled();
  edited();
  status('');
  setupEditor();
  renderNotice();
  $('release').focus();
}

function renderReleaseConfirm() {
  const release = manifest.releases.find((r) => r.tag === releasePending);
  const back = () => { releasePending = null; renderReleaseConfirm(); $('release').focus(); };
  $('release-confirm').hidden = !release;
  $('release-confirm').replaceChildren(...release ? [
    el('p', { id: 'release-confirm-text', text: `Switch to ${release.name}? Your setup is replaced by its Drizzlet defaults.` }),
    el('div', { class: 'options' },
      el('button', { type: 'button', id: 'release-switch', onclick: () => useRelease(release.tag, true) },
        el('b', { text: 'Switch' }), el('span', { id: 'release-keep' })),
      el('button', { type: 'button', id: 'release-cancel', onclick: back }, el('b', { text: 'Cancel' })))] : []);
  if (release) showReleaseHint();
}

function useTemplate(name) {
  const candidate = templates(selected().profile)[name].map((e) => e.slice());
  scales = null;
  preset = name;
  $('template-gallery').hidden = true;
  commit(() => candidate, `Started from ${name}${selected().profile.version === 2 ? '; default scales restored' : ''}.`);
}

function renderPresets() {
  $('starting-point-note').hidden = selected().profile.version !== 2;
  const current = matchingTemplate();
  $('presets').replaceChildren(...['Drizzlet', 'Stock plus fixes'].map((name) => el('button', {
    type: 'button', class: 'chip', id: `preset-${templateId(name)}`,
    'aria-pressed': String(name === current), text: name,
    title: selected().profile.version === 2 ? 'Replace this setup and restore default scales' : 'Replace this setup',
    onclick: () => choosePreset(name)
  })), el('button', {
    type: 'button', class: 'chip', id: 'more-templates', text: 'More starting points…',
    'aria-expanded': String(!$('template-gallery').hidden), 'aria-controls': 'template-gallery',
    onclick: () => {
      if (!$('template-gallery').hidden) { closeTemplates(); return; }
      $('template-gallery').hidden = false;
      renderPresets();
      $('template-gallery').querySelector('button').focus();
    }
  }));
  $('preset-confirm').hidden = !presetPending;
  $('preset-confirm').replaceChildren(...presetPending ? presetConfirm(presetPending) : []);
  if (!$('template-gallery').hidden) renderTemplates();
}

// A chip replaces the setup at once only when that loses nothing: the setup is a starting point.
function choosePreset(name) {
  if (matchingTemplate()) { useTemplate(name); return; }
  presetPending = name;
  renderPresets();
  $('preset-replace').focus();
}

function presetConfirm(name) {
  const count = changes(templates(profile())[name], entries, profile()).length + Number(scales !== null);
  const restore = selected().profile.version === 2 ? ' and restore default scales' : '';
  const back = () => { presetPending = null; renderPresets(); $(`preset-${templateId(name)}`).focus(); };
  return [el('p', { id: 'preset-confirm-text', text: `Replace your setup with ${name}? ${count} setting${count === 1 ? '' : 's'}${scales !== null ? ', including your scale bank,' : ''} will change.` }),
    el('div', { class: 'options' },
      el('button', { type: 'button', id: 'preset-replace', onclick: () => { useTemplate(name); $(`preset-${templateId(name)}`).focus(); } },
        el('b', { text: 'Replace' }), `Use ${name}${restore}`),
      el('button', { type: 'button', id: 'preset-cancel', onclick: back }, el('b', { text: 'Cancel' })))];
}

function closeTemplates() {
  templatePreview = null;
  $('template-gallery').hidden = true;
  renderPresets();
  markTemplateChanges();
  $('more-templates').focus();
}

function renderTemplates() {
  const candidates = templates(profile());
  $('template-groups').replaceChildren(...startingPoints.map(([group, items]) =>
    el('section', { class: 'template-group', 'aria-label': group }, el('h3', { text: group }),
      el('div', { class: 'template-cards' }, ...items.map(([name, about]) => {
        return el('button', {
          type: 'button', class: 'template-card', id: `template-${templateId(name)}`,
          'aria-pressed': String(templatePreview === name),
          onclick: () => {
            templatePreview = name;
            renderTemplates();
            markTemplateChanges();
            $(`template-${templateId(name)}`).focus({ preventScroll: true });
          }
        }, el('strong', { text: name }), el('span', { text: about }));
      })))));
  const candidate = candidates[templatePreview];
  $('template-preview').hidden = !candidate;
  if (!candidate) return;
  const different = changes(candidate, entries, profile());
  const describe = (f, e) => [summary(f, e), ...places(e).map((p) => placeName(p.kind, p.slot))].join(' · ');
  const items = different.map((f) => el('li', {}, el('strong', { text: `${f.name}: ` }),
    `${describe(f, entryOf(entries, f))} → ${describe(f, entryOf(candidate, f))}`));
  if (selected().profile.version === 2 && scales !== null) items.push(el('li', { text: 'Restore the default scale bank, including its definitions, order and LED indications.' }));
  $('template-preview-title').textContent = `${templatePreview}: ${items.length} change${items.length === 1 ? '' : 's'}`;
  $('template-changes').replaceChildren(...[items.length ? el('ul', {}, ...items.slice(0, 6)) :
    el('p', { text: 'Your setup already matches this starting point.' }),
    items.length > 6 ? el('details', {}, el('summary', { text: `${items.length - 6} more changes` }),
      el('ul', {}, ...items.slice(6))) : null].filter(Boolean));
  $('use-template').textContent = `Use ${templatePreview}`;
  $('use-template').onclick = () => {
    useTemplate(templatePreview);
    $('more-templates').focus();
  };
}

// Preview marks affected destinations without changing entries, the share link,
// the downloaded guide, or the firmware that Build will make.
function markTemplateChanges() {
  const candidate = templatePreview && templates(profile())[templatePreview];
  for (const kind of Object.keys(KINDS)) {
    for (let slot = 1; slot <= slotCount(kind, profile()); ++slot) {
      const before = occupant(entries, kind, slot);
      const after = candidate && occupant(candidate, kind, slot);
      const changed = Boolean(candidate && before?.join() !== after?.join());
      $(kind === 'page' ? `cell-${slot}` : `${kind}-${slot}`)?.classList.toggle('template-change', changed);
    }
  }
}

const pageNumbers = () => pageLeds(profile()).map((_, i) => i + 1);
const leds = (page) => el('span', { class: 'leds', 'aria-hidden': 'true' },
  ...[0, 1, 2].map((i) => el('i', { class: pageLeds(profile())[page - 1] & (1 << i) ? 'lit' : '' })));

// The two visible lines of a position; its accessible name repeats them (WCAG 2.5.3).
function cellText(kind, slot) {
  const e = occupant(entries, kind, slot);
  const f = e && featureById(e[0]);
  if (kind === 'page') return [f ? f.name : 'Empty', f ? summary(f, e) : 'Choose a feature'];
  const does = !f ? 'Nothing' : kind === 'action' ? ACTION_DOES[f.id] || f.name : f.name;
  const named = kind === 'action' && !does.toLowerCase().includes(f?.name.toLowerCase());
  return [does, !f ? 'Choose a feature' : named ? `${f.name} · ${summary(f, e)}` : summary(f, e)];
}

function cellLabel(kind, slot) {
  const where = kind === 'page' ? `Page ${pageOf(slot)}, ${KNOBS[(slot - 1) % 3]}` : placeName(kind, slot);
  const [name, value] = cellText(kind, slot);
  return `${where}: ${name}, ${value.toLowerCase().replace(' · ', ', ')}`;
}
// Separate the visible lines' words for speech input; flex layout ignores the space.
const lines = (...spans) => spans.flatMap((span, i) => i ? [' ', span] : [span]);
const isSelected = (kind, slot) => selection.kind === kind && selection.slot === slot;

function renderGrid() {
  const focus = selection.kind === 'page' && pageOf(selection.slot) === pageTab ? selection.slot : (pageTab - 1) * 3 + 1;
  const rows = pageNumbers().map((page) => el('tr', { class: page === pageTab ? 'current' : '', 'data-page': page },
    el('th', { scope: 'row' }, el('span', { class: 'page-name', text: `Page ${page}` }), leds(page)),
    ...[0, 1, 2].map((knob) => {
      const slot = (page - 1) * 3 + knob + 1;
      const e = occupant(entries, 'page', slot);
      const [name, value] = cellText('page', slot);
      const cell = el('button', {
        type: 'button', id: `cell-${slot}`, class: `cell${e ? '' : ' empty'}`, 'data-slot': slot,
        'aria-label': cellLabel('page', slot), 'aria-pressed': String(isSelected('page', slot)),
        tabindex: slot === focus ? '0' : '-1', draggable: e ? 'true' : 'false',
        onclick: () => choose('page', slot)
      }, ...lines(el('span', { class: 'cell-knob', 'aria-hidden': 'true', text: KNOBS[knob] }),
        el('span', { class: 'cell-name', 'aria-hidden': 'true', text: name }),
        el('span', { class: 'cell-value', 'aria-hidden': 'true', text: value })));
      return el('td', {}, cell);
    })));
  $('grid').tBodies[0].replaceChildren(...rows);
  $('grid').caption.textContent = `Options pages 1 to ${rows.length} by knob. Arrow keys move, Enter selects, Delete empties a position.`;
  markTemplateChanges();
  const tabs = document.querySelector('.page-tabs');
  // More than four pages take two rows of tabs, so seven fit a phone.
  tabs.style.gridTemplateColumns = `repeat(${rows.length > 4 ? Math.ceil(rows.length / 2) : rows.length}, 1fr)`;
  tabs.replaceChildren(...pageNumbers().map((page) => el('button', {
    type: 'button', role: 'tab', id: `tab-${page}`, 'aria-selected': String(page === pageTab),
    'aria-controls': 'grid', tabindex: page === pageTab ? '0' : '-1',
    onclick: () => { pageTab = page; renderGrid(); markTemplateChanges(); $(`tab-${page}`).focus(); }
  }, `Page ${page}`, leds(page))));
}

// The pages [M] cycles through, and compaction only after a preview.
function renderPages() {
  const used = usedPages(entries, profile());
  const moves = compaction(entries, profile());
  const parts = [used.length ?
    `${used.length} of ${pageNumbers().length} pages used. After power-on, holding [M] opens page ${used[0]}; ` +
      `taps go ${[...used, used[0]].join(' → ')}, skipping empty pages. Reopening returns to the last page shown.` :
    'Holding [M] opens nothing: no feature is on an options page.'];
  if (moves.length && !compactPreview) {
    parts.push(' ', el('button', { type: 'button', class: 'quiet', id: 'compact-pages',
      onclick: () => { compactPreview = true; renderPages(); $('compact-apply').focus(); } }, 'Compact pages…'));
  }
  if (moves.length && compactPreview) {
    parts.push(el('div', { class: 'confirm', role: 'group', 'aria-labelledby': 'compact-text' },
      el('p', { id: 'compact-text', text: `Move ${moves.map(([from, to]) => `page ${from} to page ${to}`).join(', ')}. ` +
        'Knob positions on each page stay; the page LEDs change with the page number.' }),
      el('div', { class: 'options' },
        el('button', { type: 'button', id: 'compact-apply', onclick: () => {
          const to = selection.kind === 'page' && new Map(moves).get(pageOf(selection.slot));
          if (to) selection = { kind: 'page', slot: selection.slot - (pageOf(selection.slot) - to) * 3 };
          if (selection.kind === 'page') pageTab = pageOf(selection.slot);
          commit(() => compact(entries, profile()), `Pages compacted: ${moves.map(([from, to]) => `${from} → ${to}`).join(', ')}.`);
          focusSelection();
        } }, el('b', { text: 'Compact' })),
        el('button', { type: 'button', id: 'compact-cancel', onclick: () => {
          compactPreview = false; renderPages(); $('compact-pages').focus();
        } }, el('b', { text: 'Cancel' })))));
  }
  $('page-order').replaceChildren(...parts);
}

// Arrow keys move between positions, Enter selects, Delete empties one.
function gridKeys(event) {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  const slot = Number(cell.dataset.slot);
  const col = (slot - 1) % 3;
  const step = { ArrowRight: col < 2 ? 1 : 0, ArrowLeft: col > 0 ? -1 : 0, ArrowDown: slot <= slotCount('page', profile()) - 3 ? 3 : 0,
    ArrowUp: slot > 3 ? -3 : 0, Home: -col, End: 2 - col }[event.key];
  if (step !== undefined) {
    event.preventDefault();
    const next = slot + step;
    if (pageOf(next) !== pageTab) { pageTab = pageOf(next); renderGrid(); }
    document.querySelectorAll('.cell').forEach((c) => c.setAttribute('tabindex', c.id === `cell-${next}` ? '0' : '-1'));
    $(`cell-${next}`).focus();
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && occupant(entries, 'page', slot)) {
    event.preventDefault();
    selection = { kind: 'page', slot };
    clear('page', slot);
    $(`cell-${slot}`).focus();
  }
}

function tabKeys(event) {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (!step || !event.target.matches('[role=tab]')) return;
  event.preventDefault();
  const count = pageNumbers().length;
  pageTab = (pageTab + step + count - 1) % count + 1;
  renderGrid();
  $(`tab-${pageTab}`).focus();
}

// Drag a feature onto another position: it moves there, or the two swap.
let dragged = 0;
function gridDrag() {
  const grid = $('grid');
  grid.addEventListener('dragstart', (event) => {
    const cell = event.target.closest('.cell');
    if (!cell || !occupant(entries, 'page', Number(cell.dataset.slot))) return;
    dragged = Number(cell.dataset.slot);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(dragged));
  });
  grid.addEventListener('dragover', (event) => {
    const cell = event.target.closest('.cell');
    if (!cell || !dragged) return;
    event.preventDefault();
    document.querySelectorAll('.cell.drop').forEach((c) => c !== cell && c.classList.remove('drop'));
    cell.classList.add('drop');
  });
  grid.addEventListener('dragleave', (event) => event.target.closest('.cell')?.classList.remove('drop'));
  grid.addEventListener('dragend', () => { dragged = 0; document.querySelectorAll('.cell.drop').forEach((c) => c.classList.remove('drop')); });
  grid.addEventListener('drop', (event) => {
    const cell = event.target.closest('.cell');
    if (!cell || !dragged) return;
    event.preventDefault();
    const from = dragged, to = Number(cell.dataset.slot);
    dragged = 0;
    if (from === to) return;
    const moving = occupant(entries, 'page', from)[0];
    selection = { kind: 'page', slot: to };
    move(moving, 'page', to, 'swap');
  });
}

function renderSlots() {
  for (const kind of ['amount', 'action']) {
    $(kind === 'amount' ? 'amounts' : 'actions').replaceChildren(...Array.from({ length: slotCount(kind, profile()) }, (_, i) => {
      const slot = i + 1;
      const [does, what] = cellText(kind, slot);
      return el('button', {
        type: 'button', id: `${kind}-${slot}`, class: `slot${occupant(entries, kind, slot) ? '' : ' empty'}`,
        'aria-pressed': String(isSelected(kind, slot)), 'aria-label': cellLabel(kind, slot),
        onclick: () => choose(kind, slot)
      }, ...lines(el('span', { class: 'gesture', 'aria-hidden': 'true', text: placeName(kind, slot) }),
        el('span', { class: 'does', 'aria-hidden': 'true', text: does }),
        el('span', { class: 'what', 'aria-hidden': 'true', text: what })));
    }));
  }
  // Settings with no control, outside Extras: easy to miss otherwise.
  const loose = profile().features.filter((f) => f.default_in_block !== false && placeable(f)).filter((f) => {
    const e = entryOf(entries, f);
    return e[1] && !places(e).length;
  });
  $('unplaced').hidden = !loose.length;
  $('unplaced').replaceChildren(loose.length ? 'No control: ' : '', ...loose.flatMap((f, i) => [i ? ', ' : '',
    el('button', { type: 'button', id: `loose-${f.id}`, onclick: () => { selection = { id: f.id }; render(); $('inspector-title')?.focus(); } },
      `${f.name} (${entryOf(entries, f)[1] === 2 ? 'not placed' : summary(f, entryOf(entries, f)).toLowerCase()})`)]));
  $('bank-warning').textContent = bankWarning(entries, profile());
  $('bank-warning').hidden = !$('bank-warning').textContent;
  $('gesture-firmware').textContent = gestureFirmware(entries);
  $('gesture-firmware').hidden = !$('gesture-firmware').textContent;
}

// Extras that read better under another name here.
const EXTRA_NAMES = { 31: 'Starting bank' };

function renderExtras() {
  const extras = profile().features.filter((f) => (f.default_in_block === false && !f.amount) || !placeable(f));
  $('extras').replaceChildren(...EXTRA_GROUPS.map(([group], n) => {
    const members = extras.filter((f) => extraGroup(f) === group);
    return members.length && el('section', { class: 'extra-group', 'aria-labelledby': `extras-group-${n}` },
      el('h3', { id: `extras-group-${n}`, text: group }), el('div', { class: 'extra-list' }, ...members.map(extra)));
  }).filter(Boolean));
}

function extra(f) {
  const e = entryOf(entries, f);
  const help = featureHelp(f, selected());
  const control = extraControl(f);
  const title = EXTRA_NAMES[f.id] ?? f.name;
  const name = el('span', { class: 'extra-name', id: `extra-${f.id}-name`, text: title });
  const about = el('small', { id: `extra-${f.id}-about`, text: help.description });
  // A value the module itself can change is only where it starts.
  const start = e[1] === 2 && !placeable(f) ? el('small', { class: 'start', id: `extra-${f.id}-start`, text: `Starting value. ${stateHint(f, 2)}` }) : null;
  const described = [about, start].filter(Boolean).map((part) => part.id).join(' ');
  const more = (help.details || help.url) ? el('details', { class: 'extra-more', id: `extra-${f.id}-more` }, el('summary', {}, 'More', el('span', { class: 'sr-only', text: ` about ${title}` })),
    help.details ? el('p', { id: `extra-${f.id}-details`, text: help.details }) : null,
    help.url ? el('a', { class: 'linkish', href: help.url, text: 'Documentation', 'aria-label': `${f.name} documentation` }) : null) : null;
  if (control === 'switch') {
    const input = el('input', { type: 'checkbox', role: 'switch', id: `extra-${f.id}`, 'aria-labelledby': `extra-${f.id}-name`,
      'aria-describedby': described, onchange: (event) => commit(() => edit(entries, profile(), f, 1, event.target.checked ? 1 : 0)) });
    input.checked = e[1] === 1 && e[2] === 1;
    return el('div', { class: 'extra' }, el('label', { for: `extra-${f.id}` }, name),
      el('label', { class: 'switch' }, input, el('span')), about, start, more);
  }
  if (control === 'number') {
    // Empty is Off; a whole number from 0 to 255 is Fixed at that byte.
    const input = el('input', { type: 'number', id: `extra-${f.id}`, min: 0, max: 255, step: 1, placeholder: 'Not set',
      'aria-labelledby': `extra-${f.id}-name`, 'aria-describedby': described });
    input.value = e[1] ? e[2] : '';
    input.onchange = () => {
      if (input.value.trim() === '' && !input.validity.badInput) { commit(() => edit(entries, profile(), f, 1, 0)); return; }
      if (!input.validity.valid) {
        input.value = e[1] ? e[2] : '';
        status(`${f.name}: use a whole number from 0 to 255, or leave it empty. Previous value kept.`, 'error');
        return;
      }
      const v = input.valueAsNumber;
      commit(() => e[1] ? edit(entries, profile(), f, 2, v) : edit(edit(entries, profile(), f, 1, 1), profile(), f, 2, v));
    };
    return el('div', { class: 'extra' }, el('label', { for: `extra-${f.id}` }, name), input, about, start, more);
  }
  const select = el('select', { id: `extra-${f.id}`, 'aria-labelledby': `extra-${f.id}-name`, 'aria-describedby': described });
  const offered = offeredValues(f, profile());
  f.values.forEach((v, i) => { if (offered.includes(i)) select.add(new Option(i === 0 && e[1] !== 2 && !/\b(stock|default)\b/i.test(valueLabel(f, i)) ? `${valueLabel(f, i)} (stock)` : valueLabel(f, i), i)); });
  select.value = e[1] ? e[2] : 0;
  select.onchange = () => {
    const v = Number(select.value);
    commit(() => {
      if (e[1] === 2) return edit(entries, profile(), f, 2, v);
      if (!v) return edit(entries, profile(), f, 1, 0);
      return edit(edit(entries, profile(), f, 1, 1), profile(), f, 2, v);
    });
  };
  const on = places(e).find((p) => p.kind === 'page');
  const placement = f.page ? el('span', { class: 'placement' }, on ? `On ${placeName('page', on.slot)}, starting value shown.` : '',
    el('button', { type: 'button', id: `extra-${f.id}-place`, onclick: () => putOnPage(f) }, on ? 'Show' : 'Put on an options page')) : null;
  return el('div', { class: 'extra' }, el('label', { for: `extra-${f.id}` }, name), select, about, start, placement, more);
}

function putOnPage(f) {
  const on = places(entryOf(entries, f)).find((p) => p.kind === 'page');
  if (on) { selection = on; pageTab = pageOf(on.slot); render(); $(`cell-${on.slot}`).focus(); return; }
  const slot = freeSlot(entries, 'page', profile());
  if (!slot) {
    selection = { id: f.id };
    render();
    status('All page positions are in use: choose one to swap or replace.');
    $('where-page')?.focus();
    return;
  }
  selection = { kind: 'page', slot };
  pageTab = pageOf(slot);
  move(f.id, 'page', slot);
  $(`cell-${slot}`).focus();
}

// Select a destination; an empty one opens the library.
function choose(kind, slot) {
  selection = { kind, slot };
  if (kind === 'page') pageTab = pageOf(slot);
  pending = null;
  render();
  if (!occupant(entries, kind, slot)) openLibrary({ kind, slot });
  else if (matchMedia('(max-width: 760px)').matches) $('inspector').scrollIntoView({ block: 'nearest' });
}

function clear(kind, slot) {
  const e = occupant(entries, kind, slot);
  if (!e) return;
  const f = featureById(e[0]);
  commit(() => unplace(entries, profile(), f.id, kind), `${f.name} off ${placeName(kind, slot)}; it ${afterUnplace(entries, profile(), f.id, kind)}.`);
}

function move(id, kind, slot, mode) {
  const f = featureById(id);
  const taken = occupant(entries, kind, slot);
  const other = taken && taken[0] !== id ? featureById(taken[0]) : null;
  const from = entryOf(entries, f)[KINDS[kind].index];
  let message = `${f.name} on ${placeName(kind, slot)}.`;
  if (other && mode === 'swap' && from) message += ` ${other.name} moved to ${placeName(kind, from)}.`;
  else if (other) message += ` ${other.name} ${afterUnplace(entries, profile(), other.id, kind)}.`;
  commit(() => place(entries, profile(), id, kind, slot, mode), message);
}

// Swap or Replace, for a destination that is taken.
function confirmChoices(id, kind, slot, done, back) {
  const f = featureById(id);
  const other = featureById(occupant(entries, kind, slot)[0]);
  const from = entryOf(entries, f)[KINDS[kind].index];
  const options = [];
  if (canSwap(entries, profile(), id, kind, slot)) {
    options.push(el('button', { type: 'button', id: 'confirm-swap', onclick: () => done('swap') },
      el('b', { text: 'Swap' }), `${f.name} goes here, ${other.name} to ${placeName(kind, from)}`));
  }
  options.push(el('button', { type: 'button', id: 'confirm-replace', onclick: () => done('replace') },
    el('b', { text: 'Replace' }), `${f.name} goes here, ${other.name} ${afterUnplace(entries, profile(), other.id, kind)}`));
  options.push(el('button', { type: 'button', id: 'confirm-back', onclick: back }, el('b', { text: 'Cancel' })));
  return el('div', { class: 'confirm', role: 'group', 'aria-labelledby': 'confirm-text' },
    el('p', { id: 'confirm-text', text: `${cap(placeName(kind, slot))} has ${other.name}.` }),
    el('div', { class: 'options' }, ...options));
}


function renderInspector() {
  const kind = selection.kind, slot = selection.slot;
  const e0 = kind ? occupant(entries, kind, slot) : null;
  const id = kind ? e0?.[0] : selection.id;
  $('panel-caption').textContent = highlight($('panel'), kind || places(entryOf(entries, featureById(id))).find(() => true)?.kind,
    kind ? slot : places(entryOf(entries, featureById(id))).find(() => true)?.slot, profile());
  const body = [];
  if (kind) body.push(el('p', { class: 'where', text: cap(placeName(kind, slot)) }));
  if (!id) {
    body.push(el('h3', { id: 'inspector-title', tabindex: '-1', text: 'Empty' }),
      el('p', { class: 'note', text: kind === 'action' ? 'This gesture does nothing.' : 'This position does nothing.' }),
      el('div', { class: 'inspector-actions' }, el('button', { type: 'button', class: 'primary', id: 'choose-feature',
        onclick: () => openLibrary({ kind, slot }) }, 'Choose a feature')));
    $('inspector').replaceChildren(...body);
    return;
  }
  const f = featureById(id);
  const e = entryOf(entries, f);
  const help = featureHelp(f, selected());
  body.push(el('h3', { id: 'inspector-title', tabindex: '-1', text: f.name }),
    el('p', { class: 'description' }, help.description,
      help.url ? ' ' : null,
      help.url ? el('a', { href: help.url, text: 'Documentation', 'aria-label': `${f.name} documentation` }) : null));
  if (help.details) body.push(el('p', { class: 'note', id: 'feature-details', text: help.details }));
  if (actionHelp(f)) body.push(el('p', { class: 'note', id: 'action-help', text: actionHelp(f) }));
  if (palette && ((f.id === 7 && synthLock(palette)) || (f.id === 31 && !palette.models.length))) {
    body.push(el('p', { class: 'note', text: f.id === 7 ? synthLock(palette) : 'Starting bank locked: no Plaits banks installed.' }));
    $('inspector').replaceChildren(...body);
    return;
  }
  const change = (k, value, message) => commit(() => edit(entries, profile(), f, k, value), message);
  body.push(el('fieldset', { class: 'choices' }, el('legend', { text: 'How it works' }),
    ...modes(f).filter(([state]) => state || f.id !== GAIN).map(([state]) => {
      const input = el('input', { type: 'radio', name: 'state', id: `state-${state}`, value: state,
        onchange: () => setState(f, state) });
      input.checked = e[1] === state;
      return el('label', { class: 'choice', for: `state-${state}` }, input,
        el('span', {}, stateLabel(f, state), el('small', { text: stateHint(f, state) })));
    })));
  if (e[1] && f.id !== GAIN) {
    const label = e[1] === 1 ? 'Value' : 'Starting value';
    if (f.values) {
      const select = el('select', { id: 'value', 'aria-label': `${f.name}: ${label}` });
      const offered = offeredValues(f, profile());
      f.values.forEach((v, i) => { if (offered.includes(i) && !(f.id === 1 && profile().version === 2 && i >= 2 && !effectiveScales(scales).some((s) => s.id === i)) && !(e[1] === 1 && i === 0 && f.values[0] === 'Off' && !(f.id === 1 && profile().version === 2))) select.add(new Option(valueLabel(f, i), i)); });
      select.value = e[2];
      select.onchange = () => change(2, Number(select.value));
      body.push(el('label', { class: 'field', for: 'value' }, label, select));
    } else {
      const input = el('input', { type: 'number', id: 'value', min: 0, max: 255, step: 1, required: true,
        'aria-label': `${f.name}: ${label} (0–255)` });
      input.value = e[2];
      input.onchange = () => {
        if (input.value.trim() === '' || !input.validity.valid) {
          input.value = e[2];
          status(`${f.name}: use a whole number from 0 to 255. Previous value kept.`, 'error');
          return;
        }
        change(2, input.valueAsNumber);
      };
      body.push(el('label', { class: 'field', for: 'value' }, `${label} (0–255)`, input));
    }
    if (e[1] === 2) body.push(el('p', { class: 'note', text: 'Used after installing and after a settings reset.' }));
  }
  for (const [where, allowed, title] of [['page', f.page && e[1] === 2, 'Options page position'],
    ['amount', f.amount && e[1] === 2, 'Hold [A] and turn'],
    ['action', f.action && (e[1] === 2 || (f.stateless && e[2])), '[A] gesture']]) {
    if (!allowed) continue;
    const index = KINDS[where].index;
    const select = el('select', { id: `where-${where}`, 'aria-label': `${f.name}: ${title}` });
    select.add(new Option(e[1] === 2 && where !== 'action' ? 'Not placed' : 'None', 0));
    for (let s = 1; s <= slotCount(where, profile()); ++s) {
      if (!fitsSlot(profile(), f, where, s)) continue;
      const other = occupant(entries, where, s);
      select.add(new Option(cap(placeName(where, s)) + (other && other[0] !== f.id ? ` (${featureById(other[0]).name})` : ''), s));
    }
    select.value = e[index];
    select.onchange = () => {
      const s = Number(select.value);
      if (!s) { selection = { id: f.id }; clear(where, e[index]); return; }
      const other = occupant(entries, where, s);
      if (other && other[0] !== f.id) {
        pending = { id: f.id, kind: where, slot: s };
        render();
        $(canSwap(entries, profile(), f.id, where, s) ? 'confirm-swap' : 'confirm-replace').focus();
        return;
      }
      selection = { kind: where, slot: s };
      move(f.id, where, s);
    };
    body.push(el('label', { class: 'field', for: `where-${where}` }, title, select));
    if (pending && pending.id === f.id && pending.kind === where) {
      const { slot: s } = pending;
      body.push(confirmChoices(f.id, where, s, (mode) => { selection = { kind: where, slot: s }; move(f.id, where, s, mode); focusSelection(); },
        () => { pending = null; render(); $(`where-${where}`).focus(); }));
    }
  }
  if (e[1] === 2 && !places(e).length && placeable(f)) body.push(el('p', { class: 'warn', text: 'Not on a control yet: choose where to change it.' }));
  if ([9, 31].includes(f.id) && bankWarning(entries, profile())) body.push(el('p', { class: 'warn', id: 'inspector-bank-warning', text: bankWarning(entries, profile()) }));
  if (kind) {
    body.push(el('div', { class: 'inspector-actions' },
      el('button', { type: 'button', class: 'quiet', id: 'choose-feature', onclick: () => openLibrary({ kind, slot }) }, 'Choose another feature'),
      el('button', { type: 'button', class: 'quiet', id: 'clear-position', onclick: () => { clear(kind, slot); focusSelection(); } }, kind === 'action' ? 'Remove gesture' : 'Empty this position')));
  }
  $('inspector').replaceChildren(...body);
}

// Choosing "Change on the module" puts the feature on the first free control.
function setState(f, state) {
  commit(() => state === 2 ? adjust(entries, profile(), f) : edit(entries, profile(), f, 1, state));
  const now = places(entryOf(entries, f));
  if (selection.kind && !now.some((p) => p.kind === selection.kind && p.slot === selection.slot)) {
    selection = now[0] || { id: f.id };
    render();
  }
  $(`state-${state}`)?.focus();
}

// The feature library: grouped, searchable, filtered to what fits a destination.
let libraryTarget = null;
function openLibrary(target) {
  libraryTarget = target;
  $('library-search').value = '';
  $('library-title').textContent = target ? 'Choose a feature' : 'All features';
  $('library-target').textContent = target ? `For ${placeName(target.kind, target.slot)}.` : 'Choose one to see and change it.';
  renderLibrary();
  $('library').showModal();
  $('library-search').focus();
}

function renderLibrary(confirm = null) {
  const body = $('library-body');
  if (confirm) {
    const { id, kind, slot } = confirm;
    body.replaceChildren(confirmChoices(id, kind, slot, (mode) => {
      $('library').close();
      selection = { kind, slot };
      move(id, kind, slot, mode);
      focusSelection();
    }, () => { renderLibrary(); $(`lib-${id}`)?.focus(); }));
    body.querySelector('button').focus();
    return;
  }
  const target = libraryTarget;
  const query = $('library-search').value.trim().toLowerCase();
  const here = target && occupant(entries, target.kind, target.slot);
  const groups = libraryGroups(profile()).map(([name, ids]) => {
    const items = ids.map(featureById).filter((f) => f && (!target || fitsSlot(profile(), f, target.kind, target.slot)))
      .filter((f) => !query || `${f.name} ${featureHelp(f, selected()).description}`.toLowerCase().includes(query))
      .map((f) => {
        const e = entryOf(entries, f);
        const at = places(e).length ? 'On ' + places(e).map((p) => placeName(p.kind, p.slot)).join(', ') : `No control · ${summary(f, e)}`;
        return el('button', { type: 'button', class: `library-item${here && here[0] === f.id ? ' here' : ''}`, id: `lib-${f.id}`,
          'aria-describedby': `lib-${f.id}-about`, disabled: Boolean(target && f.id === 7 && palette && synthLock(palette)), onclick: () => pick(f.id) },
        el('span', { class: 'name', text: f.name }), el('span', { class: 'at', text: at }),
        el('span', { class: 'about', id: `lib-${f.id}-about`, text: f.id === 7 && palette && synthLock(palette) || featureHelp(f, selected()).description }));
      });
    return items.length ? el('section', { class: 'library-group', 'aria-label': name }, el('h3', { text: name }), ...items) : null;
  }).filter(Boolean);
  const parts = [];
  if (here) {
    parts.push(el('button', { type: 'button', class: 'quiet', id: 'library-clear', onclick: () => {
      $('library').close(); clear(target.kind, target.slot); focusSelection();
    } }, `Leave ${placeName(target.kind, target.slot)} empty`));
  }
  parts.push(...groups);
  if (!groups.length) parts.push(el('p', { class: 'note', text: 'No features match.' }));
  body.replaceChildren(...parts);
}

function pick(id) {
  const target = libraryTarget;
  if (!target) {
    $('library').close();
    const at = places(entryOf(entries, featureById(id)))[0];
    selection = at || { id };
    if (at?.kind === 'page') pageTab = pageOf(at.slot);
    render();
    $('inspector-title').focus();
    return;
  }
  const taken = occupant(entries, target.kind, target.slot);
  if (taken && taken[0] !== id) { renderLibrary({ id, ...target }); return; }
  $('library').close();
  selection = target;
  if (!taken) move(id, target.kind, target.slot);
  else render();
  focusSelection();
}

function focusSelection() {
  const { kind, slot } = selection;
  const target = kind === 'page' ? $(`cell-${slot}`) : kind ? $(`${kind}-${slot}`) : $('inspector-title');
  target?.focus();
}

// A new selection shows its page on phones; a tab chosen by hand stays.
let shown = '';
function render() {
  const key = JSON.stringify(selection);
  if (key !== shown && selection.kind === 'page') pageTab = pageOf(selection.slot);
  shown = key;
  const focused = document.activeElement?.id;
  if (palette) entries = lockSynth(entries, palette);
  renderPresets(); renderGrid(); renderPages(); renderSlots(); renderExtras(); renderInspector(); markTemplateChanges();
  renderScales(selected().profile.version === 2);
  renderPalette();
  if (focused && document.activeElement === document.body) $(focused)?.focus({ preventScroll: true });
  refresh();
}

async function refresh() {
  const token = ++revision;
  $('result').hidden = true;
  clearCombo();
  const release = selected();
  prepared = null;
  $('save-profile').disabled = true;
  $('build').disabled = true;
  let next;
  try { next = await prepare(release); } catch (error) {
    if (token !== revision) return;
    status(error.message, 'error');
    $('share').removeAttribute('href');
    $('save-profile').disabled = true;
    return;
  }
  if (token !== revision) return;
  prepared = next;
  const block = next.block;
  renderMeter(next.meter);
  if (drafts.save(release, block, preset, Date.now(), manifest.releases.at(-1), setupData()) === 'failed' && !notice.failed) {
    notice.failed = true;
    notice.dismissed = false;
    renderNotice();
  }
  if (releasePending) showReleaseHint();
  $('build').disabled = busy || !next.meter.fits;
  $('save-profile').disabled = false;
  const changed = changes(entries, templates(release.profile)[preset] || defaults(release.profile), release.profile).length + Number(scales !== null);
  $('changes').textContent = changed ? `${changed} change${changed === 1 ? '' : 's'} from ${preset}` : `${preset}, unchanged`;
  const slots = slotCount('page', release.profile);
  const used = Array.from({ length: slots }, (_, i) => occupant(entries, 'page', i + 1)).filter(Boolean).length;
  $('positions').textContent = `${used} of ${slots} page positions used`;
  const fp = await fingerprint(block);
  if (token !== revision) return;
  $('fingerprint').textContent = fp;
  $('share').href = '#' + share(release, block, setupData());
  $('share').onclick = () => { history.replaceState(null, '', $('share').href); status('Copy this address to share.'); };
  try {
    await updateGuides(release, entries, fp, filenames(release, fp,
        equal(block, encodeProfile(defaults(release.profile), release.profile))), scales, () => token === revision);
  } catch (error) {
    if (token === revision) status(error.message, 'error');
    return;
  }
  if (token === revision) $('summary').dataset.fingerprint = fp;
}

// A portable setup is validated before the caller replaces the current screen.
function readSetup(saved, imported = true) {
  let next = saved.setup?.selection ?? null;
  const stockImport = imported && regionSupport(saved.release.profile);
  const content = saved.setup?.content ?? (stockImport ? encodeContent({}) : null);
  if (content !== null) decodeContent(content);
  if (next !== null) next = validateSelection(next);
  else if (saved.setup && stockImport) next = defaultSelection(saved.release);
  else if (saved.plaits) {
    if (saved.plaits.directory.length) throw new Error('This older profile does not identify all installed models or custom content. Reopen its original setup and save a portable profile before importing it. Your current selection is kept.');
    const stock = defaultSelection(saved.release);
    const banks = saved.plaits.banks.length ? saved.plaits.banks : stock.banks;
    next = validateSelection({ ...stock, banks, models: [...new Set([...stock.models, ...banks.flat()])] });
  } else if (stockImport) next = defaultSelection(saved.release);
  return { palette: next, portableContent: content };
}

async function prepare(release) {
  let written = null, plaits = null;
  if ((palette || portableContent) && !regionSupport(release.profile)) throw new Error('This release cannot keep the selected banks or editor content. Open their original release or start fresh.');
  if (regionSupport(release.profile)) {
    if (!release.content) throw new Error('This release has no pinned content assets.');
    if (!palette && !portableContent) {
      const local = storage && readContent(storage);
      if (local?.error) throw new Error('Saved editor content is damaged. Open the editor to repair it.');
      if (local && (local.wave || local.terrains.length)) {
        portableContent = encodeContent(local);
        palette = defaultSelection(release);
      }
    }
    if (palette || portableContent) {
      const selection = palette ?? defaultSelection(release);
      written = await selectedRegion(release, selection, payloads(), cachedFetch);
      plaits = { banks: selection.banks, directory: written.directory };
    } else {
      const region = await fetchAsset(release.content.region, cachedFetch);
      const directory = [];
      for (const e of release.profile.region.default_layout ?? []) {
        const section = region.subarray(e.offset, e.offset + e.size);
        if (section.length !== e.size || await sha256(section) !== e.sha256) throw new Error('Default section hash differs from the release.');
        directory.push({ kind: SECTION_KINDS[SECTION_NAMES.indexOf(e.kind)], offset: e.offset, size: e.size,
          crc: new DataView(section.buffer, section.byteOffset, section.byteLength).getUint32(section.length - 4, true) });
      }
      if (!directory.length) throw new Error('Missing default section layout.');
      written = { region, directory };
    }
  }
  const block = encodeProfile(entries, release.profile, scales, plaits);
  return { written, plaits, block, meter: flashMeter(release.app_size, written, block) };
}

function renderMeter(meter) {
  const box = $('flash-meter');
  box.hidden = false;
  box.replaceChildren(el('h2', { text: 'Flash use' }),
    el('p', { text: `App: ${meter.app} B. Alignment: ${meter.padding} B.` }),
    ...meter.sections.map((s) => el('p', { text: `${s.kind}: ${s.bytes} B` })),
    el('p', { class: meter.fits ? 'note' : 'warn', text: meter.fits ? `Free to 0x08100000: ${meter.free} B.` :
      `${-meter.free} B too large. Choose which models or sections to remove; nothing is dropped automatically.` }),
    el('p', { text: `Install audio: ${meter.seconds.toFixed(1)} s (estimated install time). Profile: ${meter.profile} / ${meter.profile + meter.profileFree} B.` }));
}

function changePalette(next) {
  palette = validateSelection(next);
  entries = lockSynth(entries, palette);
  const start = entries.find((e) => e[0] === 31);
  if (start && palette.banks.length && start[2] >= palette.banks.length) {
    status('Choose a starting bank within the new bank count.', 'error');
  }
  edited();
  render();
}

function renderPalette() {
  const box = $('palette-editor');
  const release = selected();
  box.hidden = !regionSupport(release.profile);
  if (box.hidden) return;
  const current = palette ?? defaultSelection(release);
  const rows = offeredModels(release);
  const controls = $('palette-controls');
  const missing = refit(current, release);
  $('palette-status').textContent = [synthLock(current), missing.missing.length ?
    `Refit required: models ${missing.missing.join(', ')} are unavailable. Replace their bank slots, then remove them.` : '',
  missing.ringsMissing ? 'Rings is unavailable. Remove it to continue.' : ''].filter(Boolean).join(' ');
  const toggle = (label, on, change, disabled = false) => {
    const input = el('input', { type: 'checkbox', disabled });
    input.checked = on;
    input.onchange = () => { try { change(input.checked); } catch (error) { status(error.message, 'error'); renderPalette(); } };
    return el('label', { class: 'field' }, input, label);
  };
  const children = [toggle('Beads wavetables (WAVE)', current.wave, (wave) => changePalette({ ...current, wave }), !current.models.length),
    toggle('Rings synth', current.rings, (rings) => changePalette({ ...current, rings }), !release.content?.rings && !current.rings),
    el('p', { class: 'note', text: 'Bank colours follow FEEDBACK bank order. Each bank has eight slots.' })];
  const cpu = release.content?.model_cpu;
  if (cpu && current.banks.length) children.push(el('p', { class: 'note', text:
    `CPU screening uses the highest observed six-voice Seed3 callback peak in each bank, multiplied by ${cpu.screening_ratio}.` +
    ' These estimates use a historical margin. Beads transfer is unverified. Production Plaits uses 48 kHz. The 24 kHz limit is provisional.' }));
  const starters = el('fieldset', {}, el('legend', { text: 'Starter banks' }),
    el('p', { class: 'note', text: 'Add eight models as a bank. Your models and banks stay installed. Flash fit is checked before applying.' }));
  for (const bank of starterBanks) {
    const available = bank.models.every((id) => rows.some((row) => row.id === id));
    starters.append(el('button', { type: 'button', text: bank.name,
      disabled: !available || current.banks.length >= 15, onclick: async () => {
        const started = revision;
        try {
          const next = addStarterBank(current, bank, release);
          const local = !portableContent && storage && readContent(storage);
          if (local?.error) throw new Error('Saved editor content is damaged. Open the editor to repair it.');
          const content = local && (local.wave || local.terrains.length) ? encodeContent(local) : portableContent;
          const decoded = content && decodeContent(content);
          const written = await selectedRegion(release, next, decoded ? {
            wave: decoded.wave ?? factoryTable(), terrain: decoded.terrains.length ? grids(decoded.terrains.map((t) => t.grid)) : null
          } : payloads(), cachedFetch);
          const block = encodeProfile(lockSynth(entries, next), release.profile, scales, { banks: next.banks, directory: written.directory });
          const meter = flashMeter(release.app_size, written, block);
          if (!meter.fits) throw new Error(`${-meter.free} B too large. Choose which models to remove; nothing was changed.`);
          if (revision !== started || selected() !== release) return;
          portableContent = content;
          changePalette(next);
        } catch (error) { status(error.message, 'error'); }
      } }));
  }
  children.push(starters);
  for (const row of rows) {
    const note = modelInfo(row.id);
    const info = `${row.name} — ${row.bytes ?? '?'} B; ${row.credit ?? 'Mutable Instruments (MIT)'}`;
    children.push(toggle(note ? `${info}. ${note}` : info, current.models.includes(row.id), (on) => {
      if (on) {
        const models = [...current.models, row.id];
        changePalette({ ...current, models, banks: current.banks.length ? current.banks : [Array(8).fill(row.id)] });
      } else changePalette(removeModel(current, row.id));
    }));
  }
  // Unavailable IDs remain visible and removable after their bank slots are explicitly replaced.
  for (const id of missing.missing) children.push(el('button', { type: 'button', text: `Remove unavailable model ${id}`, onclick: () => {
    try { changePalette(removeModel(current, id)); } catch (error) { status(error.message, 'error'); }
  } }));
  current.banks.forEach((bank, index) => {
    const group = el('fieldset', {}, el('legend', { text: `Bank ${index + 1}` }));
    if (cpu) {
      for (const rate of Object.keys(cpu.working_limits).map(Number).sort((a, b) => b - a)) {
        const peaks = bank.map((id) => rows.find((row) => row.id === id)?.seed3_peak?.[rate]).filter(Number.isFinite);
        const limit = cpu.working_limits[rate];
        const peak = peaks.length ? Math.max(...peaks) : null;
        const screened = peak === null ? null : peak * cpu.screening_ratio;
        const label = `${rate / 1000} kHz`;
        const coverage = peaks.length < bank.length ? ' · incomplete screening (some slots unmeasured)' : '';
        group.append(el('p', { class: 'note', text: screened === null ? `${label} · CPU unmeasured` :
          `${label} · Seed3 peak ${peak.toFixed(1)}% · screened ${screened.toFixed(1)}% · limit ${limit.toFixed(1)}%` +
          coverage }));
        if (screened > limit) group.append(el('p', { class: 'bank-cpu-warning', role: 'alert',
          text: `CPU WARNING: Bank ${index + 1} may crackle at ${label}. The estimate exceeds the working limit. You can still export.` }));
      }
    } else {
      group.append(el('p', { class: 'note', text: 'CPU unmeasured for this release.' }));
    }
    bank.forEach((id, slot) => {
      const select = el('select', { 'aria-label': `Bank ${index + 1}, slot ${slot + 1}` });
      for (const model of current.models) select.add(new Option(rows.find((m) => m.id === model)?.name ?? `Unavailable model ${model}`, model));
      select.value = id;
      select.onchange = () => {
        const banks = current.banks.map((b) => b.slice());
        banks[index][slot] = Number(select.value);
        changePalette({ ...current, banks });
      };
      group.append(select);
    });
    group.append(el('button', { type: 'button', text: 'Remove bank', disabled: current.banks.length === 1, onclick: () => {
      changePalette({ ...current, banks: current.banks.filter((_, i) => i !== index) });
    } }));
    children.push(group);
  });
  children.push(el('button', { type: 'button', text: 'Add bank', disabled: !current.models.length || current.banks.length >= 15, onclick: () =>
    changePalette({ ...current, banks: [...current.banks, Array(8).fill(current.models[0])] }) }),
  el('button', { type: 'button', text: 'Stock banks', disabled: !Array.from({ length: 24 }, (_, id) => id).every((id) => rows.some((m) => m.id === id)), onclick: () =>
    changePalette({ ...current, models: [...new Set([...current.models, ...stockBanks().flat()])], banks: stockBanks() }) }));
  controls.replaceChildren(...children);
}

let pendingShare = false;
function loadSharedProfile() {
  try {
    const shared = location.hash ? unshare(location.hash, manifest.releases) :
      { release: selected(), entries: defaults(selected().profile) };
    const chosen = shared.entries.map((e) => e.slice());
    const restored = readSetup(shared, Boolean(location.hash));
    $('release').value = shared.release.tag;
    entries = chosen;
    scales = shared.scales ?? null;
    ({ palette, portableContent } = restored);
    if (palette) entries = lockSynth(entries, palette);
    status('');
    linkOpened();
    setupEditor();
  } catch (error) {
    linkOpened();
    status(error.message, 'error');
  }
}

// Saved setups: the draft this browser keeps, the one from before a shared link, refused ones.
const saved = (key) => {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
};
const day = (time) => new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const clearFragment = () => {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
};

function edited() {
  drafts.edited();
  clearFragment();
  if (notice.undo) { notice.undo = null; renderNotice(); }
}

// A shared setup replaced the screen: the draft stays as it is until the next edit.
function linkOpened() {
  drafts.linked();
  const own = saved(DRAFT);
  const params = (text) => new URLSearchParams(text.replace(/^#/, '')).toString();
  notice.linked = own !== null && describe(own).fragment !== null &&
    (location.hash.length > MAX_SHARE + 1 || params(describe(own).fragment) !== params(location.hash));
  notice.restored = notice.undo = null;
  notice.dismissed = false;
  renderNotice();
}

// Validate portable restoration before any saved-slot swap or screen replacement.
function readSaved(key = DRAFT) {
  const draft = storage && readDraft(storage, manifest.releases, key);
  if (!draft || draft.refused) return draft;
  try { readSetup(draft); return draft; }
  catch (error) { return { refused: true, raw: draft.raw, error }; }
}

function show(draft) {
  const restored = readSetup(draft);
  $('release').value = draft.release.tag;
  entries = draft.entries.map((e) => e.slice());
  scales = draft.scales;
  ({ palette, portableContent } = restored);
  if (palette) entries = lockSynth(entries, palette);
  preset = draft.preset;
  notice.restored = draft;
  drafts.settled(draft.link, draft.raw);
}

// A draft this page cannot open is kept aside, never deleted; if it cannot be, saving pauses.
function refuse(key, raw) {
  if (setAside(storage, key, raw)) return;
  held.add(key);
  drafts.pause();
}

function restoreDraft() {
  const draft = readSaved();
  if (draft?.refused) refuse(DRAFT, draft.raw);
  else if (draft) show(draft);
}

const focusStart = () => $('presets').querySelector('button')?.focus();

function startFresh() {
  notice.undo = { tag: selected().tag, entries, scales, palette, portableContent, preset, raw: saved(DRAFT), kept: drafts.kept, link: notice.restored?.link ?? false };
  notice.restored = null;
  notice.linked = false;
  $('release').selectedIndex = manifest.releases.length - 1;
  entries = defaults(selected().profile);
  palette = null; portableContent = null;
  scales = null;
  preset = 'Drizzlet';
  put(storage, DRAFT, null);
  drafts.settled();
  clearFragment();
  status('Started from Drizzlet defaults.');
  setupEditor();
  renderNotice();
  focusStart();
}

function undoFresh() {
  const { tag, raw, kept, link, ...previous } = notice.undo;
  notice.undo = null;
  $('release').value = tag;
  ({ entries, scales, palette, portableContent, preset } = previous);
  if (raw !== null) put(storage, DRAFT, raw);
  drafts.settled(link, kept ? raw : null);
  status('Previous setup back.');
  setupEditor();
  renderNotice();
  focusStart();
}

// Opens a saved setup: the draft while a link is unedited, or the second slot, swapped
// with the draft so neither is lost.
function openSaved(key) {
  const draft = readSaved(key);
  if (!draft) { status('That setup is no longer saved in this browser.', 'error'); renderNotice(); return; }
  if (draft.refused) { refuse(key, draft.raw); notice.linked = false; renderNotice(); return; }
  if (key === BEFORE_LINK) {
    const current = saved(DRAFT);
    if (!put(storage, DRAFT, draft.raw)) { status('Could not switch saved setups in this browser.', 'error'); return; }
    if (!put(storage, BEFORE_LINK, current)) {
      put(storage, DRAFT, current);
      status('Could not switch saved setups in this browser.', 'error');
      return;
    }
    // The refused text moved with the swap.
    if (held.delete(DRAFT)) held.add(BEFORE_LINK);
  }
  templatePreview = presetPending = null;
  $('template-gallery').hidden = true;
  show(draft);
  notice.linked = false;
  notice.undo = null;
  clearFragment();
  status('');
  setupEditor();
  renderNotice();
  focusStart();
}

function forgetSaved() {
  forgetDraft(storage);
  drafts.clean();
  drafts.pause(false);
  held.clear();
  Object.assign(notice, { restored: null, linked: false, undo: null, failed: false });
  renderNotice();
  status('Saved setup forgotten. Your next edit is kept again.');
}

function copyRefused(fragment) {
  navigator.clipboard.writeText(`${location.origin}${location.pathname}#${fragment}`)
    .then(() => status('Link copied.'), () => status('Could not copy. Your browser blocked the clipboard.', 'error'));
}

function renderNotice() {
  const button = (id, text, onclick) => el('button', { type: 'button', class: 'quiet', id, text, onclick });
  const lines = [];
  const { restored } = notice;
  if (restored) {
    lines.push([restored.moved ? `Restored your last setup from ${restored.from} on ${restored.release.name} (saved ${day(restored.saved)}); check the new options.` :
      `Restored your last setup (saved ${day(restored.saved)}). It is kept in this browser only; Share link keeps a copy.`,
    button('draft-fresh', 'Start fresh', startFresh)]);
  }
  if (notice.linked) {
    lines.push([`${location.hash ? 'Opened a shared setup. ' : ''}Your last setup is still saved.`, button('draft-open', 'Open it', () => openSaved(DRAFT))]);
  } else if (saved(BEFORE_LINK) !== null && !held.has(BEFORE_LINK)) {
    lines.push(['Another saved setup is also kept.', button('draft-open', 'Open it', () => openSaved(BEFORE_LINK)),
      button('draft-before-discard', 'Discard', () => { put(storage, BEFORE_LINK, null); renderNotice(); focusStart(); })]);
  }
  if (notice.undo) lines.push(['Started fresh.', button('draft-undo', 'Undo', undoFresh)]);
  const refused = [[REFUSED, saved(REFUSED)], ...[...held].map((key) => [key, saved(key)])].filter(([, raw]) => raw);
  refused.forEach(([key, raw], i) => {
    const { name, saved: time, fragment } = describe(raw);
    const about = [name, time !== null ? `saved ${day(time)}` : ''].filter(Boolean).join(', ');
    lines.push([`Your last setup${about ? ` (${about})` : ''} can’t be opened by this page.${held.has(key) ? ' Saving is paused until you discard it.' : ''}`,
      fragment ? button(`draft-copy-${i}`, 'Copy it', () => copyRefused(fragment)) : null,
      button(`draft-discard-${i}`, 'Discard', () => {
        put(storage, key, null);
        held.delete(key);
        drafts.pause(held.size > 0);
        drafts.clean();
        notice.undo = null;
        renderNotice();
        focusStart();
      })]);
  });
  if (notice.failed) lines.push(['This browser is not keeping your setup; Share link keeps a copy.']);
  $('draft-notice').hidden = notice.dismissed || !lines.length;
  $('draft-notice').replaceChildren(...lines.map(([text, ...actions]) => el('p', {}, text, ...actions)),
    el('p', {}, button('draft-dismiss', 'Dismiss', () => { notice.dismissed = true; renderNotice(); focusStart(); })));
}

async function checkCapabilities() {
  if (!globalThis.Worker || !globalThis.crypto?.subtle || !globalThis.AbortSignal?.timeout) {
    throw new Error('Use current Chrome, Firefox, Safari or Edge over HTTPS (or localhost).');
  }
  // A constructor alone does not establish support for module workers.
  await new Promise((resolve, reject) => {
    const worker = new Worker('js/worker.js?v=51ce921e4a13abc4', { type: 'module' });
    const done = (error) => {
      clearTimeout(timer); worker.terminate();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => done(new Error('Builder timed out. Reload or update your browser.')), 10000);
    worker.onmessage = ({ data }) => { if (data.ready) done(); };
    worker.onerror = () => done(new Error('Builder could not load. Reload or update your browser.'));
  });
}

// A release must declare an options page layout this page knows.
function knownPages(releaseProfile) {
  try {
    pageLeds(releaseProfile);
    return true;
  } catch {
    return false;
  }
}

async function init() {
  try {
    await checkCapabilities();
  } catch (error) {
    status(error.message, 'error'); return;
  }
  $('compatibility').hidden = true;
  try {
    const response = await fetch('manifest.json?v=51ce921e4a13abc4', { cache: 'no-cache' });
    manifest = await response.json();
  } catch {
    status('Could not load the release list.', 'error');
    return;
  }
  if (manifest.format !== 3 || !manifest.releases.length ||
      manifest.releases.some((r) => !r.profile || ![1, 2].includes(r.profile.version) || r.profile.offset !== 1024 || r.profile.size !== (r.profile.version === 2 ? 4096 : 512) ||
        !Number.isInteger(r.profile.format) || r.profile.format < 1 || r.profile.format > 0xffffffff || !knownPages(r.profile))) {
    status('Unsupported release list.', 'error'); return;
  }
  try {
    const response = await fetch('starter-banks.json?v=51ce921e4a13abc4');
    if (!response.ok) throw new Error('Could not load starter banks.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await sha256(bytes) !== starterBanksHash) throw new Error('Starter banks differ from this editor version. Reload to update.');
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(data.banks) || data.banks.some((bank) => typeof bank.name !== 'string' ||
        !Array.isArray(bank.models) || bank.models.length !== 8 || !bank.models.every(Number.isInteger))) throw new Error('Invalid starter banks.');
    starterBanks = data.banks;
  } catch (error) { status(error.message, 'error'); }
  for (const release of manifest.releases) $('release').add(new Option(release.name, release.tag));
  const showCounts = mountCounts($('download-counts'), manifest.releases);
  afterInteraction(document, () => {
    recordVisit();
    showCounts();
  });
  $('release').selectedIndex = manifest.releases.length - 1;
  entries = defaults(selected().profile);
  drawPanel($('panel'));
  $('grid').addEventListener('keydown', gridKeys);
  document.querySelector('.page-tabs').addEventListener('keydown', tabKeys);
  gridDrag();
  $('browse').onclick = () => openLibrary(null);
  $('templates-close').onclick = $('cancel-template').onclick = closeTemplates;
  $('library-close').onclick = () => $('library').close();
  $('library-search').oninput = () => renderLibrary();
  $('library-search').onkeydown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); $('library-body').querySelector('button')?.focus(); }
  };
  $('library-body').addEventListener('keydown', (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    const items = [...$('library-body').querySelectorAll('button')];
    const at = items.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    (items[at + step] || (step < 0 ? $('library-search') : items[at]))?.focus();
  });
  $('library').addEventListener('click', (event) => { if (event.target === $('library')) $('library').close(); });
  // Check both slots first, so a later link edit never copies or replaces text this page cannot open.
  for (const key of [DRAFT, BEFORE_LINK]) {
    const draft = readSaved(key);
    if (draft?.refused) refuse(key, draft.raw);
  }
  if (location.hash) loadSharedProfile();
  else restoreDraft();
  window.addEventListener('hashchange', () => {
    if (busy) pendingShare = true;
    else loadSharedProfile();
  });
  $('release').onchange = chooseRelease;
  $('forget-draft').onclick = forgetSaved;
  $('save-profile').onclick = () => {
    if (!prepared) return;
    if (profileFile) URL.revokeObjectURL(profileFile);
    profileFile = URL.createObjectURL(new Blob([JSON.stringify({ v: 1, share: share(selected(), prepared.block, setupData()) })], { type: 'application/json' }));
    const link = el('a', { href: profileFile, download: 'drizzlet-profile.json' });
    link.click();
  };
  $('edit-content').onclick = () => {
    $('edit-content').href = portableContent ? 'editor.html#' + new URLSearchParams({ content: portableContent }) : 'editor.html';
  };
  $('open-profile').onchange = async () => {
    try {
      const file = $('open-profile').files[0];
      if (!file) return;
      if (file.size > 2000000) throw new Error('Profile file is too large.');
      const saved = JSON.parse(await file.text());
      if (saved.v !== 1 || typeof saved.share !== 'string') throw new Error('Unknown profile file.');
      unshare(saved.share, manifest.releases);
      if (busy) throw new Error('Wait for the current build before opening a profile.');
      history.replaceState(null, '', '#' + saved.share);
      loadSharedProfile();
    } catch (error) { status(error.message, 'error'); }
    $('open-profile').value = '';
  };
  window.addEventListener('storage', (event) => {
    // Firmware without a region takes no editor content; a later release with one reads it from storage.
    if (event.key === CONTENT && regionSupport(selected().profile)) {
      const content = storage && readContent(storage);
      if (content?.error) { status('Saved editor content is damaged.', 'error'); return; }
      portableContent = content ? encodeContent(content) : null;
      edited(); render();
    }
  });
  setupEditor();
  renderNotice();
  $('build').onclick = run;
}

init();
