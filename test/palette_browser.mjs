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
// Synthetic content and a non-installable app exercise the editor and export.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, firefox, webkit } from 'playwright';
import { crc32, defaults, encodeProfile, share } from '../static/js/profile.js';
import { writeRegion } from '../static/js/region.js';
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
const models = [0, 1].map((id) => {
  const bytes = new Uint8Array(256);
  const view = new DataView(bytes.buffer);
  [0x424d5a44, 96, 2, 2, 1, id, 1, 256, 64, 0, 0x61, 0x79, 0x7d, 252, 0, 0, 0, 0,
    0x3f6e147b, 0x3f6e147b, 0, 0, 0, 0].forEach((v, i) => view.setUint32(i * 4, v, true));
  view.setUint32(252, crc32(bytes.subarray(0, 252)), true);
  return bytes;
});
const written = writeRegion({ release: 20261121, wave: factoryTable(), blobs: models });
release.content = { models: models.map((bytes, id) => ({ id, name: `Model ${id}`, bytes: bytes.length, ...asset(`model${id}`, bytes) })),
  libraries: [], region: asset('region', written.region) };
release.content.model_cpu = { screening_ratio: 1.044, working_limits: { 48000: 96.5, 32000: 97, 24000: 90 } };
release.content.models[0].seed3_peak = { 48000: 95, 32000: 40, 24000: 35 };
release.content.models[1].seed3_peak = { 48000: 50, 24000: 25 };
const app = new Uint8Array(release.profile.offset + release.profile.size);
app.set(encodeProfile(defaults(release.profile), release.profile), release.profile.offset);
const appAsset = asset('app.bin', app);
Object.assign(release, { development: true, app: appAsset.url, app_sha256: appAsset.sha256, app_size: app.length });
const selection = { wave: true, rings: false, models: [0, 1], banks: [[1, 0, 0, 0, 0, 0, 0, 0]] };
const block = encodeProfile(defaults(release.profile), release.profile, null, { banks: selection.banks, directory: written.directory });
const fragment = share(release, block, { selection, content: null });
const until = async (test) => {
  for (let i = 0; i < 150; ++i) { if (await test()) return; await new Promise((done) => setTimeout(done, 100)); }
  throw new Error('Timed out waiting for palette.');
};
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await engine.launch();
  try {
    let offered = release;
    const context = await browser.newContext();
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (url.pathname.endsWith('/manifest.json')) return route.fulfill({ json: { ...manifest, releases: [offered] } });
      if (assets.has(url.pathname)) return route.fulfill({ body: assets.get(url.pathname), contentType: 'application/octet-stream' });
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '#' + fragment);
    await until(async () => await page.locator('#build').isEnabled());
    assert.match(await page.textContent('#flash-meter'), /WAVE: 100396 B/);
    assert.match(await page.locator('.bank-cpu-warning').textContent(), /CPU WARNING: Bank 1 may crackle at 48 kHz/);
    assert.match(await page.locator('#palette-controls').textContent(), /32 kHz · Seed3 peak 40.0% · screened 41.8% · limit 97.0% · incomplete screening/);
    await page.click('#build');
    await page.locator('#download').waitFor({ state: 'visible', timeout: 60000 });
    assert.match(await page.textContent('#download'), /Download WAV/);
    assert(await page.locator('.bank-cpu-warning').isVisible());
    const audioDownload = page.waitForEvent('download');
    await page.click('#download');
    const audio = readFileSync(await (await audioDownload).path());
    assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
    assert.equal(audio.toString('ascii', 8, 12), 'WAVE');
    await page.getByLabel('Beads wavetables (WAVE)', { exact: true }).uncheck();
    await until(async () => (await page.textContent('#palette-status')).includes('locked to Plaits'));
    await page.getByLabel('Beads wavetables (WAVE)', { exact: true }).check();
    await page.getByLabel('Model 0', { exact: false }).click();
    assert.match(await page.textContent('#status'), /replacement/);
    assert(await page.getByLabel('Model 0', { exact: false }).isChecked());
    for (let slot = 1; slot <= 8; ++slot) await page.getByLabel(`Bank 1, slot ${slot}`, { exact: true }).selectOption('1');
    await page.getByLabel('Model 0', { exact: false }).uncheck();
    await until(async () => await page.locator('#build').isEnabled());
    assert.equal(await page.locator('.bank-cpu-warning').count(), 0);
    assert.match(await page.locator('#palette-controls').textContent(), /32 kHz · CPU unmeasured/);
    const link = await page.getAttribute('#share', 'href');
    await page.goto(base + link);
    await until(async () => await page.locator('#build').isEnabled());
    assert.equal(await page.getByLabel('Bank 1, slot 1', { exact: true }).inputValue(), '1');
    const download = page.waitForEvent('download');
    await page.click('#save-profile');
    const file = await download;
    const saved = JSON.parse(readFileSync(await file.path(), 'utf8'));
    assert.equal(saved.v, 1);
    await page.getByLabel('Model 1', { exact: false }).uncheck();
    await until(async () => (await page.textContent('#palette-status')).includes('locked to Beads'));
    assert(await page.getByLabel('Beads wavetables (WAVE)', { exact: true }).isDisabled());
    await page.setInputFiles('#open-profile', { name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await until(async () => await page.locator('#build').isEnabled());
    assert.equal(await page.getByLabel('Bank 1, slot 1', { exact: true }).inputValue(), '1');
    const editor = await context.newPage();
    await editor.goto(base + 'editor.html');
    await editor.fill('#equation', 'sin(theta)');
    await editor.click('#terrain-add');
    await until(async () => (await page.textContent('#flash-meter')).includes('TERR:'));
    await until(async () => page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem('hygrostat-draft'));
      return Boolean(draft && JSON.parse(new URLSearchParams(draft.share).get('setup')).content);
    }));
    await page.reload();
    await until(async () => (await page.textContent('#flash-meter')).includes('TERR:'));
    const content = await editor.evaluate(() => localStorage.getItem('hygrostat-content'));
    await editor.goto(base + 'editor.html#' + new URLSearchParams({ content }));
    await editor.fill('#equation', 'cos(theta)');
    await editor.click('#terrain-add');
    await editor.reload();
    await until(async () => await editor.textContent('#terrain-count') === '2 of 16');
    assert.equal(new URL(editor.url()).hash, '');
    await editor.close();
    offered = { ...release, app_size: 900000 };
    await page.reload();
    await until(async () => (await page.textContent('#flash-meter')).includes('too large'));
    assert(await page.locator('#build').isDisabled());
    assert(await page.getByLabel('Model 1', { exact: false }).isChecked());
    offered = { ...release, content: { ...release.content, models: release.content.models.slice(0, 1) } };
    await page.reload();
    await until(async () => (await page.textContent('#palette-status')).includes('models 1 are unavailable'));
    assert.equal(await page.getByLabel('Bank 1, slot 1', { exact: true }).inputValue(), '1');
    assert(await page.locator('#build').isDisabled());
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${name}: palette locks, explicit bank replacement, meter, share and profile file`);
  } finally { await browser.close(); }
}
