// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Beta 3 profile-only options (features 25-30) on a synthetic release; no offered release has them yet.
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmwareRepo, firmwareShow } from './firmware.js';
import { validate, encodeProfile, decodeProfile, defaults, share, unshare, cpuUsage, crc32, templates, initialEntry } from '../static/js/profile.js';
import { edit, GROUPS, place, entryOf, placeable, bankWarning } from '../static/js/layout.js';
import { guide } from '../static/js/guide.js';
import { featureHelp } from '../static/js/help.js';
const text = (svg) => [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((m) => m[1]).join(' ');
const read = (file) => readFileSync(new URL(file, import.meta.url));
const manifest = JSON.parse(read('../static/manifest.json'));
const additions = [JSON.parse(read('fixtures/idle-timeout-feature.json')), ...JSON.parse(read('fixtures/beta3-features.json'))];
const ids = additions.map((f) => f.id);
assert.deepEqual(ids, [25, 26, 27, 28, 29, 30]);
const shipped = manifest.releases;
assert(shipped.every((r) => !r.profile.features.some((f) => ids.includes(f.id))), 'no offered release lists features 25-30');

// The catalogue copy matches the prepared firmware byte for byte.
const ref = process.env.BETA3_FIRMWARE_REF || '818eee5560f30a6d85284cd7db44a0664a140c28';
const catalogueBytes = read('fixtures/beta3-profile-features.json');
assert.deepEqual(catalogueBytes, firmwareShow(ref, 'beads/build/profile-features.json'),
  'copy the prepared firmware catalogue verbatim');
const catalogue = JSON.parse(catalogueBytes);
assert.deepEqual(catalogue.features.map((c) => c.id), Array.from({ length: 31 }, (_, i) => i + 1));
// Features 1-24 change only their page range (seven pages in Beta 3).
const current = JSON.parse(read('../static/profile-features.json'));
for (const [i, c] of current.features.entries()) {
  const next = catalogue.features[i];
  for (const key of Object.keys(c)) {
    if (key === 'page_slots') assert.deepEqual(next[key], c[key].length ? Array.from({ length: 21 }, (_, n) => n + 1) : []);
    else assert.deepEqual(next[key], c[key], `${c.name}: ${key}`);
  }
}
// Manifest entries follow the catalogue: Off by default, Fixed values only, no controls.
const docs = firmwareShow(ref, 'beads/build/docs/FEATURES.md', { encoding: 'utf8' });
const headings = [...docs.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s/g, '-'));
for (const f of additions) {
  const c = catalogue.features.find((c) => c.id === f.id);
  assert.equal(f.name, c.name);
  assert.deepEqual(f.values, c.values);
  assert.deepEqual(f.states, c.states);
  assert.deepEqual(f.states, ['Off', 'Fixed']);
  assert.equal(f.field, c.field);
  assert.equal(f.synth_path, c.touches_synth, `${f.name}: synth_path`);
  assert.equal(c.cpu_cost, null);
  assert.deepEqual([c.page_slots, c.amount_slots, c.actions], [[], [], []]);
  assert.deepEqual([f.page, f.amount, f.action, f.stateless, f.default_in_block], [false, false, false, false, false]);
  assert.deepEqual(f.default, [f.id, f.states.indexOf(c.default_state), c.default, 0, 0, 0]);
  assert.deepEqual(f.default, [f.id, 0, 0, 0, 0, 0]);
  if (f.cpu) {
    assert.equal(f.cpu.kind, 'zero');
    assert.match(f.cpu.source, /^synthetic fixture/);
    for (const engine of Object.values(f.cpu.engines)) assert.equal(engine.fixed.length, f.values.length);
  }
  const help = featureHelp(f, { development: true, source_commit: ref });
  assert(help.description.length > 15 && help.description.length < 180, f.name);
  assert(!help.description.includes('\n'));
  assert(headings.includes(new URL(help.url).hash.slice(1)), `${f.name}: real FEATURES.md section`);
}
const grouped = GROUPS.flatMap(([, group]) => group);
for (const id of ids) assert.equal(grouped.filter((g) => g === id).length, 1, `feature ${id} is in one library group`);
assert.deepEqual(additions.find((f) => f.id === 28).values, ['Normal (default)', 'Low', 'High']);
assert.equal(featureHelp({ id: 26 }, shipped[0]).url.split('#')[1], 'delay-seed-latch-fade');
assert.equal(featureHelp({ id: 30 }, shipped[0]).url.split('#')[1], 'pitch-knob');

const beta2 = shipped[0];
const release = structuredClone(beta2);
Object.assign(release, { tag: 'drizzlet-dev-beta3-options', name: 'Synthetic fixture (never offered)',
  development: true, source_commit: '0'.repeat(40) });
