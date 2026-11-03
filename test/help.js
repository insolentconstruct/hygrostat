// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
import assert from 'node:assert/strict';
import { firmwareRef, firmwareShow } from './firmware.js';
import { readFileSync } from 'node:fs';
import { featureHelp, actionHelp } from '../static/js/help.js';
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
    assert(featureHelp(feature, tagged).url.includes('/blob/drizzlet-2026.11.05/'));
    assert(!featureHelp(feature, tagged).url.includes(release.source_commit));
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
const app = read('../static/js/app.js');
assert(app.includes('featureHelp(f, selected())') && app.includes('href: help.url'));
assert(app.includes('text: actionHelp(f)'));
const layout = read('../static/js/layout.js');
for (const text of ["'Use stock behaviour'", "'Always use this value'", "'Change on the module'", "'No diffusion'", "'No limiter'"]) assert(layout.includes(text), text);
console.log('PASS feature descriptions, real documentation anchors, release-tag resolution and action-only help');
