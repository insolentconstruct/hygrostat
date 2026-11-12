// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Beta 3 profile-only options (25-30) and the Plaits bank (31) on a synthetic release; no firmware image is built or offered.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:8080/';
const site = process.env.SITE || '/site';
const until = async (test) => { for (let i = 0; i < 100; ++i) { if (await test()) return; await new Promise((done) => setTimeout(done, 100)); } throw new Error('Timed out waiting for editor.'); };
const fixture = (file) => JSON.parse(readFileSync(new URL(`fixtures/${file}`, import.meta.url)));
const additions = [fixture('idle-timeout-feature.json'), ...fixture('beta3-features.json')];
const bank = fixture('plaits-bank-feature.json');
const manifest = JSON.parse(readFileSync(`${site}/manifest.json`));
const release = manifest.releases[0];
release.profile.features.push(...additions, bank);
manifest.releases = [release];
const { unshare } = await import(pathToFileURL(resolve(site, 'js/profile.js')).href);
const { featureHelp } = await import(pathToFileURL(resolve(site, 'js/help.js')).href);
const { bankWarning } = await import(pathToFileURL(resolve(site, 'js/layout.js')).href);
// Value 0 is the stock or default choice, so the menu marks it only when its label does not.
const labels = (f) => f.values.map((v, i) => i === 0 && !/\b(stock|default)\b/i.test(v) ? `${v} (stock)` : v);
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
    await until(async () => await page.getAttribute('#summary', 'data-fingerprint'));
    const entries = async () => unshare(await page.getAttribute('#share', 'href'), [release]).entries;
    const startingFP = await page.textContent('#fingerprint');
    for (const f of additions) {
      assert.equal(await page.inputValue(`#extra-${f.id}`), '0');
      assert.deepEqual(await page.locator(`#extra-${f.id} option`).allTextContents(), labels(f));
      assert.equal(await page.textContent(`#extra-${f.id}-about`), featureHelp(f, release).description);
      assert.equal(await page.locator(`#extra-${f.id}-place`).count(), 0, 'profile-only setting has no page placement');
      for (let value = 1; value < f.values.length; ++value) {
        await page.selectOption(`#extra-${f.id}`, String(value));
        await until(async () => (await entries()).some((e) => e.join() === [f.id, 1, value, 0, 0, 0].join()));
      }
      await page.selectOption(`#extra-${f.id}`, '0');
      await until(async () => await page.textContent('#fingerprint') === startingFP);
      assert(!(await entries()).some((e) => e[0] === f.id), 'Off leaves the entry out');
      await page.click('#browse');
      await page.click(`#lib-${f.id}`);
      assert.equal(await page.textContent('#inspector-title'), f.name);
      assert.equal(await page.locator('#state-2').count(), 0);
      assert.equal(await page.locator('#where-page').count(), 0);
      assert((await page.getAttribute('#inspector a', 'href')).endsWith('#' + new URL(featureHelp(f, release).url).hash.slice(1)));
    }
    assert.deepEqual(await page.locator('#extra-28 option').allTextContents(), ['Normal (default)', 'Low', 'High']);
    assert.equal(await page.isDisabled('#build'), false);

    // Plaits bank: Adjustable only, starts green, chosen in Extras with no placement.
    const bankHelp = featureHelp(bank, release);
    assert.equal(await page.inputValue('#extra-31'), '0');
    assert.deepEqual(await page.locator('#extra-31 option').allTextContents(), bank.values);
    assert.equal(await page.textContent('#extra-31-about'), bankHelp.description);
    assert.equal(await page.locator('#extra-31-place').count(), 0);
    assert(!(await page.textContent('#unplaced')).includes(bank.name), 'the bank is not listed as unplaced');
    assert(await page.isHidden('#bank-warning'), 'factory layout: no warning');
    for (const value of [1, 2, 0]) {
      await page.selectOption('#extra-31', String(value));
      await until(async () => (await entries()).some((e) => e.join() === [31, 2, value, 0, 0, 0].join()));
    }
    await until(async () => await page.textContent('#fingerprint') === startingFP);
    await page.click('#browse');
    await page.click('#lib-31');
    assert.equal(await page.textContent('#inspector-title'), bank.name);
    assert.deepEqual(await Promise.all([0, 1, 2].map((s) => page.locator(`#state-${s}`).count())), [0, 0, 1]);
    assert.equal(await page.isChecked('#state-2'), true);
    assert.equal(await page.locator('#inspector .warn').count(), 0, 'no placement warning');
    assert.equal(await page.textContent('#feature-details'), bankHelp.details);
    for (const where of ['page', 'amount', 'action']) assert.equal(await page.locator(`#where-${where}`).count(), 0);

    // Synth start on [A] + FREEZE: a visible warning, and the build stays available.
    await page.click('#browse');
    await page.click('#lib-9');
    await page.selectOption('#where-action', '2');
    await page.click('#confirm-replace');
    await until(async () => (await entries()).some((e) => e[0] === 9 && e[5] === 2));
    const warning = bankWarning((await entries()), release.profile);
    assert.match(warning, /Synth start is on \[A\] \+ FREEZE/);
    await until(async () => await page.isVisible('#bank-warning'));
    assert.equal(await page.textContent('#bank-warning'), warning);
    assert.equal(await page.textContent('#inspector-bank-warning'), warning);
    assert.equal(await page.isDisabled('#build'), false);
    await page.selectOption('#where-action', '3');
    await until(async () => (await entries()).some((e) => e[0] === 9 && e[5] === 3));
    await until(async () => await page.isHidden('#bank-warning'));
    assert.equal(await page.locator('#inspector-bank-warning').count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${name}: Beta 3 options 25-30 render, encode Fixed values, return to Off and link their documentation; Plaits bank starts and warns; no firmware built.`);
  } finally { await browser.close(); }
}
