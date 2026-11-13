// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// MIT licence: see encoder.js.
//
// The page: pick a release and lay out its features on the module's controls,
// check the release's app image against the manifest, encode the update .wav
// in the browser, check the .wav, offer it for download.

import { defaults, decodeSettings, encodeProfile, equal, sha256, fingerprint, filenames, share, unshare, templates, validate, modes, normalise } from './profile.js?v=90f5f7a3110f60ee';
import { effectiveScales, validateScales } from './scales.js?v=90f5f7a3110f60ee';
import { scaleEditor } from './scale_editor.js?v=90f5f7a3110f60ee';
import { guide } from './guide.js?v=90f5f7a3110f60ee';
import { mountCounts, recordDownload, recordBuild, recordVisit, afterInteraction } from './downloads.js?v=90f5f7a3110f60ee';
import { featureHelp, actionHelp } from './help.js?v=90f5f7a3110f60ee';
import { KNOBS, KINDS, GROUPS, ACTION_DOES, placeName, pageOf, entryOf, occupant, places, valueLabel, stateLabel,
  summary, edit, place, unplace, afterUnplace, canSwap, freeSlot, changes, fits } from './layout.js?v=90f5f7a3110f60ee';
import { drawPanel, highlight } from './panel.js?v=90f5f7a3110f60ee';
import { DRAFT, BEFORE_LINK, REFUSED, readDraft, setAside, put, forgetDraft, keeper, describe } from './draft.js?v=90f5f7a3110f60ee';

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
    const worker = new Worker('js/worker.js?v=90f5f7a3110f60ee', { type: 'module' });
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
let revision = 0;
const guideURLs = [];
// The preset the change count is measured from, the selected destination
// ({ kind, slot }) or feature ({ id }), and the page shown on phones.
let preset = 'Drizzlet';
let selection = { kind: 'page', slot: 1 };
let pageTab = 1;
let pending = null; // An inspector placement waiting for Swap or Replace.
let presetPending = null; // A starting-point chip waiting for Replace.
let templatePreview = null;
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
let held = null; // The key of a refused draft that could not be set aside; saving pauses meanwhile.

