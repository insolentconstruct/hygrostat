// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Beta 3 profile-only options (25-30) on a synthetic release; no firmware image is built or offered.
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
const manifest = JSON.parse(readFileSync(`${site}/manifest.json`));
const release = manifest.releases[0];
release.profile.features.push(...additions);
manifest.releases = [release];
const { unshare } = await import(pathToFileURL(resolve(site, 'js/profile.js')).href);
const { featureHelp } = await import(pathToFileURL(resolve(site, 'js/help.js')).href);
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
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${name}: Beta 3 options 25-30 render, encode Fixed values, return to Off and link their documentation; no firmware built.`);
  } finally { await browser.close(); }
}
