// Copyright 2026 Insolent Construct.
// MIT licence: see ../static/js/encoder.js.
//
// The page, offered the staged RC1 entry by a routed release list, downloads the
// release WAV and the qualification custom WAV byte for byte. Nothing is published.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { decode } from '../static/js/decoder.js';
const base = process.env.BASE || 'http://127.0.0.1:8080/';
const read = (path) => readFileSync(new URL(path, import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(read('../static/manifest.json'));
const staged = JSON.parse(read('../releases/rc1-development.json'));
const custom = JSON.parse(read('fixtures/rc1-custom.json'));
assert(!manifest.releases.some((r) => r.tag === staged.tag) && staged.app === undefined, 'The staged entry is not offered');
// The staged image is outside the served tree: this test alone routes it to the page.
const app = `images/${staged.tag}/app.bin`;
const offered = { ...manifest, releases: [...manifest.releases, { ...staged, app }] };
const fragment = new URLSearchParams({ release: staged.tag, profile: custom.profile, setup: JSON.stringify(custom.setup) });
const fingerprint = custom.sha256['profile.bin'].slice(0, 8);
const cases = [
  { name: 'release', hash: '', app: staged.app_sha256, wav: staged.wav_sha256, file: `${staged.tag}.wav`,
    status: 'Ready. Matches the release; audio checked.' },
  { name: 'custom', hash: '#' + fragment, app: custom.sha256['app.bin'], wav: custom.sha256['app.wav'],
    file: `${staged.tag}-${fingerprint}.wav`, status: `Ready. Profile ${fingerprint}; audio checked.`,
    image: custom.sha256['image.bin'], size: custom.image_size }
];
const until = async (test, what) => {
  for (let i = 0; i < 1800; ++i) { if (await test()) return; await new Promise((done) => setTimeout(done, 100)); }
  throw new Error(`Timed out waiting for ${what}.`);
};
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await engine.launch();
  try {
    for (const expected of cases) {
      // A fresh context each time: no draft or editor content carries over.
      const context = await browser.newContext({ acceptDownloads: true });
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(base).origin) return route.abort('internetdisconnected');
        if (url.pathname.endsWith('/manifest.json')) return route.fulfill({ json: offered });
        if (url.pathname.endsWith('/' + app)) return route.fulfill({ body: read(`../releases/${staged.tag}/app.bin`), contentType: 'application/octet-stream' });
        return route.continue();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base + expected.hash);
      await until(async () => await page.locator('#build').isEnabled() &&
        await page.getAttribute('#summary', 'data-fingerprint'), 'the editor');
      assert.equal(await page.inputValue('#release'), staged.tag);
      assert(await page.isVisible('#development'), 'marked as a development build');
      await page.click('#build');
      await until(async () => await page.isVisible('#result') || await page.getAttribute('#status', 'class') === 'error', 'the build');
      assert.equal(await page.textContent('#status'), expected.status);
      assert.equal(await page.textContent('#app-hash'), expected.app);
      assert.equal(await page.textContent('#wav-hash'), expected.wav);
      assert.equal(await page.textContent('#expected-hash'), staged.wav_sha256);
      assert.equal(await page.getAttribute('#download', 'download'), expected.file);
      assert.equal(await page.textContent('#test-status'), 'Development build, not a release.');
      const download = page.waitForEvent('download');
      await page.click('#download');
      const wav = readFileSync(await (await download).path());
      assert.equal(sha256(wav), expected.wav, `${expected.name}: the downloaded file is the expected WAV`);
      if (expected.image) assert.equal(sha256(decode(wav, expected.size)), expected.image, 'the custom WAV decodes to its image');
      await page.click('#browse');
      await page.click('#lib-4');
      assert.match(await page.textContent('#action-help'), /Switch to Spectral from Granular, Oliverb or Abyss/);
      assert.deepEqual(errors, []);
      console.log(`PASS ${name}: ${expected.name} WAV ${expected.wav} (${wav.length} bytes)`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
