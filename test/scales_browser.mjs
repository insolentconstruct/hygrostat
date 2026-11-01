// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
import { importedCost } from '../tools/import-costs.js';
const base = process.env.BASE || 'http://127.0.0.1:8080/';
const site = process.env.SITE || '/site';
const until = async (test) => { for (let i = 0; i < 100; ++i) { if (await test()) return; await new Promise((done) => setTimeout(done, 100)); } throw new Error('Timed out waiting for editor.'); };
const manifest = JSON.parse(readFileSync(`${site}/manifest.json`));
const release = manifest.releases[0];
// Exercise the pending V2 editor without inventing or offering a firmware image.
release.profile.version = 2; release.profile.size = 4096;
release.profile.features.find((f) => f.id === 1).values = Array.from({ length: 16 }, (_, i) => `Scale ${i}`);
const tail = { id: 24, name: 'Synth reverb tail', values: ['Keep (stock)', 'Clear'], states: ['Off', 'Fixed'],
  field: null, page: false, amount: false, action: false, stateless: false, synth_path: true,
  default_in_block: false, default: [24, 0, 0, 0, 0, 0] };
tail.cpu = importedCost(tail);
release.profile.features = release.profile.features.filter((f) => f.id !== 24);
release.profile.features.push(tail);
manifest.releases = [release];
const { unshare } = await import(pathToFileURL(resolve(site, 'js/profile.js')).href);
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort('internetdisconnected');
      if (url.pathname.endsWith('/manifest.json')) return route.fulfill({ json: manifest });
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base);
    await until(async () => await page.isVisible('#scale-editor') && await page.getAttribute('#summary', 'data-fingerprint'));
    const bank = async () => unshare(await page.getAttribute('#share', 'href'), [release]).scales;
    const startingFP = await page.textContent('#fingerprint');
    assert.equal(await page.inputValue('#extra-24'), '0');
    assert.deepEqual(await page.locator('#extra-24 option').allTextContents(), ['Keep (stock)', 'Clear']);
    assert.equal(await page.locator('#extra-24-place').count(), 0, 'event-only setting has no page placement');
    await page.selectOption('#extra-24', '1');
    await until(async () => unshare(await page.getAttribute('#share', 'href'), [release]).entries.some((e) => e[0] === 24 && e[1] === 1 && e[2] === 1));
    assert(!/not measured/.test(await page.textContent('#cpu-short')));
    await page.click('#browse');
    await page.click('#lib-24');
    assert.equal(await page.textContent('#inspector-title'), 'Synth reverb tail');
    assert.equal(await page.locator('#state-2').count(), 0);
    assert.equal(await page.locator('#where-page').count(), 0);
    assert((await page.getAttribute('#inspector a', 'href')).endsWith('#synth-reverb-tail'));
    await page.selectOption('#extra-24', '0');
    await until(async () => await page.textContent('#fingerprint') === startingFP);
    assert(!unshare(await page.getAttribute('#share', 'href'), [release]).entries.some((e) => e[0] === 24));
    assert.equal(await bank(), null);
    assert.equal(await page.locator('.scale-list li').count(), 8);
    await page.getByRole('button', { name: 'Move Major up', exact: true }).click();
    await until(async () => await page.locator('.scale-list button').first().textContent() === 'Major' && (await bank())?.[0]?.id === 3);
    assert.deepEqual((await bank()).map((s) => s.id).slice(0, 2), [3, 2]);
    await page.getByRole('button', { name: 'Add scale', exact: true }).click();
    await page.fill('#scale-name', '<Custom & scale>');
    await page.fill('#scale-repeat', '1901.955');
    await page.fill('#scale-notes', '0, 300, 701.955');
    await page.fill('#scale-color', '#123456');
    await page.selectOption('#scale-pulses', '2');
    await page.getByRole('button', { name: 'Apply scale', exact: true }).click();
    await until(async () => (await bank())?.some((s) => s.name === '<Custom & scale>'));
    const edited = (await bank()).find((s) => s.name === '<Custom & scale>');
    assert(edited); assert.equal(edited.id, 10); assert.deepEqual(edited.color, [18, 52, 86]); assert.equal(edited.pulses, 2);
    assert.equal(edited.notes.length, 3);
    assert.match(await page.textContent('#cpu-short'), /not measured/);
    const shared = await page.getAttribute('#share', 'href');
    await page.reload();
    await until(async () => await page.getAttribute('#summary', 'data-fingerprint'));
    // The hash changes only when the user follows the share link.
    await page.goto(base + shared);
    await until(async () => (await bank())?.some((s) => s.name === '<Custom & scale>'));
    assert.deepEqual((await bank()).find((s) => s.id === 10), edited);
    await page.getByRole('button', { name: 'Remove <Custom & scale>', exact: true }).click();
    assert(!(await bank()).some((s) => s.id === 10));
    await page.setInputFiles('#scale-import', { name: 'example.scl', mimeType: 'text/plain', buffer: Buffer.from('Invalid Scala') });
    await until(async () => (await page.textContent('#scale-error')).includes('Invalid Scala'));
    assert.equal(await page.inputValue('#scale-import'), '', 'failed import clears the file selection for retry');
    // Retry the same filename; a delayed read must preserve concurrent edits.
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = async function() {
        const text = await original.call(this);
        await new Promise((done) => { window.finishScaleRead = done; });
        return text;
      };
    });
    await page.setInputFiles('#scale-import', { name: 'example.scl', mimeType: 'text/plain', buffer: Buffer.from('Imported scale\n3\n400.0\n3/2\n2/1\n') });
    await until(async () => await page.evaluate(() => typeof window.finishScaleRead === 'function'));
    await page.getByRole('button', { name: 'Remove Fifths', exact: true }).click();
    await page.evaluate(() => window.finishScaleRead());
    await until(async () => (await bank())?.some((s) => s.name === 'Imported scale'));
    assert.equal((await bank()).find((s) => s.name === 'Imported scale').id, 2);
    assert(!(await bank()).some((s) => s.name === 'Fifths'));
    await page.fill('#scale-notes', '0 700 700');
    await page.getByRole('button', { name: 'Apply scale', exact: true }).click();
    assert.match(await page.textContent('#status'), /increase/);
    assert.equal((await bank()).find((s) => s.name === 'Imported scale').notes.length, 3);
    assert.match(await page.textContent('#scale-error'), /increase/);
    // A template restores its factory bank even after its named scale was removed.
    await page.click('#cell-1');
    await page.check('#state-1');
    await page.selectOption('#value', '6');
    await page.getByRole('button', { name: 'Remove Pentatonic minor', exact: true }).click();
    assert.equal(await page.inputValue('#value'), '0', 'removed fixed scale displays Off');
    await page.click('#more-templates');
    await page.click('#template-pitched-grains');
    assert.match(await page.textContent('#template-changes'), /factory scale bank/);
    await page.click('#use-template');
    await until(async () => (await bank()) === null);
    assert.equal(unshare(await page.getAttribute('#share', 'href'), [release]).entries.find((e) => e[0] === 1)[2], 6);
    for (const scaleName of ['Fifths', 'Major', 'Minor', 'Pentatonic major', 'Pentatonic minor', 'Pelog', 'Raag Bhairav', 'Raag Shri']) {
      await page.getByRole('button', { name: `Remove ${scaleName}`, exact: true }).click();
    }
    await until(async () => (await bank())?.length === 0);
    await page.click('#more-templates');
    await page.click('#template-pitched-grains');
    await page.click('#use-template');
    await until(async () => (await bank()) === null);
    assert.equal(unshare(await page.getAttribute('#share', 'href'), [release]).entries.find((e) => e[0] === 1)[2], 6);
    await page.getByRole('button', { name: 'Add scale', exact: true }).click();
    await page.getByRole('button', { name: 'Restore factory scales', exact: true }).click();
    assert.equal(await bank(), null);
    assert.equal(await page.locator('.scale-list li').count(), 8);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${name}: V2 scale edit, stable reorder, import, invalid edits, shares and restore; no firmware built.`);
  } finally { await browser.close(); }
}
