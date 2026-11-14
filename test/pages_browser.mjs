// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Options pages in the page: Beta 2 keeps four pages; a synthetic seven-page
// release (not a real release, never built) checks pages 5-7 and compaction.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:8080/';
const site = process.env.SITE || '/site';
const until = async (test) => { for (let i = 0; i < 100; ++i) { if (await test()) return; await new Promise((done) => setTimeout(done, 100)); } throw new Error('Timed out waiting for editor.'); };
const published = JSON.parse(readFileSync(`${site}/manifest.json`));
// The synthetic release is listed after Beta 2, so it opens first.
const seven = structuredClone(published);
const synthetic = structuredClone(published.releases[0]);
synthetic.tag = 'drizzlet-synthetic-seven-pages';
synthetic.name = 'Synthetic seven-page test release';
synthetic.profile.page_leds = [1, 2, 4, 3, 5, 6, 7];
seven.releases.push(synthetic);
const malformed = structuredClone(seven);
malformed.releases[1].profile.page_leds = [1, 2, 4, 3, 5, 6, 8];
const { unshare } = await import(pathToFileURL(resolve(site, 'js/profile.js')).href);
const lit = (page, row) => page.$$eval(`#grid tbody tr[data-page="${row}"] .leds i`, (leds) => leds.map((i) => i.className === 'lit'));

for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await engine.launch();
  try {
    for (const [label, manifest] of [['four', published], ['seven', seven], ['malformed', malformed]]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin) return route.abort('internetdisconnected');
        if (url.pathname.endsWith('/manifest.json')) return route.fulfill({ json: manifest });
        if (url.pathname.endsWith('.bin')) return route.abort('blockedbyclient');
        return route.continue();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base);
      if (label === 'malformed') {
        await until(async () => (await page.textContent('#status')) === 'Unsupported release list.');
        await context.close();
        continue;
      }
      await until(async () => await page.getAttribute('#summary', 'data-fingerprint'));
      const entries = async () => unshare(await page.getAttribute('#share', 'href'), manifest.releases).entries;
      let pages = label === 'four' ? 4 : 7;
      assert.equal(await page.locator('#grid tbody tr').count(), pages);
      assert.equal(await page.locator('.page-tabs [role=tab]').count(), pages);
      assert.equal(await page.textContent('#positions'), `12 of ${pages * 3} page positions used`);
      assert.deepEqual(await lit(page, 4), label === 'four' ? [true, true, true] : [true, true, false]);
      assert.match(await page.textContent('#page-order'), new RegExp(`^4 of ${pages} pages used\\. After power-on, holding \\[M\\] opens page 1; taps go 1 → 2 → 3 → 4 → 1`));
      assert.equal(await page.locator('#compact-pages').count(), 0);
      if (label === 'seven') {
        assert.deepEqual(await lit(page, 5), [true, false, true]);
        assert.deepEqual(await lit(page, 6), [false, true, true]);
        assert.deepEqual(await lit(page, 7), [true, true, true]);
        assert.equal(await page.getAttribute('#cell-21', 'aria-label'), 'Page 7, REVERB: Empty, choose a feature');
        // Keyboard stays inside the seven pages.
        await page.focus('#cell-21');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'cell-21');
        await page.keyboard.press('ArrowUp');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'cell-18');
        // Move Limiter to page 6, REVERB: page 5 stays empty and [M] skips it.
        await page.click('#cell-12');
        await page.selectOption('#where-page', '18');
        await until(async () => (await entries()).find((e) => e[0] === 5)?.[3] === 18);
        assert.match(await page.textContent('#panel-caption'), /tap to page 6 \(DRY\/WET and REVERB LEDs pulse\), turn REVERB/);
        assert.match(await page.textContent('#page-order'), /5 of 7 pages used\..*taps go 1 → 2 → 3 → 4 → 6 → 1/);
        await page.click('#compact-pages');
        assert.equal(await page.textContent('#compact-text'), 'Move page 6 to page 5. Knob positions on each page stay; the page LEDs change with the page number.');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'compact-apply');
        await page.click('#compact-cancel');
        assert.equal((await entries()).find((e) => e[0] === 5)[3], 18, 'cancel changes nothing');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'compact-pages');
        await page.click('#compact-pages');
        await page.click('#compact-apply');
        await until(async () => (await entries()).find((e) => e[0] === 5)?.[3] === 15);
        assert.equal(await page.locator('#compact-pages').count(), 0);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'cell-15');
        assert.match(await page.textContent('#status'), /Pages compacted: 6 → 5\./);
        // Phone tabs wrap around all seven pages.
        await page.setViewportSize({ width: 390, height: 900 });
        await page.click('#tab-7');
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-1');
        await page.keyboard.press('ArrowLeft');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-7');
        await page.setViewportSize({ width: 1280, height: 1000 });
        // Back to Beta 2 with a page-5 Replace prompt open: it closes and the selection falls back to page 1.
        await page.click('#cell-15');
        await page.selectOption('#where-page', '1');
        assert.equal(await page.locator('#confirm-replace').count(), 1);
        await page.selectOption('#release', published.releases[0].tag);
        await until(async () => await page.locator('#confirm-replace').count() === 0);
        await until(async () => await page.locator('#grid tbody tr').count() === 4);
        assert.equal(await page.getAttribute('#cell-1', 'aria-pressed'), 'true');
        assert.equal(await page.locator('#grid tbody tr.current').count(), 1);
        assert.deepEqual(await lit(page, 4), [true, true, true]);
        pages = 4;
      }
      await page.click('#preset-stock-plus-fixes');
      await until(async () => (await page.textContent('#page-order')) === 'Holding [M] opens nothing: no feature is on an options page.');
      assert.equal(await page.textContent('#positions'), `0 of ${pages * 3} page positions used`);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(`PASS ${name}: four-page Beta 2, synthetic seven-page cues, order, compaction preview and malformed release; no firmware built.`);
  } finally { await browser.close(); }
}
