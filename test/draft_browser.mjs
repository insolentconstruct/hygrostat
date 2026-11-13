// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// The setup kept across reloads, in Chromium, Firefox and WebKit. Run like test/browser.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';
const base = process.env.BASE || 'http://127.0.0.1:8080/';
const site = process.env.SITE || '/site';
const release = JSON.parse(readFileSync(`${site}/manifest.json`)).releases.at(-1);
const { encodeProfile, defaults, share, unshare, templates } = await import(pathToFileURL(resolve(site, 'js/profile.js')).href);
const keys = ['hygrostat-draft', 'hygrostat-draft-before-link', 'hygrostat-draft-refused'];
const stored = (page) => page.evaluate((keys) => keys.map((k) => localStorage.getItem(k)), keys);
const spectral = share(release, encodeProfile(templates(release.profile).Spectral, release.profile));

for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const requests = [];
    context.on('request', (request) => requests.push(`${request.url()} ${request.postData() || ''}`));
    await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ?
      route.continue() : route.abort('internetdisconnected'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const until = async (predicate) => {
      const deadline = Date.now() + 30000;
      while (!await predicate()) {
        assert(Date.now() < deadline, 'timed out waiting for page state');
        await new Promise((done) => setTimeout(done, 50));
      }
    };
    const ready = () => until(async () => await page.getAttribute('#summary', 'data-fingerprint'));
    const shareHref = () => page.getAttribute('#share', 'href');
    const shown = async () => unshare(await shareHref(), [release]);
    const noticeText = () => page.textContent('#draft-notice');
    await page.goto(base);
    await ready();
    assert.equal(await page.isHidden('#draft-notice'), true, 'nothing to restore on a first visit');
    assert.deepEqual(await stored(page), [null, null, null]);

    // Edit, reload: the setup and its starting point come back with a notice.
    await page.click('#more-templates');
    await page.click('#template-pitched-grains');
    await page.click('#use-template');
    await page.getByRole('button', { name: 'Remove Pelog', exact: true }).click();
    await until(async () => (await shown()).scales?.length === 7);
    const own = await shareHref();
    assert.equal(JSON.parse((await stored(page))[0]).share, own.slice(1));
    assert.equal(JSON.parse((await stored(page))[0]).preset, 'Pitched grains');
    // The real worker builds the same WAV before and after the reload.
    const wav = async () => {
      await page.click('#build');
      await until(async () => await page.isVisible('#result') || await page.getAttribute('#status', 'class') === 'error');
      assert.equal(await page.getAttribute('#status', 'class'), 'ok');
      return page.textContent('#wav-hash');
    };
    const before = name === 'chromium' ? await wav() : null;
    await page.reload();
    await ready();
    assert.equal(await shareHref(), own, 'restored byte for byte, scale bank included');
    if (before) assert.equal(await wav(), before, 'same WAV after reload');
    assert.match(await noticeText(), /Restored your last setup \(saved /);
    assert.match(await page.textContent('#changes'), /from Pitched grains/);
    assert.equal(await page.evaluate(() => location.hash), '');

    // A shared link wins and leaves the draft alone; Open it brings the own setup back.
    await page.goto(base + '#' + spectral);
    await until(async () => await shareHref() === '#' + spectral);
    assert.match(await noticeText(), /Opened a shared setup\. Your last setup is still saved\./);
    assert.equal(JSON.parse((await stored(page))[0]).share, own.slice(1));
    await page.click('#draft-open');
    await until(async () => await shareHref() === own);
    assert.equal(await page.evaluate(() => location.hash), '');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'preset-drizzlet');

    // Editing a shared setup removes the fragment and keeps the own setup in the second slot.
    await page.goto(base + '#' + spectral);
    await until(async () => await shareHref() === '#' + spectral);
    await page.click('#extra-15');
    await until(async () => await shareHref() !== '#' + spectral);
    const editedLink = await shareHref();
    assert.equal(await page.evaluate(() => location.hash), '', 'first edit removes the fragment');
    let [draft, aside] = await stored(page);
    assert.equal(JSON.parse(aside).share, own.slice(1));
    assert.equal(JSON.parse(draft).share, editedLink.slice(1));
    await page.reload();
    await ready();
    assert.equal(await shareHref(), editedLink, 'reload restores the edit, not the link');
    assert.match(await noticeText(), /Another saved setup is also kept/);
    await page.click('#draft-open');
    await until(async () => await shareHref() === own);
    [draft, aside] = await stored(page);
    assert.equal(JSON.parse(draft).share, own.slice(1), 'opened setup becomes the draft');
    assert.equal(JSON.parse(aside).share, editedLink.slice(1), 'and the edited link is kept');
    // A link equal to the draft offers the second slot, and Open it opens that slot.
    await page.goto(base + own);
    await until(async () => await page.evaluate(() => location.hash) === own);
    assert.doesNotMatch(await noticeText(), /Your last setup is still saved/);
    await page.click('#draft-open');
    await until(async () => await shareHref() === editedLink);
    await page.click('#draft-open');
    await until(async () => await shareHref() === own);
    await page.click('#draft-before-discard');
    assert.equal((await stored(page))[1], null);

    // Start fresh, then Undo.
    await page.reload();
    await ready();
    const kept = (await stored(page))[0];
    await page.click('#draft-fresh');
    await until(async () => (await shown()).scales === null && await shareHref() !== own);
    assert.deepEqual((await shown()).entries, defaults(release.profile));
    assert.equal((await stored(page))[0], null);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'preset-drizzlet');
    await page.click('#draft-undo');
    await until(async () => await shareHref() === own);
    assert.equal((await stored(page))[0], kept);

    // Forget removes everything and leaves the screen alone; the next edit is kept again.
    await page.click('#forget-draft');
    assert.deepEqual(await stored(page), [null, null, null]);
    assert.equal(await shareHref(), own);
    await page.click('#extra-15');
    await until(async () => (await stored(page))[0] !== null);
    await page.evaluate(() => localStorage.clear());

    // A draft this page cannot open is kept aside with Copy and Discard.
    const refused = JSON.stringify({ ...JSON.parse(kept), format: release.profile.format + 1 });
    await page.evaluate((text) => localStorage.setItem('hygrostat-draft', text), refused);
    await page.reload();
    await ready();
    assert.match(await noticeText(), /can’t be opened by this page\./);
    assert.deepEqual(await stored(page), [null, null, refused]);
    assert.deepEqual((await shown()).entries, defaults(release.profile), 'starts fresh');
    // A second one cannot be set aside: it stays where it is and saving pauses.
    await page.evaluate((text) => localStorage.setItem('hygrostat-draft', text), refused.replace('"v":1', '"v":9'));
    await page.reload();
    await ready();
    assert.match(await noticeText(), /Saving is paused until you discard it\./);
    await page.click('#extra-15');
    await page.waitForTimeout(200);
    assert.equal((await stored(page))[0], refused.replace('"v":1', '"v":9'), 'paused saving keeps it');
    // Discard drops the edit made while paused; selecting a cell saves nothing.
    await page.click('#draft-discard-1');
    await page.click('#cell-1');
    await page.waitForTimeout(200);
    assert.equal((await stored(page))[0], null);
    await page.click('#draft-discard-0');
    assert.deepEqual(await stored(page), [null, null, null]);
    assert.equal(await page.isHidden('#draft-notice'), true);
    // A refused second slot that cannot be set aside is the one offered for Discard, not the draft.
    await page.evaluate(([good, bad]) => {
      localStorage.setItem('hygrostat-draft', good);
      localStorage.setItem('hygrostat-draft-before-link', bad);
      localStorage.setItem('hygrostat-draft-refused', '{x');
    }, [kept, refused]);
    await page.reload();
    await ready();
    assert.match(await noticeText(), /Restored your last setup/);
    assert.equal(await page.locator('#draft-open').count(), 0, 'a refused second slot is not offered');
    assert.equal(await page.locator('#draft-notice p', { hasText: 'can’t be opened' }).count(), 2);
    await page.click('#draft-discard-1');
    assert.deepEqual(await stored(page), [kept, null, '{x']);
    await page.click('#draft-discard-0');
    assert.deepEqual(await stored(page), [kept, null, null]);
    // The reverse: a held draft swapped into the second slot stays the one offered for Discard.
    await page.evaluate(([good, bad]) => {
      localStorage.setItem('hygrostat-draft', bad);
      localStorage.setItem('hygrostat-draft-before-link', good);
      localStorage.setItem('hygrostat-draft-refused', '{x');
    }, [kept, refused]);
    await page.reload();
    await ready();
    await page.click('#draft-open');
    await until(async () => await shareHref() === own);
    assert.deepEqual(await stored(page), [kept, refused, '{x']);
    await page.click('#draft-discard-1');
    assert.deepEqual(await stored(page), [kept, null, '{x']);
    // A refused second slot is set aside on load, so a link edit cannot replace it unseen.
    await page.evaluate(([good, bad]) => {
      localStorage.clear();
      localStorage.setItem('hygrostat-draft', good);
      localStorage.setItem('hygrostat-draft-before-link', bad);
    }, [kept, refused]);
    await page.reload();
    await ready();
    assert.deepEqual(await stored(page), [kept, null, refused]);
    await page.goto(base + '#' + spectral);
    await until(async () => await shareHref() === '#' + spectral);
    await page.click('#extra-15');
    await until(async () => (await stored(page))[1] !== null);
    assert.deepEqual((await stored(page)).filter((_, i) => i), [kept, refused]);
    // Likewise a refused draft when the page opens on a link: it never reaches the second slot.
    await page.evaluate(([good, bad]) => {
      localStorage.clear();
      localStorage.setItem('hygrostat-draft', bad);
      localStorage.setItem('hygrostat-draft-before-link', good);
    }, [kept, refused]);
    await page.goto(base + '#' + spectral);
    await page.reload();
    await until(async () => await shareHref() === '#' + spectral);
    assert.deepEqual(await stored(page), [null, kept, refused]);
    await page.click('#extra-15');
    await until(async () => (await stored(page))[0] !== null);
    assert.deepEqual((await stored(page)).filter((_, i) => i), [kept, refused]);
    await page.evaluate(() => localStorage.clear());

    // Nothing persisted leaves the browser.
    const bank = (await shown()).scales;
    const profileHex = new URLSearchParams(own.slice(1)).get('profile');
    for (const request of requests) {
      assert(!request.includes(profileHex.slice(32, 96)), `profile bytes sent: ${request.slice(0, 80)}`);
      assert(!request.includes('hygrostat-draft'));
      for (const scale of bank || []) assert(!request.includes(encodeURIComponent(scale.name)));
    }
    assert.deepEqual(errors, []);
    await context.close();

    // Blocked storage: the page still works and edits without errors.
    for (const blocked of ['read', 'write']) {
      const isolated = await browser.newContext();
      await isolated.route('**/*', (route) => new URL(route.request().url()).origin === new URL(base).origin ?
        route.continue() : route.abort('internetdisconnected'));
      await isolated.addInitScript((blocked) => {
        if (blocked === 'read') Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });
        else Storage.prototype.setItem = () => { throw new Error('storage writes blocked'); };
      }, blocked);
      const check = await isolated.newPage();
      const failures = [];
      check.on('pageerror', (error) => failures.push(String(error)));
      await check.goto(base);
      await until(async () => await check.getAttribute('#summary', 'data-fingerprint'));
      await check.click('#extra-15');
      await check.waitForTimeout(200);
      assert.equal(await check.isDisabled('#build'), false);
      if (blocked === 'write') assert.match(await check.textContent('#draft-notice'), /not keeping your setup/);
      if (name === 'chromium') {
        await check.click('#build');
        await until(async () => await check.isVisible('#result') || await check.getAttribute('#status', 'class') === 'error');
        assert.equal(await check.getAttribute('#status', 'class'), 'ok', `${blocked}: builds without storage`);
      }
      assert.deepEqual(failures, []);
      await isolated.close();
    }
    console.log(`PASS ${name}: setup kept across reloads, links, Start fresh, Undo, Forget, refusals, blocked storage.`);
  } finally { await browser.close(); }
}