release.profile.features.push(...structuredClone(additions));
const entry = (id, state, value) => [id, state, value, 0, 0, 0];
const base = defaults(beta2.profile);
assert.deepEqual(defaults(release.profile), base, 'new options are omitted by default');
assert.deepEqual(encodeProfile(base, release.profile), encodeProfile(base, beta2.profile));

for (const f of additions) {
  // Off and Fixed values only, no controls; Beta 2 refuses the feature.
  for (let value = 0; value < f.values.length; ++value) {
    validate([entry(f.id, 0, value)], release.profile);
    validate([entry(f.id, 1, value)], release.profile);
    assert.throws(() => validate([entry(f.id, 2, value)], release.profile), /not allowed/);
  }
  assert.throws(() => validate([entry(f.id, 1, f.values.length)], release.profile), /not allowed/);
  for (const controls of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    assert.throws(() => validate([[f.id, 1, 1, ...controls]], release.profile), /not allowed/);
  }
  assert.throws(() => validate([entry(f.id, 1, 1)], beta2.profile), /Unknown/);

  // Off or value 0 leaves the entry out; Fixed values encode as listed.
  assert.deepEqual(edit(base, release.profile, f, 1, 0), base);
  for (let value = 1; value < f.values.length; ++value) {
    const fixed = edit(edit(base, release.profile, f, 1, 1), release.profile, f, 2, value);
    assert.deepEqual(fixed, [...base, entry(f.id, 1, value)]);
    const block = encodeProfile(fixed, release.profile);
    assert.deepEqual(Array.from(block.subarray(16 + 6 * base.length, 22 + 6 * base.length)), entry(f.id, 1, value));
    assert.deepEqual(decodeProfile(block, release.profile), fixed);
    assert.deepEqual(unshare(share(release, block), [release]).entries, fixed);
    assert.throws(() => decodeProfile(block, beta2.profile), /Unknown/);
    assert.deepEqual(edit(fixed, release.profile, f, 1, 0), base);
    for (const mobile of [false, true]) {
      assert(text(guide(fixed, release, 'abcd1234', mobile)).includes(`${f.name}: Fixed · ${f.values[value]}`));
    }
  }
  // An explicit Fixed 0 means the same as Off and still round-trips.
  const fixedOff = [...base, entry(f.id, 1, 0)];
  assert.deepEqual(decodeProfile(encodeProfile(fixedOff, release.profile), release.profile), fixedOff);
  for (const mobile of [false, true]) {
    assert(!text(guide([...base, entry(f.id, 0, 0)], release, 'abcd1234', mobile)).includes(`${f.name}:`));
  }
}

// All six together, including each Attack sensitivity value.
for (const sensitivity of [1, 2]) {
  const all = [...base, ...additions.map((f) => entry(f.id, 1, f.id === 28 ? sensitivity : 1))];
  const block = encodeProfile(all, release.profile);
  assert.deepEqual(Array.from(block.subarray(16 + 6 * base.length, 16 + 6 * all.length)), additions.flatMap((f) =>
    entry(f.id, 1, f.id === 28 ? sensitivity : 1)));
  assert.deepEqual(decodeProfile(block, release.profile), all);
  assert.deepEqual(unshare(share(release, block), [release]).entries, all);
  assert.throws(() => unshare(share(release, block), shipped), /another release/);
}

// Inspected power-on options add no cost; per-block ones stay unmeasured.
assert.deepEqual(cpuUsage(base, release).engines, cpuUsage(base, beta2).engines);
for (const id of [25, 27, 29]) {
  assert.deepEqual(cpuUsage([...base, entry(id, 1, 1)], release).engines, cpuUsage(base, beta2).engines);
}
for (const id of [26, 28, 30]) {
  const usage = cpuUsage([...base, entry(id, 1, 1)], release);
  assert.equal(usage.kind, 'not yet measured');
  assert.deepEqual(usage.unknown, [additions.find((f) => f.id === id).name]);
}
console.log(`PASS Beta 3 options 25-30: catalogue bytes at ${ref.slice(0, 7)}, manifest fields, help anchors, Off/Fixed codec, share links and guides`);

// Plaits bank (31): Adjustable only, no destination, in the factory block; its gesture is fixed by the firmware.
const bankFeature = JSON.parse(read('fixtures/plaits-bank-feature.json'));
const c31 = catalogue.features.find((c) => c.id === 31);
assert.deepEqual([bankFeature.name, bankFeature.values, bankFeature.states, bankFeature.field, bankFeature.synth_path],
  [c31.name, c31.values, c31.states, c31.field, c31.touches_synth]);
assert.deepEqual([c31.states, c31.default_state, c31.cpu_cost, c31.page_slots, c31.amount_slots, c31.actions],
  [['Adjustable'], 'Adjustable', null, [], [], []]);
