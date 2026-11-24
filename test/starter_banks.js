// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// See http://creativecommons.org/licenses/MIT/ for more information.
//

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addStarterBank, validateSelection, stockBanks } from '../static/js/palette.js';
const { banks } = JSON.parse(readFileSync(new URL('../static/starter-banks.json', import.meta.url)));
assert(banks.length >= 3 && banks.length <= 5);
const release = { content: { models: Array.from({ length: 24 }, (_, id) => ({ id })), rings: {} } };
const selection = validateSelection({ wave: true, rings: true, models: [23], banks: [Array(8).fill(23)] });
const original = structuredClone(selection);
const stock = validateSelection({ wave: true, rings: true, models: stockBanks().flat(), banks: stockBanks() });
for (const bank of banks) {
  assert.deepEqual(addStarterBank(stock, bank, release).models, stock.models, 'stock content needs no additional model bytes');
  assert.equal(new Set(bank.models).size, 8);
  const next = addStarterBank(selection, bank, release);
  assert.deepEqual(next.banks, [...selection.banks, bank.models]);
  assert(next.models.includes(23));
  assert(next.wave && next.rings);
  assert.deepEqual(selection, original);
  assert.throws(() => addStarterBank(selection, bank, { content: { models: [] } }), /Refit/);
}
assert.throws(() => addStarterBank({ ...selection, banks: Array(15).fill(selection.banks[0]) }, banks[0], release), /fifteen/);
assert.throws(() => addStarterBank(selection, { models: [1] }, release), /eight/);
console.log('PASS starter banks: eight slots, additive selection, unavailable content and capacity');
