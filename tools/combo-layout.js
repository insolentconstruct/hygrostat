// Copyright 2026 Insolent Construct.
// Author: Insolent Construct.
// MIT licence: see ../static/js/encoder.js.
// Prints a release combo HEX's layout for the manifest's combo.hex: each part's
// address ranges (split where objcopy split records) and start address.
// node tools/combo-layout.js <tag>-combo.hex
import { readFileSync } from 'node:fs';

const parts = [];
let ranges = [];
let upper = 0;
let previous = null;
for (const line of readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean)) {
  const length = parseInt(line.slice(1, 3), 16);
  const type = parseInt(line.slice(7, 9), 16);
  if (type === 4) upper = parseInt(line.slice(9, 13), 16) * 0x10000;
  if (type === 5) {
    parts.push({ ranges: ranges.map(([at, size]) => [at.toString(16).toUpperCase().padStart(8, '0'), size]),
      start: line.slice(9, 17) });
    ranges = [];
    previous = null;
  }
  if (type !== 0) continue;
  const at = upper + parseInt(line.slice(3, 7), 16);
  // A short record not at a 64 KiB boundary ends a range.
  if (previous && at === previous.end && (previous.length === 16 || at % 0x10000 === 0)) ranges.at(-1)[1] += length;
  else ranges.push([at, length]);
  previous = { end: at + length, length };
}
console.log(JSON.stringify(parts));
