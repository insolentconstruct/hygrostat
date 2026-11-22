// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// MIT licence: see encoder.js.
//
// ST-Link combo images, as the release build makes them: the pinned bootloader
// padded to 0x20000 bytes then the app (combo .bin, at 0x08000000), and
// stmlib's merged Intel HEX of the same bytes (objcopy's app HEX, then the
// bootloader's, one end-of-file record).

import { equal, sha256 } from './profile.js?v=2f429fcab2a9a7f7';

export const COMBO_ADDRESS = 0x08000000;
export const BOOTLOADER_SIZE = 0x20000;
const EOF = ':00000001FF\n';
const HEX = Array.from({ length: 256 }, (_, v) => v.toString(16).toUpperCase().padStart(2, '0'));

function record(type, address, data) {
  let sum = data.length + (address >> 8) + (address & 0xff) + type;
  let text = ':' + HEX[data.length] + HEX[address >> 8] + HEX[address & 0xff] + HEX[type];
  for (const v of data) {
    sum += v;
    text += HEX[v];
  }
  return text + HEX[-sum & 0xff] + '\r\n';
}

const word = (v) => [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

// One objcopy HEX file: each range in 16-byte records that never cross 64 KiB,
// an extended linear address record per 64 KiB, then the start address.
function objcopyHex(image, part) {
  const lines = [];
  let upper = -1;
  let next = COMBO_ADDRESS;
  for (const [first, size] of part.ranges) {
    const from = parseInt(first, 16);
    if (!/^[0-9a-f]{8}$/i.test(first) || from < next || !Number.isInteger(size) || size <= 0 ||
        from + size > COMBO_ADDRESS + image.length) {
      throw new Error('Invalid combo HEX layout.');
    }
    for (let where = from, end = from + size; where < end;) {
      if (where >>> 16 !== upper) {
        upper = where >>> 16;
        lines.push(record(4, 0, [upper >> 8, upper & 0xff]));
      }
      const now = Math.min(16, end - where, 0x10000 - (where & 0xffff));
      const offset = where - COMBO_ADDRESS;
      lines.push(record(0, where & 0xffff, image.subarray(offset, offset + now)));
      where += now;
    }
    next = from + size;
  }
  if (!/^[0-9a-f]{8}$/i.test(part.start) || parseInt(part.start, 16) <= 0xfffff) {
    throw new Error('Invalid combo HEX start address.');
  }
  lines.push(record(5, 0, word(parseInt(part.start, 16))));
  return lines.join('');
}

export function comboHex(image, layout) {
  if (!Array.isArray(layout) || !layout.length) throw new Error('Invalid combo HEX layout.');
  return layout.map((part) => objcopyHex(image, part)).join('') + EOF;
}

// Lowest address and contents, gaps filled with zero as objcopy -O binary does.
// Checks each record's syntax, length, checksum and type, and a single final EOF.
export function parseHex(text) {
  const lines = text.split('\n');
  if (lines.pop() !== '' || lines.at(-1) !== ':00000001FF') throw new Error('HEX: missing end-of-file record.');
  lines.pop();
  const chunks = [];
  const starts = [];
  let upper = 0;
  for (const [n, raw] of lines.entries()) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!/^:([0-9A-F]{2})+$/.test(line) || line.length < 11) throw new Error(`HEX: bad record on line ${n + 1}.`);
    const bytes = Uint8Array.from(line.slice(1).match(/../g), (v) => parseInt(v, 16));
    const [length, high, low, type] = bytes;
    if (bytes.length !== length + 5 || bytes.reduce((a, v) => a + v, 0) & 0xff) {
      throw new Error(`HEX: bad length or checksum on line ${n + 1}.`);
    }
    const data = bytes.subarray(4, 4 + length);
    if (type === 0) chunks.push([upper + (high << 8 | low), data]);
    else if (type === 4 && length === 2 && !high && !low) upper = (data[0] << 24 | data[1] << 16) >>> 0;
    else if (type === 5 && length === 4 && !high && !low) starts.push(((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0);
    else throw new Error(`HEX: unexpected record type ${type} on line ${n + 1}.`);
  }
  if (!chunks.length) throw new Error('HEX: no data.');
  chunks.sort((a, b) => a[0] - b[0]);
  const address = chunks[0][0];
  const last = chunks.at(-1);
  const bytes = new Uint8Array(last[0] + last[1].length - address);
  let end = address;
  for (const [at, data] of chunks) {
    if (at < end) throw new Error('HEX: overlapping records.');
    bytes.set(data, at - address);
    end = at + data.length;
  }
  return { address, bytes, starts };
}

// The combo .bin and .hex for an app image; refuses a bootloader other than the
// pinned one and a HEX that does not program exactly the .bin at 0x08000000.
export async function comboImages(release, bootloader, app) {
  const combo = release.combo;
  if (bootloader.length !== BOOTLOADER_SIZE || await sha256(bootloader) !== combo.bootloader_sha256) {
    throw new Error(`the bootloader image does not match ${release.tag}`);
  }
  const bin = new Uint8Array(BOOTLOADER_SIZE + app.length);
  bin.set(bootloader);
  bin.set(app, BOOTLOADER_SIZE);
  const text = comboHex(bin, combo.hex);
  const parsed = parseHex(text);
  if (parsed.address !== COMBO_ADDRESS || !equal(parsed.bytes, bin)) {
    throw new Error('the combo HEX does not program the combo image');
  }
  return { bin, hex: new TextEncoder().encode(text) };
}
