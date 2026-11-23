// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// See http://creativecommons.org/licenses/MIT/ for more information.
//
// Regression cases for portable selections and firmware stock banks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';
import { crc32, defaults, encodeProfile, share } from '../static/js/profile.js';
import { writeRegion } from '../static/js/region.js';
import { draftText, DRAFT, BEFORE_LINK, REFUSED } from '../static/js/draft.js';
import { encodeContent } from '../static/js/content.js';
import { stockBanks, lockSynth } from '../static/js/palette.js';
import { factoryTable } from '../static/js/wavetables.js';
const base = process.env.BASE || 'http://127.0.0.1:8080/';
const manifest = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url)));
const release = structuredClone(manifest.releases.at(-1));
release.tag = 'synthetic-palette';
release.profile.region = { profile_version: 3, release: 20261121, services_version: 2 };
const assets = new Map();
const asset = (name, bytes) => {
  const url = `images/synthetic/${name}`;
  assets.set('/' + url, Buffer.from(bytes));
  return { url, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const ids = [...Array.from({ length: 24 }, (_, i) => i), 43];
const models = ids.map((id) => {
  const bytes = new Uint8Array(256);
  const view = new DataView(bytes.buffer);
  [0x424d5a44, 96, 2, 2, 1, id, 1, 256, 64, 0, 0x61, 0x79, 0x7d, 252, 0, 0, 0, 0,
    0x3f6e147b, 0x3f6e147b, 0, 0, 0, 0].forEach((v, i) => view.setUint32(i * 4, v, true));
  view.setUint32(252, crc32(bytes.subarray(0, 252)), true);
  return bytes;
});
const written = writeRegion({ release: 20261121, wave: factoryTable(), blobs: models });
release.content = { models: models.map((bytes, index) => ({ id: ids[index], name: `Model ${ids[index]}`, bytes: bytes.length, module_rows: true, ...asset(`model${ids[index]}`, bytes) })),
  libraries: [], region: asset('region', written.region) };
release.profile.region.default_layout = written.directory.map((e) => ({ ...e, kind: e.kind === 0x45564157 ? 'WAVE' : 'PLTS', sha256: createHash('sha256').update(written.region.subarray(e.offset, e.offset + e.size)).digest('hex') }));
const selection = { wave: true, rings: false, models: [0, 1], banks: [Array(8).fill(0)] };
const block = encodeProfile(defaults(release.profile), release.profile, null, { banks: selection.banks, directory: written.directory });
const fragment = share(release, block, { selection, content: null });
const until = async (test) => {
  for (let i = 0; i < 150; ++i) { if (await test()) return; await new Promise((done) => setTimeout(done, 100)); }
  throw new Error('Timed out waiting for palette.');
};
let failures = 0;
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await engine.launch();
  const check = async (label, run) => {
    const context = await browser.newContext();
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname.endsWith('/manifest.json')) return route.fulfill({ json: { ...manifest, releases: [release] } });
      if (assets.has(url.pathname)) return route.fulfill({ body: assets.get(url.pathname), contentType: 'application/octet-stream' });
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    try { await run(page); console.log(`PASS ${name}: ${label}`); }
    catch (error) { ++failures; console.error(`FAIL ${name}: ${label}: ${error.message}`); }
    finally { await context.close(); }
  };
  try {
    await check('Beads-only selection encodes', async (page) => {
      await page.goto(base + '#' + fragment);
      await until(async () => await page.locator('#build').isEnabled());
      for (let slot = 1; slot <= 8; ++slot) await page.getByLabel(`Bank 1, slot ${slot}`, { exact: true }).selectOption('1');
      await page.getByLabel(/^Model 0 —/).uncheck();
      await page.getByLabel(/^Model 1 —/).uncheck();
      await until(async () => await page.locator('#build').isEnabled());
      assert.match(await page.textContent('#palette-status'), /locked to Beads/);
      assert.doesNotThrow(() => encodeProfile(lockSynth(defaults(release.profile), { wave: true, models: [] }), release.profile));
    });
    await check('null shared content ignores local terrains', async (page) => {
      const content = encodeContent({ terrains: [{ equation: null, grid: new Int8Array(4096) }] });
      await page.addInitScript((raw) => localStorage.setItem('hygrostat-content', raw), content);
      await page.goto(base + '#' + fragment);
      await until(async () => await page.locator('#build').isEnabled());
      assert.doesNotMatch(await page.textContent('#flash-meter'), /TERR:/);
    });
    await check('empty legacy directory restores default layout and extra bank models', async (page) => {
      const legacy = encodeProfile(defaults(release.profile), release.profile, null, { banks: [Array(8).fill(43)], directory: [] });
      await page.goto(base + '#' + share(release, legacy));
      await until(async () => await page.locator('#build').isEnabled());
      assert(await page.getByLabel('Beads wavetables (WAVE)', { exact: true }).isChecked());
      assert(await page.getByLabel(/^Model 0 —/).isChecked());
      assert(await page.getByLabel(/^Model 43 —/).isChecked());
    });
    await check('legacy custom directory never guesses installed models', async (page) => {
      await page.goto(base + '#' + fragment);
      await until(async () => await page.locator('#build').isEnabled());
      await page.evaluate((hash) => { location.hash = hash; }, share(release, block));
      await until(async () => (await page.textContent('#status')).includes('installed models'));
      assert(await page.getByLabel(/^Model 1 —/).isChecked());
    });
    await check('portable editor content with default selection reopens', async (page) => {
      const content = encodeContent({ terrains: [{ equation: null, grid: new Int8Array(4096) }] });
      await page.goto(base + '#' + share(release, block, { selection: null, content }));
      await until(async () => await page.locator('#build').isEnabled());
      assert.match(await page.textContent('#flash-meter'), /TERR:/);
      assert(await page.getByLabel(/^Model 0 —/).isChecked());
    });
    await check('legacy draft refusal keeps startup and recovery usable', async (page) => {
      const raw = draftText(release, block, 'Drizzlet', 42);
      await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: DRAFT, value: raw });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base);
      await until(async () => await page.locator('#build').isEnabled());
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), REFUSED), raw);
      assert.match(await page.textContent('#draft-notice'), /can’t be opened/);
      await page.click('#forget-draft');
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), REFUSED), null);
      assert.deepEqual(errors, []);
    });
    await check('legacy second slot never replaces the current draft', async (page) => {
      const raw = draftText(release, block, 'Drizzlet', 42);
      const current = draftText(release, block, 'Drizzlet', 43, false, { selection, content: null });
      await page.addInitScript(({ own, other, current, raw }) => {
        localStorage.setItem(own, current); localStorage.setItem(other, raw);
      }, { own: DRAFT, other: BEFORE_LINK, current, raw });
      await page.goto(base);
      await until(async () => await page.locator('#build').isEnabled());
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), DRAFT), current);
      assert.equal(await page.evaluate((key) => localStorage.getItem(key), REFUSED), raw);
      assert.equal(await page.locator('#draft-open').count(), 0);
    });
    await check('stock banks preserve additional selected models', async (page) => {
      const chosen = { ...selection, models: [...selection.models, 43] };
      await page.goto(base + '#' + share(release, block, { selection: chosen, content: null }));
      await until(async () => await page.locator('#build').isEnabled());
      await page.getByRole('button', { name: 'Stock banks', exact: true }).click();
      await until(async () => await page.locator('#build').isEnabled());
      assert(await page.getByLabel(/^Model 43 —/).isChecked());
      assert.equal(await page.getByLabel('Bank 1, slot 1', { exact: true }).inputValue(), '8');
      assert.deepEqual(stockBanks().map((b) => b[0]), [8, 16, 0]);
    });
  } finally { await browser.close(); }
}
assert.equal(failures, 0);