async function build(release, app) {
  if (download) URL.revokeObjectURL(download);
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
  validate(chosen, release.profile);
  const block = encodeProfile(chosen, release.profile, chosenScales);
  const original = app.slice(release.profile.offset, release.profile.offset + release.profile.size);
  if (!equal(original, encodeProfile(defaults(release.profile), release.profile))) {
    throw new Error('Release settings do not match the release list.');
  }
  const isDefault = equal(block, original);
  const base = app.slice();
  app.set(block, release.profile.offset);
  const offset = release.profile.offset;
  if (!equal(app.subarray(0, offset), base.subarray(0, offset)) ||
      !equal(app.subarray(offset + release.profile.size), base.subarray(offset + release.profile.size)) ||
      JSON.stringify(decodeSettings(app.subarray(offset, offset + release.profile.size), release.profile)) !== JSON.stringify({ entries: chosen, scales: chosenScales })) {
    throw new Error('Updated firmware check failed.');
  }
  const appHash = await sha256(app);
  const fp = await fingerprint(block);
  const names = filenames(release, fp, isDefault);
  status('Building and checking…');
  const wav = await encodeInWorker(app.slice());
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
      bank.find((s) => s.id === id)?.name || 'Unavailable scale') }) };
};
const renderScales = scaleEditor($('scale-editor'), {
  get: () => scales,
  releaseKey: () => selected().tag,
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

async function run(getApp) {
  if (busy) return;
  busy = true;
  $('scale-editor').inert = $('workspace').inert = $('presets').inert = $('preset-confirm').inert = $('template-gallery').inert = $('draft-notice').inert = true;
  $('build').disabled = $('release').disabled = $('local').disabled = true;
  $('result').hidden = true;
  try {
    const release = selected();
    await build(release, await getApp(release));
  } catch (error) {
    status(`Stopped: ${error.message}`, 'error');
  } finally {
    $('progress').hidden = true;
    $('local').value = '';
    $('build').disabled = $('release').disabled = $('local').disabled = false;
    busy = false;
    if (pendingShare) { pendingShare = false; loadSharedProfile(); }
    $('scale-editor').inert = $('workspace').inert = $('presets').inert = $('preset-confirm').inert = $('template-gallery').inert = $('draft-notice').inert = false;
  }
}

async function fetchApp(release) {
  status('Downloading firmware…');
  const response = await fetch(release.app, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`could not download the app image (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

async function updateGuides(release, chosen, fp, names, chosenScales = scales) {
  guideURLs.splice(0).forEach((url) => URL.revokeObjectURL(url));
  for (const mobile of [false, true]) {
    const url = URL.createObjectURL(new Blob([guide(chosen, release, fp, mobile, chosenScales)], { type: 'image/svg+xml' }));
    guideURLs.push(url);
    const a = $(mobile ? 'guide-mobile' : 'guide');
    a.href = url; a.download = names[mobile ? 'mobile' : 'desktop'];
  }
}

// Apply an edit; errors leave the profile as it was.
function commit(change, message = '') {
  templatePreview = presetPending = null;
  try {
    entries = change();
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
  presetPending = null;
  $('development').hidden = !selected().development;
  $('expected-hash').textContent = selected().wav_sha256;
  preset = matchingTemplate() || preset;
  render();
}

function useTemplate(name) {
  const candidate = templates(selected().profile)[name].map((e) => e.slice());
  scales = null;
  preset = name;
  $('template-gallery').hidden = true;
  commit(() => candidate, `Started from ${name}${selected().profile.version === 2 ? '; factory scales restored' : ''}.`);
}

function renderPresets() {
  $('starting-point-note').hidden = selected().profile.version !== 2;
  const current = matchingTemplate();
  $('presets').replaceChildren(...['Drizzlet', 'Stock plus fixes'].map((name) => el('button', {
    type: 'button', class: 'chip', id: `preset-${templateId(name)}`,
    'aria-pressed': String(name === current), text: name,
    title: selected().profile.version === 2 ? 'Replace this setup and restore factory scales' : 'Replace this setup',
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
  const restore = selected().profile.version === 2 ? ' and restore factory scales' : '';
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
  if (selected().profile.version === 2 && scales !== null) items.push(el('li', { text: 'Restore the factory scale bank, including its definitions, order and LED indications.' }));
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
  for (const [kind, { count }] of Object.entries(KINDS)) {
    for (let slot = 1; slot <= count; ++slot) {
      const before = occupant(entries, kind, slot);
      const after = candidate && occupant(candidate, kind, slot);
      const changed = Boolean(candidate && before?.join() !== after?.join());
      $(kind === 'page' ? `cell-${slot}` : `${kind}-${slot}`)?.classList.toggle('template-change', changed);
    }
  }
}

const leds = (page) => el('span', { class: 'leds', 'aria-hidden': 'true' },
  ...[0, 1, 2].map((i) => el('i', { class: page === 4 || page === i + 1 ? 'lit' : '' })));

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
  const rows = [1, 2, 3, 4].map((page) => el('tr', { class: page === pageTab ? 'current' : '', 'data-page': page },
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
  markTemplateChanges();
  document.querySelector('.page-tabs').replaceChildren(...[1, 2, 3, 4].map((page) => el('button', {
    type: 'button', role: 'tab', id: `tab-${page}`, 'aria-selected': String(page === pageTab),
    'aria-controls': 'grid', tabindex: page === pageTab ? '0' : '-1',
    onclick: () => { pageTab = page; renderGrid(); markTemplateChanges(); $(`tab-${page}`).focus(); }
  }, `Page ${page}`, leds(page))));
}

// Arrow keys move between positions, Enter selects, Delete empties one.
function gridKeys(event) {
  const cell = event.target.closest('.cell');
  if (!cell) return;
  const slot = Number(cell.dataset.slot);
  const col = (slot - 1) % 3;
  const step = { ArrowRight: col < 2 ? 1 : 0, ArrowLeft: col > 0 ? -1 : 0, ArrowDown: slot <= 9 ? 3 : 0,
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
  pageTab = (pageTab + step + 3) % 4 + 1;
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
    $(kind === 'amount' ? 'amounts' : 'actions').replaceChildren(...Array.from({ length: KINDS[kind].count }, (_, i) => {
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
  const loose = profile().features.filter((f) => f.default_in_block !== false).filter((f) => {
    const e = entryOf(entries, f);
    return e[1] && !places(e).length;
  });
  $('unplaced').hidden = !loose.length;
  $('unplaced').replaceChildren(loose.length ? 'No control: ' : '', ...loose.flatMap((f, i) => [i ? ', ' : '',
    el('button', { type: 'button', id: `loose-${f.id}`, onclick: () => { selection = { id: f.id }; render(); $('inspector-title')?.focus(); } },
      `${f.name} (${entryOf(entries, f)[1] === 2 ? 'not placed' : summary(f, entryOf(entries, f)).toLowerCase()})`)]));
}

function renderExtras() {
  const extras = profile().features.filter((f) => f.default_in_block === false);
  $('extras').replaceChildren(...extras.map((f) => {
    const e = entryOf(entries, f);
    const help = featureHelp(f, selected());
    const toggle = f.values?.length === 2 && f.values[0] === 'Off' && !f.page;
    const name = el('span', { class: 'extra-name', id: `extra-${f.id}-name`, text: f.name });
    if (toggle) {
      const input = el('input', { type: 'checkbox', role: 'switch', id: `extra-${f.id}`, 'aria-labelledby': `extra-${f.id}-name`,
        'aria-describedby': `extra-${f.id}-about`, onchange: (event) => commit(() => edit(entries, profile(), f, 1, event.target.checked ? 1 : 0)) });
      input.checked = e[1] === 1 && e[2] === 1;
      return el('div', { class: 'extra' }, el('label', { for: `extra-${f.id}` }, name),
        el('label', { class: 'switch' }, input, el('span')), el('small', { id: `extra-${f.id}-about`, text: help.description }));
    }
    const select = el('select', { id: `extra-${f.id}`, 'aria-labelledby': `extra-${f.id}-name`, 'aria-describedby': `extra-${f.id}-about` });
    f.values.forEach((v, i) => select.add(new Option(i === 0 && e[1] !== 2 && !/\bstock\b/i.test(valueLabel(f, i)) ? `${valueLabel(f, i)} (stock)` : valueLabel(f, i), i)));
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
    return el('div', { class: 'extra' }, el('label', { for: `extra-${f.id}` }, name), select,
      el('small', { id: `extra-${f.id}-about`, text: help.description }), placement);
  }));
}

function putOnPage(f) {
  const on = places(entryOf(entries, f)).find((p) => p.kind === 'page');
  if (on) { selection = on; pageTab = pageOf(on.slot); render(); $(`cell-${on.slot}`).focus(); return; }
  const slot = freeSlot(entries, 'page');
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

const STATE_HINTS = [
  (f) => f.id === 12 ? 'Grains go to the reverb unsoftened.' : 'As in Mutable Instruments’ firmware.',
  () => 'No control on the module.',
  () => 'On a control; your changes are saved.'
];

function renderInspector() {
  const kind = selection.kind, slot = selection.slot;
  const e0 = kind ? occupant(entries, kind, slot) : null;
  const id = kind ? e0?.[0] : selection.id;
  $('panel-caption').textContent = highlight($('panel'), kind || places(entryOf(entries, featureById(id))).find(() => true)?.kind,
    kind ? slot : places(entryOf(entries, featureById(id))).find(() => true)?.slot);
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
    el('p', { class: 'description' }, help.description + ' ',
      el('a', { href: help.url, text: 'Documentation', 'aria-label': `${f.name} documentation` })));
  if (help.details) body.push(el('p', { class: 'note', id: 'feature-details', text: help.details }));
  if (actionHelp(f)) body.push(el('p', { class: 'note', id: 'action-help', text: actionHelp(f) }));
  const change = (k, value, message) => commit(() => edit(entries, profile(), f, k, value), message);
  body.push(el('fieldset', { class: 'choices' }, el('legend', { text: 'How it works' }),
    ...modes(f).map(([state]) => {
      const input = el('input', { type: 'radio', name: 'state', id: `state-${state}`, value: state,
        onchange: () => setState(f, state) });
      input.checked = e[1] === state;
      return el('label', { class: 'choice', for: `state-${state}` }, input,
        el('span', {}, stateLabel(f, state), el('small', { text: STATE_HINTS[state](f) })));
    })));
  if (e[1]) {
    const label = e[1] === 1 ? 'Value' : 'Starting value';
    if (f.values) {
      const select = el('select', { id: 'value', 'aria-label': `${f.name}: ${label}` });
      f.values.forEach((v, i) => { if (!(f.id === 1 && profile().version === 2 && i >= 2 && !effectiveScales(scales).some((s) => s.id === i)) && !(e[1] === 1 && i === 0 && f.values[0] === 'Off' && !(f.id === 1 && profile().version === 2))) select.add(new Option(valueLabel(f, i), i)); });
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
    for (let s = 1; s <= KINDS[where].count; ++s) {
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
  if (e[1] === 2 && !places(e).length) body.push(el('p', { class: 'warn', text: 'Not on a control yet: choose where to change it.' }));
  if (kind) {
    body.push(el('div', { class: 'inspector-actions' },
      el('button', { type: 'button', class: 'quiet', id: 'choose-feature', onclick: () => openLibrary({ kind, slot }) }, 'Choose another feature'),
      el('button', { type: 'button', class: 'quiet', id: 'clear-position', onclick: () => { clear(kind, slot); focusSelection(); } }, kind === 'action' ? 'Remove gesture' : 'Empty this position')));
  }
  $('inspector').replaceChildren(...body);
}

// Choosing "Change on the module" puts the feature on the first free control.
function setState(f, state) {
  commit(() => {
    let next = edit(entries, profile(), f, 1, state);
    const e = entryOf(next, f);
    if (state === 2 && !places(e).length) {
      const kind = ['page', 'amount', 'action'].find((k) => fits(f, k) && freeSlot(next, k));
      if (kind) next = edit(next, profile(), f, KINDS[kind].index, freeSlot(next, kind));
    }
    return next;
  });
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
  const groups = GROUPS.map(([name, ids]) => {
    const items = ids.map(featureById).filter((f) => f && (!target || fits(f, target.kind)))
      .filter((f) => !query || `${f.name} ${featureHelp(f, selected()).description}`.toLowerCase().includes(query))
      .map((f) => {
        const e = entryOf(entries, f);
        const at = places(e).length ? 'On ' + places(e).map((p) => placeName(p.kind, p.slot)).join(', ') : `No control · ${summary(f, e)}`;
        return el('button', { type: 'button', class: `library-item${here && here[0] === f.id ? ' here' : ''}`, id: `lib-${f.id}`,
          'aria-describedby': `lib-${f.id}-about`, onclick: () => pick(f.id) },
        el('span', { class: 'name', text: f.name }), el('span', { class: 'at', text: at }),
        el('span', { class: 'about', id: `lib-${f.id}-about`, text: featureHelp(f, selected()).description }));
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
  renderPresets(); renderGrid(); renderSlots(); renderExtras(); renderInspector(); markTemplateChanges();
  renderScales(selected().profile.version === 2);
  if (focused && document.activeElement === document.body) $(focused)?.focus({ preventScroll: true });
  refresh();
}

async function refresh() {
  const token = ++revision;
  $('result').hidden = true;
  const release = selected();
  const block = encodeProfile(entries, release.profile, scales);
  if (drafts.save(release, block, preset, Date.now(), manifest.releases.at(-1)) === 'failed' && !notice.failed) {
    notice.failed = true;
    notice.dismissed = false;
    renderNotice();
  }
  $('build').disabled = $('local').disabled = busy;
  const changed = changes(entries, templates(release.profile)[preset] || defaults(release.profile), release.profile).length + Number(scales !== null);
  $('changes').textContent = changed ? `${changed} change${changed === 1 ? '' : 's'} from ${preset}` : `${preset}, unchanged`;
  const used = Array.from({ length: 12 }, (_, i) => occupant(entries, 'page', i + 1)).filter(Boolean).length;
  $('positions').textContent = `${used} of 12 page positions used`;
  const fp = await fingerprint(block);
  if (token !== revision) return;
  $('fingerprint').textContent = fp;
  $('share').href = '#' + share(release, block);
  $('share').onclick = () => { history.replaceState(null, '', $('share').href); status('Copy this address to share.'); };
  await updateGuides(release, entries, fp, filenames(release, fp,
      equal(block, encodeProfile(defaults(release.profile), release.profile))));
  if (token === revision) $('summary').dataset.fingerprint = fp;
}

let pendingShare = false;
function loadSharedProfile() {
  try {
    const shared = location.hash ? unshare(location.hash, manifest.releases) :
      { release: selected(), entries: defaults(selected().profile) };
    const chosen = normalise(shared.entries, shared.release.profile);
    $('release').value = shared.release.tag;
    entries = chosen;
    scales = shared.scales ?? null;
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
  notice.linked = own !== null && describe(own).fragment !== null && params(describe(own).fragment) !== params(location.hash);
  notice.restored = notice.undo = null;
  notice.dismissed = false;
  renderNotice();
}

function show(draft) {
  $('release').value = draft.release.tag;
  entries = draft.entries;
  scales = draft.scales;
  preset = draft.preset;
  notice.restored = draft;
  drafts.settled(draft.link);
}

// A draft this page cannot open is kept aside, never deleted; if it cannot be, saving pauses.
function refuse(key, raw) {
  if (setAside(storage, key, raw) || held) return;
  held = key;
  drafts.pause();
}

function restoreDraft() {
  const draft = storage && readDraft(storage, manifest.releases);
  if (draft?.refused) refuse(DRAFT, draft.raw);
  else if (draft) show(draft);
}

const focusStart = () => $('presets').querySelector('button')?.focus();

function startFresh() {
  notice.undo = { tag: selected().tag, entries, scales, preset, raw: saved(DRAFT), link: notice.restored?.link ?? false };
  notice.restored = null;
  notice.linked = false;
  $('release').selectedIndex = manifest.releases.length - 1;
  entries = defaults(selected().profile);
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
  const { tag, raw, link, ...previous } = notice.undo;
  notice.undo = null;
  $('release').value = tag;
  ({ entries, scales, preset } = previous);
  if (raw !== null) put(storage, DRAFT, raw);
  drafts.settled(link);
  status('Previous setup back.');
  setupEditor();
  renderNotice();
  focusStart();
}

// Opens a saved setup: the draft while a link is unedited, or the second slot, swapped
// with the draft so neither is lost.
function openSaved(key) {
  const draft = storage && readDraft(storage, manifest.releases, key);
  if (!draft) { status('That setup is no longer saved in this browser.', 'error'); renderNotice(); return; }
  if (draft.refused) { refuse(key, draft.raw); notice.linked = false; renderNotice(); return; }
  if (key === BEFORE_LINK) {
    const current = saved(DRAFT);
    if (!put(storage, DRAFT, draft.raw)) { status('Could not switch saved setups in this browser.', 'error'); return; }
    if (!put(storage, BEFORE_LINK, current)) {
      put(storage, DRAFT, current);
      status('Could not switch saved setups in this browser.', 'error');
      return;
    }    if (held === DRAFT) held = BEFORE_LINK;
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
  held = null;
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
  } else if (saved(BEFORE_LINK) !== null && held !== BEFORE_LINK) {
    lines.push(['Another saved setup is also kept.', button('draft-open', 'Open it', () => openSaved(BEFORE_LINK)),
      button('draft-before-discard', 'Discard', () => { put(storage, BEFORE_LINK, null); renderNotice(); focusStart(); })]);
  }
  if (notice.undo) lines.push(['Started fresh.', button('draft-undo', 'Undo', undoFresh)]);
  const refused = [[REFUSED, saved(REFUSED)], [held, held && saved(held)]].filter(([, raw]) => raw);
  refused.forEach(([key, raw], i) => {
    const { name, saved: time, fragment } = describe(raw);
    const about = [name, time !== null ? `saved ${day(time)}` : ''].filter(Boolean).join(', ');
    lines.push([`Your last setup${about ? ` (${about})` : ''} can’t be opened by this page.${key === held ? ' Saving is paused until you discard it.' : ''}`,
      fragment ? button(`draft-copy-${i}`, 'Copy it', () => copyRefused(fragment)) : null,
      button(`draft-discard-${i}`, 'Discard', () => {
        put(storage, key, null);
        if (key === held) { held = null; drafts.pause(false); }
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
    const worker = new Worker('js/worker.js?v=90f5f7a3110f60ee', { type: 'module' });
    const done = (error) => {
      clearTimeout(timer); worker.terminate();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => done(new Error('Builder timed out. Reload or update your browser.')), 10000);
    worker.onmessage = ({ data }) => { if (data.ready) done(); };
    worker.onerror = () => done(new Error('Builder could not load. Reload or update your browser.'));
  });
}

async function init() {
  try {
    await checkCapabilities();
  } catch (error) {
    status(error.message, 'error'); return;
  }
  $('compatibility').hidden = true;
  try {
    const response = await fetch('manifest.json?v=90f5f7a3110f60ee', { cache: 'no-cache' });
    manifest = await response.json();
  } catch {
    status('Could not load the release list.', 'error');
    return;
  }
  if (manifest.format !== 3 || !manifest.releases.length ||
      manifest.releases.some((r) => !r.profile || ![1, 2].includes(r.profile.version) || r.profile.offset !== 1024 || r.profile.size !== (r.profile.version === 2 ? 4096 : 512) ||
        !Number.isInteger(r.profile.format) || r.profile.format < 1 || r.profile.format > 0xffffffff)) {
    status('Unsupported release list.', 'error'); return;
  }
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
  if (location.hash) loadSharedProfile();
  else restoreDraft();
  window.addEventListener('hashchange', () => {
    if (busy) pendingShare = true;
    else loadSharedProfile();
  });
  $('release').onchange = () => { templatePreview = null; $('template-gallery').hidden = true; entries = defaults(selected().profile); scales = null; preset = 'Drizzlet'; edited(); setupEditor(); };
  $('forget-draft').onclick = forgetSaved;
  setupEditor();
  renderNotice();
  $('build').onclick = () => run(fetchApp);
  $('local').onchange = () => {
    const file = $('local').files[0];
    if (file) run(async (release) => {
      if (file.size !== release.app_size) {
        throw new Error(`the app image must be ${release.app_size} bytes for ${release.tag}`);
      }
      return new Uint8Array(await file.arrayBuffer());
    });
  };
}

init();
