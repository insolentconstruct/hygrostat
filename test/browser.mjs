// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Run with Playwright available, against a local server in an offline container.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:8080/';
const site = process.env.SITE || '/site';
const release = JSON.parse(readFileSync(`${site}/manifest.json`)).releases[0];
const { encodeProfile, defaults, share, unshare, fingerprint, templates, profileKey, cpuUsage } = await import(
  pathToFileURL(resolve(site, 'js/profile.js')).href);
const layout = await import(pathToFileURL(resolve(site, 'js/layout.js')).href);
const { guide } = await import(pathToFileURL(resolve(site, 'js/guide.js')).href);
const { factoryScales } = await import(pathToFileURL(resolve(site, 'js/scales.js')).href);
const { decode } = await import(pathToFileURL(resolve(site, 'js/decoder.js')).href);
const hashOf = (entries) => '#' + share(release, encodeProfile(entries, release.profile));
async function checkThemes(browser) {
  const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ?
    route.continue() : route.abort('internetdisconnected'));
  await context.addInitScript(() => {
    window.themeWrites = 0;
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'hygrostat-theme') window.themeWrites++;
      return set.call(this, key, value);
    };
  });
  const page = await context.newPage();
  await page.goto(base);
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
  const appearance = () => page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    scheme: getComputedStyle(document.getElementById('theme')).colorScheme,
    panel: getComputedStyle(document.getElementById('panel')).getPropertyValue('--face').trim()
  }));
  const expectTheme = async (value) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await appearance()).theme === value) return;
      await page.waitForTimeout(20);
    }
    assert.fail('theme did not follow the system preference');
  };
  assert.equal(await theme.inputValue(), 'system');
  assert.equal((await appearance()).theme, 'dark');
  assert.equal(await page.evaluate(() => window.themeWrites), 0);
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme('light');
  const lightPanel = (await appearance()).panel;
  await theme.selectOption('dark');
  assert.equal((await appearance()).scheme, 'dark');
  assert.notEqual((await appearance()).panel, lightPanel);
  await page.emulateMedia({ colorScheme: 'dark' });
  await theme.selectOption('light');
  assert.equal((await appearance()).theme, 'light');
  assert.equal((await appearance()).scheme, 'light');
  assert.equal((await appearance()).panel, lightPanel);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal((await appearance()).theme, 'light');
  await page.reload();
  assert.equal(await theme.inputValue(), 'light');
  assert.equal((await appearance()).theme, 'light');
  assert.equal(await page.evaluate(() => window.themeWrites), 0);
  await theme.selectOption('system');
  assert.equal((await appearance()).theme, 'dark');
  await page.reload();
  assert.equal(await theme.inputValue(), 'system');
  await expectTheme('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme('light');
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await theme.boundingBox();
  assert(box.width >= 44 && box.height >= 44);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#release').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'theme');
  assert.notEqual(await theme.evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
  await context.close();
  for (const blocked of ['invalid', 'read', 'write']) {
    const isolated = await browser.newContext({ colorScheme: 'dark' });
    await isolated.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ?
      route.continue() : route.abort('internetdisconnected'));
    await isolated.addInitScript((blocked) => {
      if (blocked === 'read') Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });
      else if (blocked === 'write') Storage.prototype.setItem = () => { throw new Error('storage writes blocked'); };
      else localStorage.setItem('hygrostat-theme', 'invalid');
    }, blocked);
    const check = await isolated.newPage();
    const errors = [];
    check.on('pageerror', (error) => errors.push(String(error)));
    await check.goto(base);
    assert.equal(await check.evaluate(() => {
      try { return localStorage === undefined; } catch { return true; }
    }), blocked === 'read');
    if (blocked === 'write') assert(await check.evaluate(() => {
      try { localStorage.setItem('probe', 'test'); return false; } catch { return true; }
    }));
    assert.equal(await check.locator('#theme').inputValue(), 'system');
    assert.equal(await check.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await check.locator('#theme').selectOption('light');
    assert.equal(await check.evaluate(() => document.documentElement.dataset.theme), 'light');
    assert.deepEqual(errors, []);
    await isolated.close();
  }
  for (const saved of ['light', 'dark']) {
    const initial = await browser.newContext({ colorScheme: saved === 'light' ? 'dark' : 'light' });
    await initial.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ?
      route.continue() : route.abort('internetdisconnected'));
    await initial.addInitScript((saved) => {
      localStorage.setItem('hygrostat-theme', saved);
      window.firstBodyTheme = null;
      const observer = new MutationObserver(() => {
        if (!document.body) return;
        window.firstBodyTheme = document.documentElement.dataset.theme;
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    }, saved);
    const first = await initial.newPage();
    await first.goto(base);
    assert.equal(await first.evaluate(() => window.firstBodyTheme), saved);
    await initial.close();
  }
}
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await engine.launch();
  let traceContext;
  let phase = 'themes';
  const diagnostics = [];
  const record = (event, detail) => {
    diagnostics.push({ event, phase, time: Date.now(), ...detail });
    if (diagnostics.length > 200) diagnostics.shift();
  };
  const documentURL = (url) => url.split('#')[0];
  try {
    await checkThemes(browser);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // Reloads here start fresh; test/draft_browser.mjs covers the kept setup.
    await context.addInitScript(() => {
      for (const key of ['hygrostat-draft', 'hygrostat-draft-before-link', 'hygrostat-draft-refused']) localStorage.removeItem(key);
    });
    traceContext = context;
    await context.tracing.start({ snapshots: true });
    context.on('requestfailed', (request) => {
      if (new URL(request.url()).origin === new URL(base).origin) {
        record('requestfailed', { url: documentURL(request.url()), failure: request.failure() });
      }
    });
    context.on('response', (response) => {
      if (response.status() >= 400 && new URL(response.url()).origin === new URL(base).origin) {
        record('response', { url: documentURL(response.url()), status: response.status() });
      }
    });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ?
      route.continue() : route.abort('internetdisconnected'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(String(error));
      record('pageerror', { url: documentURL(page.url()), message: String(error), stack: error.stack });
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) record('navigation', { url: documentURL(frame.url()) });
    });
    page.on('worker', (worker) => {
      record('worker', { url: worker.url() });
      worker.on('close', () => record('worker-close', { url: worker.url() }));
    });
    phase = 'initial load';
    await page.goto(base);
    const until = async (predicate) => {
      const deadline = Date.now() + 30000;
      while (!await predicate()) {
        assert(Date.now() < deadline, 'timed out waiting for page state');
        await page.waitForTimeout(50);
      }
    };
    const waitFingerprint = (fp) => until(async () =>
      await page.textContent('#fingerprint') === fp && await page.getAttribute('#summary', 'data-fingerprint') === fp);
    const noCPU = async () => {
      assert.equal(await page.locator('[id^="cpu"]').count(), 0);
      assert.equal(await page.locator('body').evaluate((b) => b.classList.contains('cpu-warning')), false);
    };
    const pressed = () => page.locator('#presets [aria-pressed=true]').allTextContents();
    // A chip asks before replacing a setup that is not a starting point.
    const usePreset = async (id, asks) => {
      await page.click(`#preset-${id}`);
      assert.equal(await page.isVisible('#preset-confirm'), asks);
      if (asks) await page.click('#preset-replace');
    };
    phase = 'feature library and templates';
    // Open a feature from the library, as a person would.
    const selectFeature = async (f) => {
      await page.click('#browse');
      await page.click(`#lib-${f.id}`);
      await until(async () => await page.textContent('#inspector-title') === f.name);
    };
    const mode = async (f, state) => {
      if (await page.textContent('#inspector-title') !== f.name) await selectFeature(f);
      await page.check(`#state-${state}`);
    };
    const releaseBlock = encodeProfile(defaults(release.profile), release.profile);
    const releaseFP = await fingerprint(releaseBlock);
    await waitFingerprint(releaseFP);
    await noCPU();
    if (release.profile.version === 2) {
      for (const character of ['\ufffe', '\uffff']) {
        const bank = factoryScales(); bank[0].name = `Scale${character} & <test>`;
        for (const mobile of [false, true]) {
          const drawing = guide(defaults(release.profile), release, releaseFP, mobile, bank);
          const parsed = await page.evaluate((svg) => {
            const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
            return { errors: document.querySelectorAll('parsererror').length, text: document.documentElement.textContent };
          }, drawing);
          assert.equal(parsed.errors, 0);
          assert(parsed.text.includes('Scale\ufffd & <test>'));
        }
      }
    }
    assert.deepEqual(await pressed(), ['Drizzlet']);
    assert.equal(await page.textContent('#positions'), '12 of 12 page positions used');
    assert.equal(await page.isVisible('#development'), Boolean(release.development));
    // Preview every focused template without changing the profile or share link.
    const unchangedShare = await page.getAttribute('#share', 'href');
    await page.click('#more-templates');
    assert.equal(await page.locator('.template-card').count(), 7);
    for (const template of ['Cloud textures', 'Pitched grains', 'Drum grains', 'Delay & freeze', 'Spectral', 'Plaits voice', 'Live essentials']) {
      const id = template.toLowerCase().replace(/\W+/g, '-');
      await page.click(`#template-${id}`);
      assert((await page.textContent('#template-preview-title')).startsWith(template));
      assert.equal(await page.getAttribute('#share', 'href'), unchangedShare);
      assert.equal(await page.textContent('#fingerprint'), releaseFP);
      assert(await page.locator('.template-change').count() > 0);
    }
    await page.click('#cancel-template');
    assert.equal(await page.locator('.template-change').count(), 0);
    await waitFingerprint(releaseFP);
    // Applying a preview uses that exact profile; the default chip restores it.
    await page.click('#more-templates');
    await page.click('#template-drum-grains');
    await page.click('#use-template');
    await waitFingerprint(await fingerprint(encodeProfile(templates(release.profile)['Drum grains'], release.profile)));
    assert.equal(await page.isVisible('#template-gallery'), false);
    await usePreset('drizzlet', false);
    await waitFingerprint(releaseFP);
    // Every feature: a description and a documentation link for the release.
    for (const f of release.profile.features) {
      await selectFeature(f);
      const link = page.getByRole('link', { name: `${f.name} documentation`, exact: true });
      assert.equal(await link.count(), 1);
      const href = await link.getAttribute('href');
      assert(href.includes(`/blob/${release.development ? release.source_commit : release.tag}/beads/build/docs/FEATURES.md#`));
      assert((await link.locator('..').innerText()).length > 'Documentation'.length);
      if (f.id === 13) assert((await page.textContent('#action-help')).includes('no page knob'));
    }
    phase = 'grid and keyboard';
    // The grid matches the module: page rows, knob columns.
    assert.equal(await page.getAttribute('#cell-1', 'aria-label'), 'Page 1, FEEDBACK: Pitch scale, starts off');
    assert.equal(await page.getAttribute('#cell-10', 'aria-label'), 'Page 4, FEEDBACK: LED brightness, starts 100%');
    assert.equal(await page.getAttribute('#amount-2', 'aria-label'), '[A] + REVERB: Diffusion, starts 0');
    // Keyboard: arrows move within the grid, Enter selects, Delete empties.
    await page.focus('#cell-1');
    for (const [key, cell] of [['ArrowRight', 'cell-2'], ['ArrowDown', 'cell-5'], ['End', 'cell-6'], ['Home', 'cell-4'], ['ArrowUp', 'cell-1'], ['ArrowLeft', 'cell-1']]) {
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => document.activeElement.id), cell, key);
    }
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    assert.equal(await page.getAttribute('#cell-2', 'aria-pressed'), 'true');
    assert.equal(await page.textContent('#inspector-title'), 'Random pitch steps');
    assert.match(await page.textContent('#inspector .description'), /CCW.*relative.*CW.*before Pitch scale/);
    assert.match(await page.textContent('#feature-details'), /G below C \(a fourth down\).*afterwards.*not the continuous oscillator, Plaits or Spectral/);
    assert((await page.textContent('#panel-caption')).includes('page 1'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cell-2');
    await page.keyboard.press('Delete');
    const emptied = layout.unplace(defaults(release.profile), release.profile, 10, 'page');
    await waitFingerprint(await fingerprint(encodeProfile(emptied, release.profile)));
    assert.equal(await page.getAttribute('#share', 'href'), hashOf(emptied));
    assert.equal(await page.getAttribute('#cell-2', 'aria-label'), 'Page 1, DRY/WET: Empty, choose a feature');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cell-2');
    assert.equal(await page.textContent('#changes'), '1 change from Drizzlet');
    assert.deepEqual(await pressed(), []);
    // Enter on an empty position opens the library; search, then choose by keyboard.
    await page.keyboard.press('Enter');
    await until(() => page.locator('#library').isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'library-search');
    await page.keyboard.type('final pitch');
    assert.deepEqual(await page.locator('#library-body .library-item .name').allTextContents(), ['Pitch scale']);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lib-1');
    await page.keyboard.press('Enter');
    // Pitch scale was on page 1 · FEEDBACK and the target is empty: it moves.
    await until(async () => !await page.locator('#library').isVisible());
    const moved = layout.place(emptied, release.profile, 1, 'page', 2);
    await waitFingerprint(await fingerprint(encodeProfile(moved, release.profile)));
    assert.equal(await page.getAttribute('#cell-1', 'aria-label'), 'Page 1, FEEDBACK: Empty, choose a feature');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cell-2');
    // An edited setup survives a cancelled chip; Replace then uses the preset.
    const movedFP = await fingerprint(encodeProfile(moved, release.profile));
    const movedCount = layout.changes(templates(release.profile).Drizzlet, moved, release.profile).length;
    await page.click('#preset-drizzlet');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'preset-replace');
    assert.equal(await page.textContent('#preset-confirm-text'), `Replace your setup with Drizzlet? ${movedCount} setting${movedCount === 1 ? '' : 's'} will change.`);
    await page.click('#preset-cancel');
    assert.equal(await page.isVisible('#preset-confirm'), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'preset-drizzlet');
    await waitFingerprint(movedFP);
    assert.equal(await page.getAttribute('#cell-1', 'aria-label'), 'Page 1, FEEDBACK: Empty, choose a feature');
    // Place, swap and replace by pointer from the Drizzlet preset.
    await usePreset('drizzlet', true);
    await waitFingerprint(releaseFP);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'preset-drizzlet');
    await page.focus('#cell-10');
    await page.keyboard.press('Delete');
    const withoutBrightness = layout.unplace(defaults(release.profile), release.profile, 18, 'page');
    await waitFingerprint(await fingerprint(encodeProfile(withoutBrightness, release.profile)));
    await page.click('#cell-10');
    await until(() => page.locator('#library').isVisible());
    assert.equal(await page.locator('#lib-11').count(), 0, 'only features that fit a page');
    await page.click('#lib-18');
    let expected = layout.place(defaults(release.profile), release.profile, 18, 'page', 10);
    await waitFingerprint(await fingerprint(encodeProfile(expected, release.profile)));
    assert((await page.textContent('#cell-10')).includes('LED brightness'));
    assert.equal(await page.textContent('#positions'), '12 of 12 page positions used');
    await page.click('#cell-1');
    await page.click('#choose-feature');
    await page.click('#lib-7');
    assert.equal(await page.textContent('#confirm-text'), 'Page 1 · FEEDBACK has Pitch scale.');
    await page.click('#confirm-swap');
    expected = layout.place(expected, release.profile, 7, 'page', 1, 'swap');
    await waitFingerprint(await fingerprint(encodeProfile(expected, release.profile)));
    assert((await page.textContent('#cell-1')).includes('Synth'));
    assert((await page.textContent('#cell-8')).includes('Pitch scale'));
    assert((await page.textContent('#status')).includes('Pitch scale moved to page 3 · DRY/WET'));
    await page.click('#cell-2');
    await page.click('#choose-feature');
    await page.click('#lib-5');
    await page.click('#confirm-replace');
    expected = layout.place(expected, release.profile, 5, 'page', 2, 'replace');
    await waitFingerprint(await fingerprint(encodeProfile(expected, release.profile)));
    assert.equal(await page.getAttribute('#share', 'href'), hashOf(expected));
    assert((await page.textContent('#cell-2')).includes('Limiter'));
    assert.equal(await page.getAttribute('#cell-12', 'aria-label'), 'Page 4, REVERB: Empty, choose a feature');
    assert((await page.textContent('#status')).includes('Random pitch steps goes back to stock behaviour'));
    // The inspector offers the same choice for its position menu.
    await page.selectOption('#where-page', '3');
    await page.click('#confirm-swap');
    expected = layout.place(expected, release.profile, 5, 'page', 3, 'swap');
    await waitFingerprint(await fingerprint(encodeProfile(expected, release.profile)));
    // Dragging a feature onto an empty position moves it.
    if (name === 'chromium') {
      await page.dragAndDrop('#cell-3', '#cell-12');
      expected = layout.place(expected, release.profile, 5, 'page', 12, 'swap');
      await waitFingerprint(await fingerprint(encodeProfile(expected, release.profile)));
    }
    // Amounts and actions are their own destinations.
    await page.click('#action-1');
    assert.equal(await page.textContent('#inspector-title'), 'Monophonic grains');
    assert((await page.textContent('#panel-caption')).includes('press SEED'));
    await usePreset('drizzlet', true);
    await waitFingerprint(releaseFP);
    // Emptying from the inspector keeps keyboard focus on the position.
    await page.click('#cell-9');
    await page.click('#clear-position');
    await waitFingerprint(await fingerprint(encodeProfile(layout.unplace(defaults(release.profile), release.profile, 9, 'page'), release.profile)));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cell-9');
    await usePreset('drizzlet', true);
    await waitFingerprint(releaseFP);
    await noCPU();
    for (const f of release.profile.features.filter((f) => !f.values)) {
      await page.click(`#amount-${f.default[4]}`);
      const input = page.getByRole('spinbutton', { name: `${f.name}: Starting value (0–255)`, exact: true });
      const previous = await input.inputValue();
      const previousShare = await page.getAttribute('#share', 'href');
      for (const invalid of ['', '-1', '256', '1.5']) {
        await input.fill(invalid);
        await input.press('Tab');
        assert.equal(await input.inputValue(), previous);
        assert.equal(await page.getAttribute('#share', 'href'), previousShare);
        assert((await page.textContent('#status')).includes('Previous value kept'));
      }
    }
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('#workspace').isVisible(), false);
    assert.equal(await page.locator('.buildbar').isVisible(), false);
    assert.equal(await page.locator('.print-note').isVisible(), true);
    assert.equal(await page.locator('#install').isVisible(), true);
    await page.emulateMedia({ media: 'screen' });
    phase = 'feature bytes';
    // Every feature returns to byte-identical Off state, including value/slots.
    await usePreset('stock-plus-fixes', false);
    const stockFP = await fingerprint(encodeProfile(templates(release.profile)['Stock plus fixes'], release.profile));
    await waitFingerprint(stockFP);
    await noCPU();
    assert.equal(await page.textContent('#positions'), '0 of 12 page positions used');
    const stockShare = await page.getAttribute('#share', 'href');
    const manifestURL = /\/manifest\.json(?:\?|$)/;
    phase = 'legacy CPU fixture';
    // Historical metadata is inert even without feature costs or a reference.
    const boundedManifest = JSON.parse(readFileSync(`${site}/manifest.json`));
    delete boundedManifest.releases[0].cpu.estimate_reference;
    delete boundedManifest.releases[0].cpu.default_measured;
    delete boundedManifest.releases[0].cpu.estimated_default_delta;
    for (const f of boundedManifest.releases[0].profile.features) f.cpu = null;
    let boundedRequests = 0;
    const boundedRoute = (route) => {
      boundedRequests++;
      return route.fulfill({ json: boundedManifest });
    };
    await context.route(manifestURL, boundedRoute);
    // Preset selection updates the share link, not location.hash. Persist
    // the exact Stock bytes explicitly before reloading the routed manifest.
    await page.evaluate((hash) => history.replaceState(null, '', hash), stockShare);
    await page.reload();
    await waitFingerprint(stockFP);
    assert.equal(boundedRequests, 1, 'reload fetched the versioned manifest fixture');
    await noCPU();
    assert.equal(await page.isDisabled('#build'), false);
    assert.equal(await page.isDisabled('#local'), false);
    await context.unroute(manifestURL, boundedRoute);
    phase = 'unknown CPU fixture';
    // Preserve the enabled/unknown regression using an explicit Off-default fixture.
    const offManifest = JSON.parse(readFileSync(`${site}/manifest.json`));
    delete offManifest.releases[0].cpu.estimate_reference;
    delete offManifest.releases[0].cpu.default_measured;
    delete offManifest.releases[0].cpu.estimated_default_delta;
    for (const f of offManifest.releases[0].profile.features) {
      f.default = [f.id, 0, 0, 0, 0, 0];
      f.cpu = null;
    }
    const offRoute = (route) => route.fulfill({ json: offManifest });
    await context.route(manifestURL, offRoute);
    await page.reload();
    await waitFingerprint(stockFP);
    for (const f of release.profile.features) {
      await mode(f, 1);
      await until(async () => unshare(await page.getAttribute('#share', 'href'), [release])
          .entries.find((e) => e[0] === f.id)?.[1] === 1);
      await noCPU();
      assert.equal(await page.isDisabled('#build'), false);
      assert.equal(await page.isDisabled('#local'), false);
      await mode(f, 0);
      await waitFingerprint(stockFP);
      assert.equal(await page.getAttribute('#share', 'href'), stockShare, `${f.name}: exact Off bytes`);
    }
    await context.unroute(manifestURL, offRoute);
    await page.evaluate(() => history.replaceState(null, '', location.pathname + location.search));
    await page.reload();
    await waitFingerprint(releaseFP);
    for (const f of release.profile.features.filter((f) => f.default_in_block === false)) {
      await mode(f, 1);
      await mode(f, 0);
      await waitFingerprint(releaseFP);
      assert.deepEqual(await pressed(), ['Drizzlet']);
      const dev = release.development ? '-dev' : '';
      assert.equal(await page.getAttribute('#guide', 'download'), `options-guide${dev}.svg`);
      assert.equal(await page.getAttribute('#guide-mobile', 'download'), `options-guide${dev}-mobile.svg`);
    }
    phase = 'extras';
    // Extras: switches and value menus give the same bytes as the inspector.
    for (const f of release.profile.features.filter((f) => f.default_in_block === false)) {
      const control = page.locator(`#extra-${f.id}`);
      if (await control.getAttribute('role') === 'switch') {
        await control.check();
        const on = layout.edit(defaults(release.profile), release.profile, f, 1, 1);
        await waitFingerprint(await fingerprint(encodeProfile(on, release.profile)));
        await control.uncheck();
      } else {
        await control.selectOption(String(f.values.length - 1));
        const on = layout.edit(layout.edit(defaults(release.profile), release.profile, f, 1, 1), release.profile, f, 2, f.values.length - 1);
        await waitFingerprint(await fingerprint(encodeProfile(on, release.profile)));
        await page.locator(`#extra-${f.id}`).selectOption('0');
      }
      await waitFingerprint(releaseFP);
    }
    await page.click('#extra-23-place');
    assert((await page.textContent('#status')).includes('All page positions are in use'));
    await waitFingerprint(releaseFP);
    await page.focus('#cell-10');
    await page.keyboard.press('Delete');
    const roomForExtra = layout.unplace(defaults(release.profile), release.profile, 18, 'page');
    await waitFingerprint(await fingerprint(encodeProfile(roomForExtra, release.profile)));
    await page.click('#extra-23-place');
    await waitFingerprint(await fingerprint(encodeProfile(layout.place(roomForExtra, release.profile, 23, 'page', 10), release.profile)));
    await usePreset('drizzlet', true);
    await waitFingerprint(releaseFP);
    phase = 'share links';
    // Keep the unknown-cost share-link regression independent of shipped costs.
    const unknownManifest = JSON.parse(readFileSync(`${site}/manifest.json`));
    unknownManifest.releases[0].profile.features.find((f) => f.id === 1).cpu = null;
    const unknownRoute = (route) => route.fulfill({ json: unknownManifest });
    await context.route(manifestURL, unknownRoute);
    await page.reload();
    await waitFingerprint(releaseFP);
    // Change only the fragment in an already open document: no reload.
    const chosen = defaults(release.profile);
    chosen.find((e) => e[0] === 1)[2] = 3;
    const customBlock = encodeProfile(chosen, release.profile);
    const customFP = await fingerprint(customBlock);
    await page.evaluate(() => { window.sameDocument = true; });
    await page.evaluate((hash) => { location.hash = hash; }, share(release, customBlock));
    await waitFingerprint(customFP);
    assert.equal(await page.evaluate(() => window.sameDocument), true);
    await page.click('#cell-1');
    assert.equal(await page.inputValue('#value'), '3');
    assert((await page.getAttribute('#cell-1', 'aria-label')).endsWith('starts major'));
    assert.deepEqual(await pressed(), []);
    assert((await page.getAttribute('#guide', 'download')).includes(customFP));
    assert((await page.getAttribute('#share', 'href')).includes(share(release, customBlock)));
    assert.equal(await page.isDisabled('#build'), false);
    await noCPU();
    // Invalid input reports its error and leaves the valid profile intact.
    await page.evaluate(() => { location.hash = 'release=missing&profile=00'; });
    await until(async () => await page.getAttribute('#status', 'class') === 'error');
    assert.equal(await page.textContent('#fingerprint'), customFP);
    await page.evaluate((hash) => { location.hash = hash; }, share(release, releaseBlock));
    await waitFingerprint(releaseFP);
    assert.deepEqual(await pressed(), ['Drizzlet']);
    await noCPU();
    assert.equal(await page.isDisabled('#build'), false);
    await context.unroute(manifestURL, unknownRoute);
    phase = 'local image refusal';
    // Reject wrong-sized local files before reading or hashing their contents.
    await page.evaluate(() => {
      window.localBoundary = { reads: 0, hashes: 0, digest: crypto.subtle.digest };
      crypto.subtle.digest = function(...args) {
        window.localBoundary.hashes++;
        return window.localBoundary.digest.apply(this, args);
      };
    });
    for (const [size, length, reads, hashes] of [
      [8 * 1024 ** 3, 0, 0, 0],
      [release.app_size, release.app_size + 1, 1, 0],
      [release.app_size, release.app_size, 1, 1]
    ]) {
      await page.evaluate(({ size, length }) => {
        window.localBoundary.reads = window.localBoundary.hashes = 0;
        const input = document.querySelector('#local');
        const source = new File([new Uint8Array(length)], 'wrong-image.bin');
        const read = source.arrayBuffer.bind(source);
        const file = size === source.size ? source : { size, arrayBuffer: read };
        file.arrayBuffer = () => { window.localBoundary.reads++; return read(); };
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        input.dispatchEvent(new Event('change'));
      }, { size, length });
      await until(async () => await page.getAttribute('#status', 'class') === 'error' && !await page.isDisabled('#local'));
      const actual = await page.evaluate(() => ({ reads: window.localBoundary.reads, hashes: window.localBoundary.hashes }));
      assert.deepEqual(actual, { reads, hashes });
      assert((await page.textContent('#status')).includes(hashes ? 'does not match' : 'must be'));
      assert.equal(await page.isVisible('#result'), false);
    }
    await page.evaluate(() => {
      delete document.querySelector('#local').files;
      crypto.subtle.digest = window.localBoundary.digest;
      delete window.localBoundary;
    });
    phase = 'release WAV';
    // Building the release default reproduces the release WAV, with its guides.
    if (name === 'chromium') {
      await page.click('#build');
      await until(async () => await page.isVisible('#result'));
      assert.equal(await page.getAttribute('#status', 'class'), 'ok');
      assert((await page.textContent('#status')).includes('Matches the release'));
      assert.equal(await page.textContent('#wav-hash'), release.wav_sha256);
      assert.equal(await page.textContent('#app-hash'), release.app_sha256);
      assert.equal(await page.getAttribute('#download', 'download'), `${release.tag}.wav`);
      assert(await page.isVisible('#guide'));
      assert(await page.isVisible('#guide-mobile'));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'result-title');
      assert((await page.textContent('#result')).includes('calibration'));
    }
    phase = 'measured CPU fixture';
    // Historical thresholds never disable a valid build or local-image input.
    const measuredManifest = JSON.parse(readFileSync(`${site}/manifest.json`));
    const measured = measuredManifest.releases[0];
    measured.profile.features.find((f) => f.id === 1).cpu = null;
    measured.cpu.combinations = [{ profile: profileKey(chosen, release.profile), synth: 90.4, granular: 89 }];
    const measuredRoute = (route) => route.fulfill({ json: measuredManifest });
    await context.route(manifestURL, measuredRoute);
    for (const percent of [90.4, 92, 92.1]) {
      phase = `measured CPU fixture ${percent}`;
      measured.cpu.combinations[0].synth = percent;
      await page.evaluate((hash) => history.replaceState(null, '', hash), '#' + share(release, customBlock));
      await page.reload();
      await waitFingerprint(customFP);
      assert.equal(cpuUsage(chosen, measured).blocked, percent > 92, 'fixture exercises the historical threshold');
      await noCPU();
      assert.equal(await page.isDisabled('#build'), false);
      assert.equal(await page.isDisabled('#local'), false);
    }
    if (name === 'chromium') {
      phase = 'formerly blocked custom WAV';
      // The real worker encodes and independently decodes this custom image.
      await page.click('#build');
      await until(async () => await page.isVisible('#result'));
      assert.equal(await page.getAttribute('#status', 'class'), 'ok');
      assert((await page.textContent('#status')).includes(`Profile ${customFP}; audio checked.`));
      assert.match(await page.textContent('#wav-hash'), /^[0-9a-f]{64}$/);
      assert.notEqual(await page.textContent('#wav-hash'), release.wav_sha256);
      const downloaded = page.waitForEvent('download');
      await page.click('#download');
      const stream = await (await downloaded).createReadStream();
      assert(stream, 'custom WAV download is readable');
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const customApp = decode(new Uint8Array(Buffer.concat(chunks)), release.app_size);
      const customHash = createHash('sha256').update(customApp).digest('hex');
      assert.notEqual(customHash, release.app_sha256, 'custom firmware differs from its base');
      assert.equal(await page.textContent('#app-hash'), customHash, 'shown app checksum matches the downloaded firmware');
      assert.deepEqual(customApp.subarray(release.profile.offset, release.profile.offset + release.profile.size), customBlock);
      assert((await page.getAttribute('#download', 'download')).includes(customFP));
      assert((await page.getAttribute('#guide', 'download')).includes(customFP));
      assert((await page.getAttribute('#guide-mobile', 'download')).includes(customFP));
      await noCPU();
    }
    phase = 'phone layout';
    // Phones: pages become tabs with three knob rows.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await phone.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ?
      route.continue() : route.abort('internetdisconnected'));
    const phonePage = await phone.newPage();
    await phonePage.goto(base);
    await phonePage.waitForSelector('#summary[data-fingerprint]');
    assert(await phonePage.isVisible('#cell-1'));
    assert(!await phonePage.isVisible('#cell-4'));
    await phonePage.click('#tab-3');
    assert(await phonePage.isVisible('#cell-8'));
    assert(!await phonePage.isVisible('#cell-1'));
    assert.equal(await phonePage.getAttribute('#tab-3', 'aria-selected'), 'true');
    assert.equal(await phonePage.getAttribute('#cell-7', 'tabindex'), '0', 'a visible cell keeps the tab stop');
    await phonePage.focus('#cell-7');
    await phonePage.keyboard.press('ArrowDown');
    assert.equal(await phonePage.evaluate(() => document.activeElement.id), 'cell-10');
    assert(await phonePage.isVisible('#cell-10'));
    // A tab chosen by hand stays when a setting changes elsewhere.
    await phonePage.click('#tab-4');
    await phonePage.check('#extra-15');
    await phonePage.waitForFunction(() => document.querySelector('#extra-15')?.checked);
    assert.equal(await phonePage.getAttribute('#tab-4', 'aria-selected'), 'true');
    await phonePage.uncheck('#extra-15');
    // A swap from the inspector shows the destination's page and focuses it.
    await phonePage.click('#tab-1');
    await phonePage.click('#cell-1');
    await phonePage.selectOption('#where-page', '5');
    await phonePage.click('#confirm-swap');
    await phonePage.waitForFunction(() => document.activeElement?.id === 'cell-5');
    assert.equal(await phonePage.getAttribute('#tab-2', 'aria-selected'), 'true');
    assert(await phonePage.isVisible('#cell-5'));
    for (const id of ['cell-5', 'tab-1', 'build', 'browse']) {
      const box = await phonePage.locator('#' + id).boundingBox();
      assert(box.height >= 44, `${id} is a 44 px target`);
    }
    assert.equal(await phonePage.evaluate(() => document.documentElement.scrollWidth), 390, 'no sideways scroll');
    await phone.close();
    phase = 'download counters';
    const counters = await browser.newContext();
    const counterRequests = [];
    await counters.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin) return route.continue();
      counterRequests.push(url.href);
      if (url.hostname === 'stats.insolentconstruct.net' && url.pathname.startsWith('/counter/')) {
        return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { count: url.pathname.endsWith('/TOTAL.json') ? '400' : '12' } });
      }
      if (url.hostname === 'api.github.com') return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { assets: [{ name: 'release-wav.zip', download_count: 8 }] } });
      return route.abort('internetdisconnected');
    });
    const counterPage = await counters.newPage();
    await counterPage.goto(base);
    await until(async () => (await counterPage.textContent('#fingerprint')).length > 0);
    assert.deepEqual(counterRequests, [], 'counters remain deferred');
    await counterPage.keyboard.press('Tab');
    await until(async () => (await counterPage.textContent('#download-counts')).includes('Site visitors: 400'));
    const lines = counterPage.locator('#download-counts p');
    assert.equal(await lines.count(), JSON.parse(readFileSync(`${site}/manifest.json`)).releases.length + 1);
    assert((await lines.first().textContent()).includes(`${release.name}: downloaded 20 times`));
    assert.equal(await lines.last().textContent(), 'Site visitors: 400');
    await counters.close();
    phase = 'capability refusal';
    // Capability failure gives an actionable message before enabling builds.
    await page.addInitScript(() => { window.Worker = undefined; });
    await page.goto(base);
    await until(async () => (await page.textContent('#status')).includes('current Chrome'));
    assert.equal(await page.isDisabled('#build'), true);
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    const noJSPage = await noJS.newPage();
    await noJSPage.goto(base);
    assert((await noJSPage.locator('noscript').innerText()).includes('Enable JavaScript'));
    await noJS.close();
    assert.deepEqual(errors, []);
    await context.tracing.stop();
    traceContext = null;
    console.log(`PASS ${name}: grid place/swap/replace/keyboard${name === 'chromium' ? '/drag, release and custom WAV builds' : ''}, phone tabs, every feature Fixed/Off exact bytes, extras, default names, no CPU UI or build gating, same-document share links and invalid-link recovery`);
  } catch (error) {
    console.error(`Browser diagnostics ${name}: ${JSON.stringify(diagnostics)}`);
    if (traceContext) {
      mkdirSync('test-artifacts', { recursive: true });
      try { await traceContext.tracing.stop({ path: `test-artifacts/browser-${name}.zip` }); }
      catch (traceError) { console.error(`Trace capture failed: ${traceError.message}`); }
    }
    throw error;
  } finally { await browser.close(); }
}