assert.deepEqual(bankFeature.default, [31, 2, c31.default, 0, 0, 0]);
assert.deepEqual([bankFeature.default_in_block, bankFeature.page, bankFeature.amount, bankFeature.action, bankFeature.stateless],
  [true, false, false, false, false]);
assert.equal(placeable(bankFeature), false);
assert.deepEqual([bankFeature.cpu.kind, bankFeature.cpu.uncertainty.points], ['zero', 0]);
assert.match(bankFeature.cpu.source, /^synthetic fixture.*code inspection/);
for (const engine of Object.values(bankFeature.cpu.engines)) {
  assert.deepEqual([engine.off, engine.fixed, engine.adjustable], [0, [0, 0, 0], [0, 0, 0]]);
}
assert(shipped.every((r) => !r.profile.features.some((f) => f.id === 31)), 'no offered release lists feature 31');
const bankHelp = featureHelp(bankFeature, { development: true, source_commit: ref });
assert(bankHelp.description.length > 15 && bankHelp.description.length < 180 && !bankHelp.description.includes('\n'));
assert.equal(new URL(bankHelp.url).hash, '#plaits-bank');
assert(headings.includes('plaits-bank'), 'real FEATURES.md section');
assert.match(bankHelp.details, /hold \[A\] and press FREEZE.*green, red, yellow/);
assert.equal(GROUPS.flatMap(([, group]) => group).filter((id) => id === 31).length, 1, 'Plaits bank is in one library group');

const bank = structuredClone(release);
bank.profile.features.push(structuredClone(bankFeature));
const bankBase = defaults(bank.profile);
assert.deepEqual(bankBase, [...base, [31, 2, 0, 0, 0, 0]]);
assert.deepEqual(initialEntry(bankFeature), [31, 2, 0, 0, 0, 0]);
assert.deepEqual(entryOf(base, bankFeature), [31, 2, 0, 0, 0, 0], 'an omitted entry starts green');
// The factory block is the firmware's, byte for byte: 17 entries, length 0x66, CRC 0x94145a27.
const profileSource = firmwareShow(ref, 'beads/profile.cc', { encoding: 'utf8' });
const firmwareBlock = Uint8Array.from([...profileSource.split('const volatile uint8_t kProfileBlock[kProfileSize]')[1]
  .split('};')[0].matchAll(/0x([0-9a-f]{2})/g)], (m) => parseInt(m[1], 16));
const factory = encodeProfile(bankBase, bank.profile);
assert.deepEqual(factory, firmwareBlock, 'factory profile equals the firmware block');
const header = new DataView(factory.buffer);
assert.deepEqual([factory[5], header.getUint16(6, true), header.getUint32(16 + 6 * 17, true)], [17, 0x66, 0x94145a27]);
assert.deepEqual(Array.from(factory.subarray(16 + 6 * 16, 16 + 6 * 17)), [0x1f, 0x02, 0, 0, 0, 0]);

// Adjustable only: Off and Fixed are refused, and so is every destination.
for (let state = 0; state <= 3; ++state) {
  for (let value = 0; value <= 3; ++value) {
    if (state === 2 && value < 3) validate([[31, 2, value, 0, 0, 0]], bank.profile);
    else assert.throws(() => validate([[31, state, value, 0, 0, 0]], bank.profile), /not allowed/);
  }
}
for (const controls of [[1, 0, 0], [0, 1, 0], [0, 0, 2]]) {
  assert.throws(() => validate([[31, 2, 0, ...controls]], bank.profile), /not allowed/);
}
assert.throws(() => validate([[31, 2, 0, 0, 0, 0]], release.profile), /Unknown/);
assert.throws(() => edit(bankBase, bank.profile, bankFeature, 1, 0), /not allowed/);
validate(base, bank.profile);
for (const chosen of Object.values(templates(bank.profile))) {
  assert.deepEqual(chosen.find((e) => e[0] === 31), [31, 2, 0, 0, 0, 0], 'every starting point keeps the bank');
  encodeProfile(chosen, bank.profile);
}

