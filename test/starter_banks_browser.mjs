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
// Synthetic content checks the app without offering a firmware download.
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
const models = Array.from({ length: 24 }, (_, id) => {
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
const selection = { wave: true, rings: false, models: [0, 1], banks: [Array(8).fill(0)] };
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
    const starters = page.getByRole('group', { name: 'Starter banks', exact: true });
    assert.equal(await starters.getByRole('button').count(), 4);
    await starters.getByRole('button', { name: 'Drums', exact: true }).click();
    await until(async () => await page.getByLabel('Bank 2, slot 1', { exact: true }).count() === 1);
    assert.equal(await page.getByLabel('Bank 1, slot 1', { exact: true }).inputValue(), '0');
    assert.equal(await page.getByLabel('Bank 2, slot 1', { exact: true }).inputValue(), '21');
    assert(await page.getByLabel('Model 1 —', { exact: false }).isChecked());
    await until(async () => await page.locator('#build').isEnabled());
    const link = await page.getAttribute('#share', 'href');
    await page.goto(base + link);
    await until(async () => await page.locator('#build').isEnabled());
    assert.equal(await page.getByLabel('Bank 2, slot 8', { exact: true }).inputValue(), '16');
    offered = { ...release, app_size: 900000 };
    await page.reload();
    await until(async () => (await page.textContent('#flash-meter')).includes('too large'));
    await page.getByRole('button', { name: 'Physical', exact: true }).click();
    await until(async () => (await page.textContent('#status')).includes('nothing was changed'));
    assert.equal(await page.getByLabel('Bank 3, slot 1', { exact: true }).count(), 0);
    assert.equal(await page.getByLabel('Bank 2, slot 1', { exact: true }).inputValue(), '21');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${name}: starter bank addition, existing bank preservation, share and flash overflow refusal`);
  } finally { await browser.close(); }
}
