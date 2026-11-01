// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:8080/';
const site = process.env.SITE || '/site';
const until = async (test) => { for (let i = 0; i < 100; ++i) { if (await test()) return; await new Promise((done) => setTimeout(done, 100)); } throw new Error('Timed out waiting for editor.'); };
const manifest = JSON.parse(readFileSync(`${site}/manifest.json`));
const release = manifest.releases[0];
// Exercise the pending V2 editor without inventing or offering a firmware image.
release.profile.version = 2; release.profile.size = 4096;
release.profile.features.find((f) => f.id === 1).values = Array.from({ length: 16 }, (_, i) => `Scale ${i}`);
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
    // A delayed file read must preserve edits made while import is pending.
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = async function() {
        const text = await original.call(this);
        await new Promise((done) => { window.finishScaleRead = done; });
        return text;
      };
    });
    await page.setInputFiles('#scale-import', { name: 'example.scl', mimeType: 'text/plain', buffer: Buffer.from('Imported scale\n3\n400.0\n3/2\n2/1\n') });
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
