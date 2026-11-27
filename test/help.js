// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
import assert from 'node:assert/strict';
import { firmwareRef, firmwareShow } from './firmware.js';
import { readFileSync } from 'node:fs';
import { featureHelp, actionHelp } from '../static/js/help.js';
import { guide } from '../static/js/guide.js';
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../static/manifest.json'));
for (const release of manifest.releases) {
  const docs = firmwareShow(firmwareRef(release), 'beads/build/docs/FEATURES.md', { encoding: 'utf8' });
  const headings = [...docs.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-'));

  for (const feature of release.profile.features) {
    const help = featureHelp(feature, release);
    assert(help.description.length > 15 && help.description.length < 180, feature.name);
    assert(!help.description.includes('\n'), 'one line of plain language');
    const url = new URL(help.url);
    assert.equal(url.origin, 'https://github.com');
    assert.equal(url.pathname, `/insolentconstruct/eurorack/blob/${release.development ? release.source_commit : release.tag}/beads/build/docs/FEATURES.md`);
    assert(headings.includes(url.hash.slice(1)), `${feature.name}: real FEATURES.md section`);
    const tagged = { ...release, development: false, tag: 'drizzlet-2026.11.05' };
    const development = { ...release, development: true, source_commit: '6729648eb582351c548cab343f6cefdf21a14c6b' };
    assert(featureHelp(feature, tagged).url.includes('/blob/drizzlet-2026.11.05/'));
    assert(featureHelp(feature, development).url.includes(`/blob/${development.source_commit}/`));
    assert(!featureHelp(feature, { ...tagged, source_commit: development.source_commit }).url.includes(development.source_commit));
  }
}
assert.match(actionHelp({ id: 13 }), /gesture switches it.*no page knob/);
assert.match(actionHelp({ id: 13 }), /Always.*no gesture/);
assert.match(actionHelp({ id: 14 }), /Always On or Change on the module.*gesture/);
assert.match(actionHelp({ id: 9 }), /Manual.*gesture/);
assert.equal(actionHelp({ id: 18 }), '');
assert.match(featureHelp({ id: 16 }, manifest.releases[0]).description, /automatic gain unchanged/);
assert.match(featureHelp({ id: 22 }, manifest.releases[0]).description, /ignoring CV/);
assert.match(featureHelp({ id: 23 }, manifest.releases[0]).description, /granular.*TIME CV is unplugged/);
assert.match(featureHelp({ id: 1 }, manifest.releases[0]).description, /final pitch.*PITCH, CV and randomness/);
const pitchSteps = featureHelp({ id: 10 }, manifest.releases[0]);
assert.match(featureHelp({ id: 2 }, manifest.releases[0]).description, /reverb character; REVERB.*amount during play/);
assert.match(featureHelp({ id: 3 }, manifest.releases[0]).description, /automatic delay, disable it, or widen/);
assert.match(featureHelp({ id: 6 }, manifest.releases[0]).description, /FEEDBACK.*wet feedback loop.*recording stays unchanged/);
assert.match(pitchSteps.description, /CCW.*relative.*CW.*before Pitch scale/);
assert.match(pitchSteps.details, /C and G.*G below C \(a fourth down\).*afterwards/);
assert.match(pitchSteps.details, /granular and Beads wavetable grains, not the continuous oscillator, Plaits or Spectral/);
assert.equal(manifest.releases[0].profile.features.find((f) => f.id === 10).name, 'Random pitch steps');
const beta4 = JSON.parse(read('../static/images/beta4-catalogue/index.json'));
const processor = beta4.profile.features.find((f) => f.id === 4);
assert.match(actionHelp(processor, beta4.profile), /Switch between Granular and Spectral/);
assert.equal(actionHelp({ ...processor, action: false }, beta4.profile), '');
const expandedProcessor = { ...processor, values: [...processor.values, 'Oliverb', 'Abyss'] };
const unknownAction = { id: 254, name: 'Future action', action: true, values: ['One', 'Two'] };
const features = [expandedProcessor, unknownAction, ...beta4.profile.features.filter((f) => f.id !== 4)];
for (const capability of [undefined, false, 'true', true]) {
  const profile = { ...beta4.profile, features, processor_spectral_toggle: capability };
  const release = { tag: 'synthetic-processor', profile };
  const help = actionHelp(expandedProcessor, profile);
  if (capability === true) {
    assert.match(help, /Switch to Spectral from Granular, Oliverb or Abyss.*return to the previous engine/);
    assert.match(help, /After booting into Spectral, return to Granular. Each selection saves/);
    assert.match(help, /Switching between Granular and Spectral clears the recording/);
    assert.match(help, /steady yellow, Granular green, Oliverb red and Abyss slow blinking red/);
    assert.match(help, /flashes red twice.*FREEZE is held or active, options are open or saving, calibration or service is active, or an engine change is settling/);
    assert.doesNotMatch(help, /page slot/);
  } else {
    assert.match(help, /With a Processor page slot, Granular switches to Spectral and any other engine switches to Granular/);
    assert.match(help, /Without a page slot, cycle through Granular → Spectral → Oliverb → Abyss → Granular/);
    assert.doesNotMatch(help, /previous engine/);
  }
  assert.match(help, /During Plaits or Rings play, \[A\]\+FREEZE .*steps the Plaits bank or Rings polyphony/);
  for (const mobile of [false, true]) {
    for (const slot of [1, 2]) {
      const entries = [[4, 2, 0, 0, 0, slot], [254, 2, 0, 0, 0, 3 - slot], [253, 2, 0, 0, 0, 3]];
      const svg = guide(entries, release, 'processor', mobile);
      const text = [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((m) => m[1]).join(' ');
      const chord = slot === 1 ? '[A]+SEED' : '[A]+FREEZE';
      assert(text.includes(`${chord}: Processor. ${help}`));
      assert.match(text, /Future action. No description available/);
      assert.match(text, /Unknown action. No description available/);
      assert.doesNotMatch(text, /fresh recording window|Switch One \/ Two/);
    }
  }
}
assert(manifest.releases.slice(0, 2).every((release) => release.profile.processor_spectral_toggle !== true));
const beta4Docs = firmwareShow(beta4.source_commit, 'beads/build/docs/FEATURES.md', { encoding: 'utf8' });
for (const [id, heading] of [[34, 'Grain stealing'], [35, 'Delay feedback'], [36, 'Delay time']]) {
  const feature = beta4.profile.features.find((f) => f.id === id);
  assert(beta4Docs.split('\n').includes(`### ${heading}`));
  const help = featureHelp(feature, { ...beta4, development: true });
  const anchor = heading.toLowerCase().replaceAll(' ', '-');
  assert(help.url.endsWith(`/blob/${beta4.source_commit}/beads/build/docs/FEATURES.md#${anchor}`));
}
const warnings = [];
const warn = console.warn;
try {
  console.warn = (message) => warnings.push(message);
  const unknown = { id: 254 };
  const fallback = { description: 'No description available.', details: '', url: null };
  assert.deepEqual(featureHelp(unknown, manifest.releases[0]), fallback);
  assert.deepEqual(featureHelp(unknown, manifest.releases.at(-1)), fallback);
  assert.deepEqual(featureHelp({ id: 255 }, manifest.releases[0]), fallback);
  assert.deepEqual(warnings, ['Missing editor help for feature ID 254.', 'Missing editor help for feature ID 255.']);
} finally {
  console.warn = warn;
}

const app = read('../static/js/app.js');
assert(app.includes('featureHelp(f, selected())') && app.includes('href: help.url'));
assert(app.includes('actionHelp(f, selected().profile)') && app.includes('text: gestureHelp'));
const layout = read('../static/js/layout.js');
for (const text of ["'Use stock behaviour'", "'Always use this value'", "'Change on the module'", "'No diffusion'", "'No limiter'"]) assert(layout.includes(text), text);
console.log('PASS feature descriptions, real documentation anchors, release-tag resolution and action-only help');
