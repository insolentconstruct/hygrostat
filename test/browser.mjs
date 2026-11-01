// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Run with Playwright available, against a local server in an offline container.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:8080/';
const site = process.env.SITE || '/site';
const release = JSON.parse(readFileSync(`${site}/manifest.json`)).releases[0];
const { encodeProfile, defaults, share, fingerprint, templates, profileKey } = await import(
  'data:text/javascript;base64,' + readFileSync(`${site}/js/profile.js`).toString('base64'));
const layout = await import(pathToFileURL(resolve(site, 'js/layout.js')).href);
const hashOf = (entries) => '#' + share(release, encodeProfile(entries, release.profile));
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ?
      route.continue() : route.abort('internetdisconnected'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
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
    const pressed = () => page.locator('#presets [aria-pressed=true]').allTextContents();
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
    assert.deepEqual(await pressed(), ['Drizzlet']);
    assert.equal(await page.textContent('#positions'), '10 of 12 page positions used');
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
    await page.click('#preset-drizzlet');
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
    // The grid matches the module: page rows, knob columns.
    assert.equal(await page.getAttribute('#cell-1', 'aria-label'), 'Page 1, FEEDBACK: Pitch scale, starts off');
    assert.equal(await page.getAttribute('#cell-10', 'aria-label'), 'Page 4, FEEDBACK: empty');
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
    assert.equal(await page.textContent('#inspector-title'), 'Random intervals');
    assert((await page.textContent('#panel-caption')).includes('page 1'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cell-2');
    await page.keyboard.press('Delete');
    const emptied = layout.unplace(defaults(release.profile), release.profile, 10, 'page');
    await waitFingerprint(await fingerprint(encodeProfile(emptied, release.profile)));
    assert.equal(await page.getAttribute('#share', 'href'), hashOf(emptied));
    assert.equal(await page.getAttribute('#cell-2', 'aria-label'), 'Page 1, DRY/WET: empty');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cell-2');
    assert.equal(await page.textContent('#changes'), '1 change from Drizzlet');
    assert.deepEqual(await pressed(), []);
    // Enter on an empty position opens the library; search, then choose by keyboard.
    await page.keyboard.press('Enter');
    await until(() => page.locator('#library').isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'library-search');
    await page.keyboard.type('scale');
    assert.deepEqual(await page.locator('#library-body .library-item .name').allTextContents(), ['Pitch scale']);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'lib-1');
    await page.keyboard.press('Enter');
    // Pitch scale was on page 1 · FEEDBACK and the target is empty: it moves.
    await until(async () => !await page.locator('#library').isVisible());
    const moved = layout.place(emptied, release.profile, 1, 'page', 2);
    await waitFingerprint(await fingerprint(encodeProfile(moved, release.profile)));
    assert.equal(await page.getAttribute('#cell-1', 'aria-label'), 'Page 1, FEEDBACK: empty');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cell-2');
    // Place, swap and replace by pointer from the Drizzlet preset.
    await page.click('#preset-drizzlet');
    await waitFingerprint(releaseFP);
    await page.click('#cell-10');
    await until(() => page.locator('#library').isVisible());
    assert.equal(await page.locator('#lib-11').count(), 0, 'only features that fit a page');
    await page.click('#lib-18');
    let expected = layout.place(defaults(release.profile), release.profile, 18, 'page', 10);
    await waitFingerprint(await fingerprint(encodeProfile(expected, release.profile)));
    assert((await page.textContent('#cell-10')).includes('LED brightness'));
    assert.equal(await page.textContent('#positions'), '11 of 12 page positions used');
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
    assert.equal(await page.getAttribute('#cell-12', 'aria-label'), 'Page 4, REVERB: empty');
    assert((await page.textContent('#status')).includes('Random intervals goes back to stock behaviour'));
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
    await page.click('#preset-drizzlet');
    await waitFingerprint(releaseFP);
    // Emptying from the inspector keeps keyboard focus on the position.
    await page.click('#cell-9');
    await page.click('#clear-position');
    await waitFingerprint(await fingerprint(encodeProfile(layout.unplace(defaults(release.profile), release.profile, 9, 'page'), release.profile)));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cell-9');
    await page.click('#preset-drizzlet');
    await waitFingerprint(releaseFP);
    assert.equal(await page.locator('#cpu').getAttribute('role'), null);
    assert.equal(await page.locator('#cpu-status').getAttribute('role'), 'status');
    assert((await page.textContent('#cpu-status')).length < 100);
    assert((await page.textContent('#cpu-short')).includes('provisional'));
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
    // Every feature returns to byte-identical Off state, including value/slots.
    await page.click('#preset-stock-plus-fixes');
    const stockFP = await fingerprint(encodeProfile(templates(release.profile)['Stock plus fixes'], release.profile));
    await waitFingerprint(stockFP);
    assert.equal(await page.textContent('#cpu'),
      '86.9% estimated. synth 86.9% estimated; granular 78.6% estimated. Provisional limit 92%. Within CPU limit.');
    assert.equal(await page.textContent('#positions'), '0 of 12 page positions used');
    const stockShare = await page.getAttribute('#share', 'href');
    const manifestURL = /\/manifest\.json(?:\?|$)/;
    // Missing costs still report the measured-default bound, without a percentage.
    const boundedManifest = JSON.parse(readFileSync(`${site}/manifest.json`));
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
    assert.equal(await page.textContent('#cpu'),
      'Within measured default; savings unmeasured.');
    assert(!/%|estimated/.test(await page.textContent('#cpu')));
    assert(!/%/.test(await page.textContent('#cpu-short')));
    await context.unroute(manifestURL, boundedRoute);
    // Preserve the enabled/unknown regression using an explicit Off-default fixture.
    const offManifest = JSON.parse(readFileSync(`${site}/manifest.json`));
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
      await until(async () => (await page.textContent('#cpu')).startsWith('CPU not measured for:'));
      assert((await page.textContent('#cpu')).includes(f.name));
      assert(!/%/.test(await page.textContent('#cpu')));
      assert.equal(await page.isDisabled('#build'), false);
      assert.equal(await page.isDisabled('#local'), false);
      assert.equal(await page.locator('body').evaluate((b) => b.classList.contains('cpu-warning')), false);
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
      assert.equal(await page.getAttribute('#guide', 'download'), 'options-guide-dev.svg');
      assert.equal(await page.getAttribute('#guide-mobile', 'download'), 'options-guide-dev-mobile.svg');
    }
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
    await page.click('#extra-18-place');
    await waitFingerprint(await fingerprint(encodeProfile(layout.place(defaults(release.profile), release.profile, 18, 'page', 10), release.profile)));
    await page.click('#preset-drizzlet');
    await waitFingerprint(releaseFP);
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
    assert.equal(await page.textContent('#cpu'), 'CPU not measured for: Pitch scale.');
    // Invalid input reports its error and leaves the valid profile intact.
    await page.evaluate(() => { location.hash = 'release=missing&profile=00'; });
    await until(async () => await page.getAttribute('#status', 'class') === 'error');
    assert.equal(await page.textContent('#fingerprint'), customFP);
    await page.evaluate((hash) => { location.hash = hash; }, share(release, releaseBlock));
    await waitFingerprint(releaseFP);
    assert.deepEqual(await pressed(), ['Drizzlet']);
    assert((await page.textContent('#cpu')).includes('87.2%'));
    assert.equal(await page.isDisabled('#build'), false);
    await context.unroute(manifestURL, unknownRoute);
    // Building the release default reproduces the release WAV, with its guides.
    if (name === 'chromium') {
      await page.click('#build');
      await until(async () => await page.isVisible('#result'));
      assert.equal(await page.getAttribute('#status', 'class'), 'ok');
      assert((await page.textContent('#status')).includes('Matches the release'));
      assert.equal(await page.textContent('#wav-hash'), release.wav_sha256);
      assert.equal(await page.getAttribute('#download', 'download'), `${release.tag}.wav`);
      assert(await page.isVisible('#guide'));
      assert(await page.isVisible('#guide-mobile'));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'result-title');
      assert((await page.textContent('#result')).includes('calibration'));
    }
    // Exact measured combinations take precedence even with a missing feature cost.
    const measuredManifest = JSON.parse(readFileSync(`${site}/manifest.json`));
    const measured = measuredManifest.releases[0];
    measured.profile.features.find((f) => f.id === 1).cpu = null;
    measured.cpu.combinations = [{ profile: profileKey(chosen, release.profile), synth: 90.4, granular: 89 }];
    const measuredRoute = (route) => route.fulfill({ json: measuredManifest });
    await context.route(manifestURL, measuredRoute);
    for (const [percent, blocked] of [[90.4, false], [92, false], [92.1, true]]) {
      measured.cpu.combinations[0].synth = percent;
      await page.goto(base + '#' + share(release, customBlock));
      await page.reload();
      await waitFingerprint(customFP);
      assert((await page.textContent('#cpu')).startsWith(`${percent.toFixed(1)}% measured.`));
      assert.equal(await page.isDisabled('#build'), blocked);
      assert.equal(await page.isDisabled('#local'), blocked);
      assert.equal(await page.locator('body').evaluate((b) => b.classList.contains('cpu-warning')), percent >= 91);
      assert.equal((await page.textContent('#cpu-short')).includes('build blocked'), blocked);
    }
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
    const counters = await browser.newContext();
    const counterRequests = [];
    await counters.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(base).origin) return route.continue();
      counterRequests.push(url.href);
      if (url.hostname === 'insolentconstruct.goatcounter.com' && url.pathname.startsWith('/counter/')) {
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
    console.log(`PASS ${name}: grid place/swap/replace/keyboard${name === 'chromium' ? '/drag and release WAV build' : ''}, phone tabs, every feature Fixed/Off exact bytes, extras, default names, unknown CPU costs, same-document share links and invalid-link recovery`);
  } finally { await browser.close(); }
}
