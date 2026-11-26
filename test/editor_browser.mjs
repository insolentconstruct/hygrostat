// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
import { chromium, firefox, webkit } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:8080/';
const until = async (test) => { for (let i = 0; i < 100; ++i) { if (await test()) return; await new Promise((done) => setTimeout(done, 100)); } throw new Error('Timed out waiting for editor.'); };
const wav = Buffer.alloc(44 + 600 * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(1200, 40);
for (let i = 0; i < 600; ++i) wav.writeInt16LE(Math.round(30000 * Math.sin(2 * Math.PI * i / 600)), 44 + i * 2);

// A greyscale PNG of black pixels; rows may be fewer than the header claims.
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};
const png = (width, height, rows = height) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(rows * (width + 1)))), chunk('IEND', Buffer.alloc(0))]);
};

for (const [name, engine] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.origin !== new URL(base).origin ? route.abort('internetdisconnected') : route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + 'editor.html');
    await until(async () => await page.locator('#wave-grid button').count() === 16);
    assert.equal(await page.locator('#bank option').count(), 12);
    assert.equal(await page.locator('#wave-grid button').count(), 16);
    assert.deepEqual(errors, []);
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('hygrostat-content')));
    const canvas = page.locator('#wave-draw');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    assert(box);
    await page.mouse.move(box.x + 8, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 8, box.y + box.height * 0.75, { steps: 32 });
    await page.mouse.up();
    await until(async () => (await page.getAttribute('#wave-grid button[aria-pressed="true"]', 'aria-label')).endsWith(', edited'));
    assert.notEqual((await stored())?.wave, null);
    assert.equal(typeof (await stored()).wave, 'string');
    await page.getByRole('button', { name: 'Reset all', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('hygrostat-content')), null);
    assert.equal(await page.getAttribute('#wave-grid button[aria-pressed="true"]', 'aria-label'), 'Wave 1');
    await page.focus('#wave-draw');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    await until(async () => (await page.textContent('#wave-status')) === 'Samples 17 to 32 moved up.');
    assert((await page.getAttribute('#wave-grid button[aria-pressed="true"]', 'aria-label')).endsWith(', edited'));
    await page.getByRole('button', { name: 'Reset all', exact: true }).click();
    await page.fill('#equation', 'sin(5 * (y + theta))');
    await page.click('#terrain-add');
    assert.equal(await page.locator('#terrain-list button').count(), 1);
    assert.equal(await page.textContent('#terrain-count'), '1 of 16');
    for (const equation of ['sin(', 'constructor']) {
      await page.fill('#equation', equation);
      await page.click('#terrain-add');
      assert(await page.locator('#terrain-status').evaluate((element) => element.classList.contains('error')));
      assert((await page.textContent('#terrain-status')).trim().length > 0);
      assert.equal(await page.locator('#terrain-list button').count(), 1);
      assert.equal(await page.textContent('#terrain-count'), '1 of 16');
    }
    await page.setInputFiles('#wav-file', { name: 'sine.wav', mimeType: 'audio/wav', buffer: wav });
    await until(async () => await page.textContent('#wave-status') === 'Imported 1 wave.');
    assert.equal(await page.locator('#wave-status.error').count(), 0);
    await page.setInputFiles('#wav-file', { name: 'invalid.wav', mimeType: 'audio/wav', buffer: Buffer.from('not a WAV') });
    await until(async () => await page.locator('#wave-status.error').count() === 1);
    assert.match(await page.textContent('#wave-status'), /invalid\.wav:/);
    await page.setInputFiles('#table-file', { name: 'short.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(17) });
    await until(async () => (await page.textContent('#wave-status')).includes('short.bin:'));
    assert.equal(await page.locator('#wave-status.error').count(), 1);
    assert.match(await page.textContent('#wave-status'), /bytes/);
    const savedTerrain = (await stored()).terrain;
    assert.equal(typeof savedTerrain, 'string');
    await page.reload();
    await until(async () => await page.locator('#terrain-list button').count() === 1);
    assert.equal(await page.textContent('#terrain-count'), '1 of 16');
    assert.equal(await page.getAttribute('#terrain-list button', 'aria-label'), 'Terrain 1: sin(5 * (y + theta))');
    assert.equal((await stored()).terrain, savedTerrain);
    // An image's header gives its size before any decoding; oversized or unknown files are refused.
    await page.setInputFiles('#image-file', { name: 'small.png', mimeType: 'image/png', buffer: png(8, 8) });
    await until(async () => await page.textContent('#terrain-status') === 'Image added.');
    assert.equal(await page.textContent('#terrain-count'), '2 of 16');
    await page.setInputFiles('#image-file', { name: 'huge.png', mimeType: 'image/png', buffer: png(20000, 20000, 1) });
    await until(async () => await page.textContent('#terrain-status') === 'huge.png: Images are 16 megapixels at most.');
    await page.setInputFiles('#image-file', { name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await until(async () => await page.textContent('#terrain-status') === 'notes.png: Use a PNG, JPEG or GIF image.');
    assert.equal(await page.textContent('#terrain-count'), '2 of 16');
    assert.equal(await page.locator('main').count(), 1, 'the editor has a main landmark');
    // A fragment too long to hold content is not parsed; the saved content still opens. Other engines cap URLs lower.
    if (name === 'chromium') {
      await page.evaluate(() => { location.hash = 'unused=' + 'a'.repeat(1200001); });
      await page.reload();
      await until(async () => await page.textContent('#wave-status') === 'This link is too long to open.');
      assert.equal(await page.textContent('#terrain-count'), '2 of 16');
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${name}: wave drawing, reset, terrain validation, WAV/table imports and persistence`);
  } finally { await browser.close(); }
}
