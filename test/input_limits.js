// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
// Oversized links, content and images are refused before they are parsed or decoded.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { defaults, encodeProfile, share, unshare, MAX_SHARE } from '../static/js/profile.js';
import { encodeContent, decodeContent, MAX_CONTENT } from '../static/js/content.js';
import { factoryTable } from '../static/js/wavetables.js';
import { MAX_GRIDS } from '../static/js/terrain.js';
import { imageSize, checkImageSize, MAX_PIXELS } from '../static/js/image_size.js';

const releases = JSON.parse(readFileSync(new URL('../static/manifest.json', import.meta.url))).releases;
const release = releases.at(-1);
const block = encodeProfile(defaults(release.profile), release.profile);

// The largest content the editor can save fits both limits with room to spare.
const terrains = Array.from({ length: MAX_GRIDS }, () => ({ equation: null, grid: new Int8Array(4096) }));
const largest = encodeContent({ wave: factoryTable(), terrains });
assert(largest.length > 200000 && largest.length * 3 / 2 < MAX_CONTENT, `largest content is ${largest.length} characters`);
assert.equal(decodeContent(largest).terrains.length, MAX_GRIDS);
const banks = Array.from({ length: 15 }, () => Array(8).fill(0));
const link = share(release, block, { selection: { wave: true, rings: true, models: Array.from({ length: 96 }, (_, i) => i), banks }, content: largest });
assert(link.length * 2 < MAX_SHARE, `largest link is ${link.length} characters`);

// A longer link stops at its length: the same text one character shorter reaches the parser.
const padded = (length) => `release=${release.tag}&profile=${'0'.repeat(length - release.tag.length - 17)}`;
assert.equal(padded(MAX_SHARE).length, MAX_SHARE);
assert.throws(() => unshare(padded(MAX_SHARE), releases), /Invalid share link/);
assert.throws(() => unshare(padded(MAX_SHARE + 1), releases), /Share link is too long/);
assert.throws(() => unshare('#' + padded(MAX_SHARE), releases), /Invalid share link/, 'the limit excludes the leading #');
assert.deepEqual(unshare(share(release, block), releases).entries, defaults(release.profile));

// Oversized content is refused unparsed: valid JSON of that length gives the size error, not a schema one.
const spaced = (length) => `{"v":2${' '.repeat(length - 7)}}`;
assert.throws(() => decodeContent(spaced(MAX_CONTENT)), /Unknown saved content/);
assert.throws(() => decodeContent(spaced(MAX_CONTENT + 1)), /Saved content is too large/);
assert.throws(() => decodeContent('{'.repeat(MAX_CONTENT)), SyntaxError, 'text within the limit reaches the parser');
assert.throws(() => decodeContent('{'.repeat(MAX_CONTENT + 1)), /Saved content is too large/);
// A link can carry any JSON as content: only text is parsed, so an array cannot hide its length.
for (const other of [[largest], [spaced(MAX_CONTENT + 1)], null, 1, {}]) assert.throws(() => decodeContent(other), /Unknown saved content/);

// Image sizes come from the header alone.
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};
function png(width, height, rows = height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(rows * (width + 1)))), chunk('IEND', Buffer.alloc(0))]));
}
assert.deepEqual(imageSize(png(3, 2)), { width: 3, height: 2 });
assert.deepEqual(imageSize(png(3, 2).subarray(0, 24)), { width: 3, height: 2 }, 'the header is enough');
assert.equal(imageSize(png(3, 2).subarray(0, 23)), null);
assert.equal(imageSize(Uint8Array.from(png(3, 2), (v, i) => i === 11 ? 12 : v)), null, 'an IHDR of the wrong length');
// GIF: a screen, an optional colour table, extensions to step over, then the first frame's left, top, width and height.
const le = (...values) => values.flatMap((v) => [v & 255, v >> 8]);
const gif = (width, height, frame = [0, 0, width, height], table = 0) => Uint8Array.from([...Buffer.from('GIF89a'), ...le(width, height),
  table ? 0x80 | (table - 1) : 0, 0, 0, ...Array(table ? 3 << table : 0).fill(0), 0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x21, 0xfe, 2, 65, 66, 1, 67, 0,
  0x2c, ...le(...frame), 0]);
