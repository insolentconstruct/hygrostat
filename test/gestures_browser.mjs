// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Beta 4 [A] toggles and the [A] + FEEDBACK slot (#301) on a synthetic release; no firmware image is built or offered.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:8080/';
const site = process.env.SITE || '/site';
const until = async (test) => { for (let i = 0; i < 100; ++i) { if (await test()) return; await new Promise((done) => setTimeout(done, 100)); } throw new Error('Timed out waiting for editor.'); };
const manifest = JSON.parse(readFileSync(`${site}/manifest.json`));
const release = manifest.releases.find((r) => r.slug === 'beta-3-smirr');
for (const f of release.profile.features) if ([2, 4, 6, 7, 23].includes(f.id)) f.action = true;
release.profile.features.push(...JSON.parse(readFileSync(new URL('fixtures/gesture-features.json', import.meta.url))));
Object.assign(release.profile, { hold_rules: true, feedback_slot: true });
manifest.releases = [release];
const { unshare } = await import(pathToFileURL(resolve(site, 'js/profile.js')).href);
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const spectralManifest = structuredClone(manifest);
    spectralManifest.releases[0].profile.processor_spectral_toggle = true;
    let offeredManifest = manifest;
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort('internetdisconnected');
      if (url.pathname.endsWith('/manifest.json')) return route.fulfill({ json: offeredManifest });
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base);
    await until(async () => await page.getAttribute('#summary', 'data-fingerprint'));
    const entries = async () => unshare(await page.getAttribute('#share', 'href'), [release]).entries;
    // Three amount slots; the factory gain is on FEEDBACK and needs no new firmware.
    assert.equal(await page.locator('#amounts .slot').count(), 3);
    assert.equal(await page.getAttribute('#amount-3', 'aria-label'), '[A] + FEEDBACK: Manual gain knob, input gain');
    assert.equal(await page.isHidden('#gesture-firmware'), true);
    assert.equal(await page.locator('#extra-40').count(), 0, 'the gain knob is not an Extra');
    // Off the knobs: FEEDBACK empties, and the profile needs Beta 4.
    await page.click('#amount-3');
    assert.deepEqual(await Promise.all([0, 1, 2].map((s) => page.locator(`#state-${s}`).count())), [0, 1, 1]);
    assert.equal(await page.isChecked('#state-2'), true);
    assert.equal(await page.locator('#value').count(), 0);
    await page.click('#state-1');
    await until(async () => (await entries()).some((e) => e.join() === '40,1,0,0,0,0'));
    await until(async () => await page.isVisible('#gesture-firmware'));
    assert.match(await page.textContent('#gesture-firmware'), /Beta 4/);
    assert.match(await page.getAttribute('#amount-3', 'class'), /empty/);
    // Width onto FEEDBACK, then the gain back onto DRY/WET.
    await page.click('#amount-1');
    await page.selectOption('#where-amount', '3');
    await until(async () => (await entries()).some((e) => e.join() === '11,2,0,0,3,0'));
    await page.click('#browse');
    await page.click('#lib-40');
    await page.click('#state-2');
    await until(async () => (await entries()).some((e) => e.join() === '40,2,0,0,1,0'));
    // Processor on [A] + FREEZE replaces buffer trim.
    await page.click('#browse');
    await page.click('#lib-4');
    await page.selectOption('#where-action', '2');
    await page.click('#confirm-replace');
    await until(async () => (await entries()).some((e) => e[0] === 4 && e[5] === 2));
    assert.match(await page.textContent('#action-2'), /Switch processor/);
    assert.match(await page.textContent('#action-help'), /Switch between Granular and Spectral.*clears the recording/);
    assert.equal(await page.locator('#where-action option[value="3"]').count(), 0, 'toggles never take the hold');
    // The Synth toggle is offered [A] + SEED only.
    await page.click('#browse');
    await page.click('#lib-7');
    assert.equal(await page.locator('#where-action option[value="1"]').count(), 1);
    assert.equal(await page.locator('#where-action option[value="2"]').count(), 0);
    assert.equal(await page.isDisabled('#build'), false);
    offeredManifest = spectralManifest;
    await page.reload();
    await until(async () => await page.getAttribute('#summary', 'data-fingerprint'));
    await page.click('#browse');
    await page.click('#lib-4');
    assert.match(await page.textContent('#action-help'), /Switch to Spectral from Granular, Oliverb or Abyss.*return to the previous engine/);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${name}: [A] + FEEDBACK slot, manual gain, width, and release-specific Processor help; no firmware built.`);
  } finally { await browser.close(); }
}
