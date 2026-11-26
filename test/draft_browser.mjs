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
const earlier = JSON.parse(readFileSync(`${site}/manifest.json`)).releases.at(-2);
const { encodeContent } = await import(pathToFileURL(resolve(site, 'js/content.js')).href);
const spectralDraft = JSON.stringify({ v: 1, saved: 1, share: share(release, encodeProfile(templates(release.profile).Spectral, release.profile)),
  name: release.name, version: release.profile.version, format: release.profile.format });
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
    await page.click('#scale-panel > summary');
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
    // While saving is paused, a Firmware change says that nothing saved changes.
    await page.selectOption('#release', earlier.tag);
    assert.match(await page.textContent('#release-keep'), /^Saving is paused: nothing saved in this browser changes$/);
    await page.click('#release-cancel');
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

    // A Firmware change asks before replacing a customised setup, and keeps it to reopen.
    await page.goto(base);
    await ready();
    const untouched = await shareHref();
    await page.click('#extra-15');
    await until(async () => ![untouched, null].includes(await shareHref()) && (await stored(page))[0] !== null);
    const custom = await shareHref();
    const mine = (await stored(page))[0];
    assert.equal(JSON.parse(mine).share, custom.slice(1));
    await page.selectOption('#release', earlier.tag);
    assert.equal(await page.isVisible('#release-confirm'), true, 'a customised setup is not replaced at once');
    assert.match(await page.textContent('#release-confirm-text'), new RegExp(`Switch to ${earlier.name}\\?`));
    assert.equal(await page.inputValue('#release'), release.tag, 'the list shows the firmware still on screen');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'release-switch');
    assert.match(await page.textContent('#release-keep'), /stays saved in this browser to reopen/);
    assert.equal(await shareHref(), custom);
    await page.click('#release-cancel');
    assert.equal(await page.isVisible('#release-confirm'), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'release');
    assert.deepEqual(await stored(page), [mine, null, null]);
    await page.selectOption('#release', earlier.tag);
    await page.click('#release-switch');
    const defaultsHref = '#' + share(earlier, encodeProfile(defaults(earlier.profile), earlier.profile));
    await until(async () => await shareHref() === defaultsHref);
    assert.equal(await page.inputValue('#release'), earlier.tag);
    assert.equal(await page.isVisible('#release-confirm'), false);
    assert.equal((await stored(page))[1], mine, 'the replaced setup is kept in the second slot');
    assert.match(await noticeText(), /Another saved setup is also kept\./);
    await page.click('#draft-open');
    await until(async () => await shareHref() === custom);
    assert.equal(await page.inputValue('#release'), release.tag);
    // The prompt says when Switch replaces another saved setup; a copy that fails changes nothing.
    await ready();
    assert.deepEqual((await stored(page)).map(Boolean), [true, true, false]);
    const [, other] = await stored(page);
    await page.selectOption('#release', earlier.tag);
    assert.match(await page.textContent('#release-keep'), /replacing the other saved setup/);
    await page.evaluate(() => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key === 'hygrostat-draft-before-link') throw new Error('full');
        setItem.call(this, key, value);
      };
      window.restoreStorage = () => { Storage.prototype.setItem = setItem; };
    });
    await page.click('#release-switch');
    assert.match(await page.textContent('#status'), /could not keep your setup/);
    assert.equal(await page.inputValue('#release'), release.tag);
    assert.equal(await page.isVisible('#release-confirm'), true);
    assert.deepEqual(await stored(page), [mine, other, null]);
    assert.equal(await shareHref(), custom);
    await page.evaluate(() => window.restoreStorage());
    // Saved setups that change under the prompt, as from another tab, are shown before anything is replaced:
    // first one the prompt's wording cannot tell apart, then one it can.
    await page.evaluate((text) => localStorage.setItem('hygrostat-draft-before-link', text), spectralDraft);
    await page.click('#release-switch');
    assert.match(await page.textContent('#status'), /saved setups changed/);
    assert.match(await page.textContent('#release-keep'), /replacing the other saved setup/);
    assert.equal(await page.inputValue('#release'), release.tag);
    assert.deepEqual(await stored(page), [mine, spectralDraft, null]);
    await page.click('#extra-16');
    await until(async () => (await stored(page))[0] !== mine);
    await page.click('#extra-16');
    await until(async () => JSON.parse((await stored(page))[0]).share === custom.slice(1));
    assert.doesNotMatch(await page.textContent('#status'), /saved setups changed/);
    await page.evaluate(() => localStorage.removeItem('hygrostat-draft-before-link'));
    await page.click('#release-switch');
    assert.match(await page.textContent('#status'), /saved setups changed/);
    assert.match(await page.textContent('#release-keep'), /stays saved in this browser to reopen$/);
    assert.equal(await page.inputValue('#release'), release.tag);
    assert.deepEqual((await stored(page)).slice(1), [null, null]);
    await page.click('#release-cancel');
    // An opened link is not the saved draft: the prompt says the last saved setup is the one kept.
    await page.goto(base + '#' + spectral);
    await until(async () => await shareHref() === '#' + spectral);
    await page.selectOption('#release', earlier.tag);
    assert.match(await page.textContent('#release-keep'), /^This setup is not saved; your last saved setup stays in this browser to reopen$/);
    const [last] = await stored(page);
    await page.click('#release-switch');
    await until(async () => await shareHref() === defaultsHref);
    assert.equal((await stored(page))[1], last);
    assert.equal(JSON.parse(last).share, custom.slice(1));
    assert.match(await noticeText(), /Another saved setup is also kept\./);
    // A starting point has nothing to lose: the change is immediate, and editor content never follows it.
    await page.evaluate(() => localStorage.clear());
    await page.goto(base);
    await ready();
    await page.selectOption('#release', earlier.tag);
    await until(async () => await shareHref() === defaultsHref);
    assert.equal(await page.isVisible('#release-confirm'), false);
    assert.deepEqual((await stored(page)).slice(1), [null, null]);

    // Content saved by the editor tab is ignored by firmware without a region: the page still builds.
    await page.evaluate((raw) => {
      localStorage.setItem('hygrostat-content', raw);
      window.dispatchEvent(new StorageEvent('storage', { key: 'hygrostat-content', newValue: raw }));
    }, encodeContent({ terrains: [{ equation: null, grid: new Int8Array(4096) }] }));
    await page.click('#extra-15');
    await until(async () => await shareHref() !== defaultsHref && await shareHref() !== null);
    assert.notEqual(await page.getAttribute('#status', 'class'), 'error', await page.textContent('#status'));
    assert.equal(await page.isDisabled('#build'), false);
    assert(!(await shareHref()).includes('setup='), 'no editor content in the shared setup');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await ready();

    // Nothing persisted leaves the browser.
    const bank = unshare(own, [release]).scales;
    assert.equal(bank.length, 7);
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
