// Copyright 2026 Insolent Construct.
// MIT licence: see encoder.js.
// Width and height from a PNG, GIF or JPEG header, so an oversized image is refused before it is decoded. No DOM.

export const MAX_PIXELS = 1 << 24;

// GIF: the logical screen, grown to hold a first frame that overhangs it, as decoders do.
function gifSize(bytes, view) {
  let width = view.getUint16(6, true), height = view.getUint16(8, true);
  let at = 13 + (bytes[10] & 0x80 ? 3 << ((bytes[10] & 7) + 1) : 0);
  while (bytes[at] === 0x21) {
    at += 2;
    while (bytes[at]) at += bytes[at] + 1;
    if (at >= bytes.length) return null;
    ++at;
  }
  if (bytes[at] !== 0x2c) return { width, height };
  if (at + 10 > bytes.length) return null;
  width = Math.max(width, view.getUint16(at + 1, true) + view.getUint16(at + 5, true));
  height = Math.max(height, view.getUint16(at + 3, true) + view.getUint16(at + 7, true));
  return { width, height };
}

// JPEG: the first whole frame header (SOF0-15, less the DHT, JPG and DAC markers) before any scan or the end.
function jpegSize(bytes, view) {
  for (let at = 2; at + 4 <= bytes.length;) {
    const marker = bytes[at + 1];
    if (bytes[at] !== 0xff || marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0xff) ++at;
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) at += 2;
    else {
      const length = view.getUint16(at + 2);
      if (length < 2) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        const whole = at + 2 + length <= bytes.length && bytes[at + 9] > 0 && length === 8 + 3 * bytes[at + 9];
        return whole ? { width: view.getUint16(at + 7), height: view.getUint16(at + 5) } : null;
      }
      at += 2 + length;
    }
  }
  return null;
}

// Returns { width, height }, or null for bytes that are not the start of one of those formats.
export function imageSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tagged = (text, at = 0) => bytes.length >= at + text.length && [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (tagged('\x89PNG\r\n\x1a\n') && tagged('IHDR', 12) && bytes.length >= 24) {
    return view.getUint32(8) === 13 ? { width: view.getUint32(16), height: view.getUint32(20) } : null;
  }
  if ((tagged('GIF87a') || tagged('GIF89a')) && bytes.length >= 13) return gifSize(bytes, view);
  return tagged('\xff\xd8') ? jpegSize(bytes, view) : null;
}

// Throws unless the image is a supported format within the pixel limit.
export function checkImageSize(bytes) {
  const size = imageSize(bytes);
  if (!size) throw new Error('Use a PNG, JPEG or GIF image.');
  if (!(size.width > 0 && size.height > 0) || size.width * size.height > MAX_PIXELS) {
    throw new Error('Images are 16 megapixels at most.');
  }
  return size;
}