// Each starting bank encodes in field order, round-trips, shares and prints.
for (let value = 0; value < 3; ++value) {
  const chosen = edit(bankBase, bank.profile, bankFeature, 2, value);
  assert.deepEqual(chosen, [...base, [31, 2, value, 0, 0, 0]]);
  const block = encodeProfile(chosen, bank.profile);
  assert.deepEqual(Array.from(block.subarray(16 + 6 * 16, 22 + 6 * 16)), [31, 2, value, 0, 0, 0]);
  assert.deepEqual(decodeProfile(block, bank.profile), chosen);
  assert.deepEqual(unshare(share(bank, block), [bank]).entries, chosen);
  assert.throws(() => decodeProfile(block, release.profile), /Unknown/);
  assert.deepEqual(cpuUsage(chosen, bank).engines, cpuUsage(base, beta2).engines, 'the starting bank adds no cost');
  for (const mobile of [false, true]) {
    const drawn = text(guide(chosen, bank, 'abcd1234', mobile));
    assert(drawn.includes(`Plaits bank: starts ${bankFeature.values[value]}.`));
    assert(drawn.includes('hold [A] and press FREEZE to step green, red, yellow'));
    assert(!drawn.includes('Plaits bank: Green · set on the page'), 'no placement line');
  }
}

// Synth start on [A] + FREEZE keeps the gesture in Plaits play, so the editor warns but still builds.
assert.equal(bankWarning(bankBase, bank.profile), '', 'factory layout: no warning');
const startOnFreeze = place(bankBase, bank.profile, 9, 'action', 2);
assert.deepEqual(startOnFreeze.find((e) => e[0] === 9)?.[5], 2);
assert.match(bankWarning(startOnFreeze, bank.profile), /^Synth start is on \[A\] \+ FREEZE, so the Plaits bank can’t be changed .*another gesture/);
encodeProfile(startOnFreeze, bank.profile);
assert.equal(bankWarning(place(base, release.profile, 9, 'action', 2), release.profile), '', 'no bank, no warning');
assert.equal(bankWarning(place(startOnFreeze, bank.profile, 9, 'action', 1), bank.profile), '', 'moved away: no warning');
assert.equal(bankWarning(place(bankBase, bank.profile, 13, 'action', 2), bank.profile), '', 'other gestures give way in Plaits play');
assert.equal(bankWarning(edit(startOnFreeze, bank.profile, bank.profile.features.find((f) => f.id === 9), 1, 0), bank.profile), '');
for (const mobile of [false, true]) {
  assert(text(guide(startOnFreeze, bank, 'abcd1234', mobile)).includes(bankWarning(startOnFreeze, bank.profile)));
}

// The firmware's own parser agrees on every bank entry, placement and the factory block.
const reseal = (b) => { const end = 16 + new DataView(b.buffer).getUint16(6, true); new DataView(b.buffer).setUint32(end, crc32(b.subarray(0, end)), true); return b; };
const single = (e) => { const b = encodeProfile([], bank.profile); b[5] = 1; b[6] = 6; b.set(e, 16); return reseal(b); };
const cases = [factory, encodeProfile([], bank.profile), encodeProfile(startOnFreeze, bank.profile)];
for (let state = 0; state <= 3; ++state) for (let value = 0; value <= 3; ++value) cases.push(single([31, state, value, 0, 0, 0]));
for (const [k, count] of [[3, 12], [4, 2], [5, 3]]) {
  for (let slot = 1; slot <= count; ++slot) { const e = [31, 2, 0, 0, 0, 0]; e[k] = slot; cases.push(single(e)); }
}
const scratch = mkdtempSync(join(tmpdir(), 'hygrostat-bank-oracle-'));
try {
  mkdirSync(join(scratch, 'beads/dsp'), { recursive: true });
  for (const file of ['profile.h', 'profile.cc', 'dsp/pitch_quantizer.h']) writeFileSync(join(scratch, 'beads', file), firmwareShow(ref, 'beads/' + file));
  const oracle = join(scratch, 'profile-oracle');
  execFileSync('g++', ['-std=c++98', '-Wall', '-Werror', '-I' + scratch, '-I' + firmwareRepo,
    fileURLToPath(new URL('profile_oracle.cc', import.meta.url)), join(scratch, 'beads/profile.cc'), '-o', oracle]);
  const answers = execFileSync(oracle, [], { input: Buffer.concat(cases.map((b) => Buffer.from(b))) });
  const stride = 493;
  assert.equal(answers.length, cases.length * stride);
  let accepted = 0;
  cases.forEach((b, i) => {
    let decoded = null;
    try { decoded = decodeProfile(b, bank.profile); } catch { /* compared with the firmware below */ }
    assert.equal(Boolean(decoded), answers[i * stride] === 1, `bank firmware case ${i}: ${Array.from(b.subarray(16, 22))}`);
    if (decoded) {
      ++accepted;
      assert.deepEqual(decoded.flat(), Array.from(answers.subarray(i * stride + 1, i * stride + 1 + decoded.length * 6)));
    }
  });
  assert.equal(accepted, 6, 'factory, empty, Synth start on FREEZE and the three banks');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`PASS Plaits bank: catalogue and factory block at ${ref.slice(0, 7)}, Adjustable-only codec, firmware parser, share links, guides and the Synth start warning`);