assert.deepEqual(imageSize(gif(640, 480)), { width: 640, height: 480 });
assert.deepEqual(imageSize(gif(640, 480, [0, 0, 640, 480], 8)), { width: 640, height: 480 }, 'past a 256-colour table');
assert.deepEqual(imageSize(gif(1, 1, [10, 20, 5000, 4000])), { width: 5010, height: 4020 }, 'a first frame beyond the screen counts');
assert.deepEqual(imageSize(gif(1, 1, [10, 20, 5000, 4000], 8)), { width: 5010, height: 4020 }, 'and is found past a colour table');
assert.deepEqual(imageSize(gif(640, 480).subarray(0, 13)), { width: 640, height: 480 });
assert.equal(imageSize(gif(640, 480).subarray(0, 12)), null);
assert.equal(imageSize(gif(640, 480).subarray(0, -1)), null, 'a frame descriptor cut short');
assert.equal(imageSize(Uint8Array.from([...gif(640, 480).subarray(0, 13), 0x21, 0xfe, 5, 65])), null, 'an extension cut short');
assert.throws(() => checkImageSize(gif(1, 1, [0, 0, 65535, 65535])), /16 megapixels/);
// JPEG: SOI, fill bytes, an APP0 and a DHT segment to step over, then the frame header (baseline or progressive).
const jpeg = (width, height, frame = 0xc0) => Uint8Array.from([0xff, 0xd8, 0xff, 0xff, 0xe0, 0, 4, 0xff, 0xc0, 0xff, 0xc4, 0, 3, 9,
  0xff, frame, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]);
assert.deepEqual(imageSize(jpeg(4032, 3024)), { width: 4032, height: 3024 });
assert.deepEqual(imageSize(jpeg(300, 200, 0xc2)), { width: 300, height: 200 });
assert.equal(imageSize(jpeg(300, 200).subarray(0, 20)), null, 'a frame header cut short');
assert.equal(imageSize(jpeg(300, 200).subarray(0, 26)), null, 'a frame header without all its components');
assert.equal(imageSize(Uint8Array.from(jpeg(300, 200), (v, i) => i === 23 ? 0 : v)), null, 'a frame header with no components');
for (const [marker, why] of [[0xda, 'a scan'], [0xd9, 'the end']]) {
  assert.equal(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, marker, 0, 2, ...jpeg(300, 200).subarray(14)])), null, `${why} before any frame header`);
}
assert.equal(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, ...jpeg(300, 200).subarray(14)])), null, 'a segment shorter than its length field');
assert.equal(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 7, 8, 0, 200, 1, 44, 1, 1])), null, 'a frame header too short for its size');
for (const other of ['', 'RIFF....WEBPVP8 ', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'BM']) {
  assert.equal(imageSize(new Uint8Array(Buffer.from(other))), null);
  assert.throws(() => checkImageSize(new Uint8Array(Buffer.from(other))), /Use a PNG, JPEG or GIF image/);
}
assert.equal(MAX_PIXELS, 4096 * 4096);
assert.deepEqual(checkImageSize(jpeg(4096, 4096)), { width: 4096, height: 4096 });
for (const [width, height] of [[4097, 4096], [65535, 65535], [0, 10], [10, 0]]) {
  assert.throws(() => checkImageSize(jpeg(width, height)), /16 megapixels/);
}
assert.throws(() => checkImageSize(png(0x7fffffff, 0x7fffffff, 0)), /16 megapixels/);
console.log(`input limits: ok (largest content ${largest.length}, largest link ${link.length} characters)`);
