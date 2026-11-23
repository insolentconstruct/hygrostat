// Copyright 2026 Insolent Construct.
// Portions copyright 2022 Emilie Gillet (plaits-editor waveterrain.js), under the same licence.
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
// Wave terrain grids (TERR) sampled as Mutable Instruments' Plaits editor does; equations
// are parsed by a fixed grammar and evaluated as a tree, never as JavaScript.
import { checkTerrains } from './region.js?v=6a1c50a3577e20b3';

export const GRID = 64;
export const GRID_SIZE = GRID * GRID;
export const MAX_GRIDS = 16;
export const MAX_LENGTH = 200;
export const MAX_NODES = 200;
export const MAX_NESTING = 16;

// Arity and function; names are those of the Plaits editor, less random.
const FUNCTIONS = {
  sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan], atan: [1, Math.atan], atan2: [2, Math.atan2],
  floor: [1, Math.floor], ceil: [1, Math.ceil], round: [1, Math.round], sqrt: [1, Math.sqrt], exp: [1, Math.exp],
  log: [1, Math.log], pow: [2, Math.pow], abs: [1, Math.abs], sign: [1, Math.sign], tanh: [1, Math.tanh],
  min: [2, Math.min], max: [2, Math.max],
  ball: [3, null]
};
const ball = (xm, ym, std, p) => Math.exp(-((p.x - xm) * (p.x - xm) + (p.y - ym) * (p.y - ym)) / (std * std));
const CONSTANTS = { pi: Math.PI, e: Math.E };
const VARIABLES = ['x', 'y', 'r', 'theta', 'mu'];
const BINARY = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b
};
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function tokenize(text) {
  const tokens = [];
  const pattern = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/%^(),]))/y;
  let at = 0;
  while (at < text.length) {
    if (/^\s*$/.test(text.slice(at))) break;
    pattern.lastIndex = at;
    const m = pattern.exec(text);
    if (!m) throw new SyntaxError(`Unexpected '${text.slice(at).trim()[0]}'.`);
    if (m[1] !== undefined) tokens.push({ kind: 'number', value: Number(m[1]) });
    else if (m[2] !== undefined) tokens.push({ kind: 'name', value: m[2].toLowerCase() });
    else if (m[3] === '^' || m[3] === '**') throw new SyntaxError('For powers, use pow(a, b).');
    else tokens.push({ kind: 'op', value: m[3] });
    at = pattern.lastIndex;
  }
  return tokens;
}

// Parses an equation into a tree of { op, args } / { number } / { variable } nodes; throws SyntaxError.
export function parse(text) {
  if (typeof text !== 'string') throw new SyntaxError('Type an equation.');
  if (text.length > MAX_LENGTH) throw new SyntaxError(`At most ${MAX_LENGTH} characters.`);
  if (!text.trim()) throw new SyntaxError('Type an equation.');
  const tokens = tokenize(text);
  let at = 0;
  let nodes = 0;
  const peek = () => tokens[at];
  const isOp = (value) => peek() && peek().kind === 'op' && peek().value === value;
  let nesting = 0;
  const node = (n) => {
    if (++nodes > MAX_NODES) throw new SyntaxError('Equation too long.');
    return n;
  };
  const nest = (step) => {
    nesting += step;
    if (nesting > MAX_NESTING) throw new SyntaxError('Too many brackets inside each other.');
  };
  const expect = (value) => {
    if (!isOp(value)) throw new SyntaxError(`Expected '${value}'.`);
    ++at;
  };
  function sum() {
    let left = product();
    while (isOp('+') || isOp('-')) {
      const op = tokens[at++].value;
      left = node({ op, args: [left, product()] });
    }
    return left;
  }
  function product() {
    let left = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = tokens[at++].value;
      left = node({ op, args: [left, unary()] });
    }
    return left;
  }
  function unary() {
    if (isOp('-') || isOp('+')) {
      const op = tokens[at++].value;
      const arg = unary();
      return op === '-' ? node({ op: 'neg', args: [arg] }) : arg;
    }
    return atom();
  }
  function atom() {
    const t = tokens[at++];
    if (!t) throw new SyntaxError('Equation ends too soon.');
    if (t.kind === 'number') {
      if (!Number.isFinite(t.value)) throw new SyntaxError('Number too large.');
      return node({ number: t.value });
    }
    if (t.kind === 'op') {
      if (t.value !== '(') throw new SyntaxError(`Unexpected '${t.value}'.`);
      nest(1);
      const inner = sum();
      expect(')');
      nest(-1);
      return inner;
    }
    if (own(FUNCTIONS, t.value)) {
      const [arity] = FUNCTIONS[t.value];
      expect('(');
      nest(1);
      const args = [sum()];
      while (isOp(',')) {
        ++at;
        args.push(sum());
      }
      expect(')');
      nest(-1);
      if (args.length !== arity) throw new SyntaxError(`${t.value} takes ${arity} value${arity > 1 ? 's' : ''}.`);
      return node({ op: t.value, args });
    }
    if (own(CONSTANTS, t.value)) return node({ number: CONSTANTS[t.value] });
    if (VARIABLES.includes(t.value)) return node({ variable: t.value });
    throw new SyntaxError(`Unknown name '${t.value}'.`);
  }
  const tree = sum();
  if (at < tokens.length) throw new SyntaxError(`Unexpected '${tokens[at].value}'.`);
  return tree;
}

// Evaluates a parsed tree at a point { x, y, r, theta, mu }.
export function evaluate(tree, point) {
  if (own(tree, 'number')) return tree.number;
  if (own(tree, 'variable')) return point[tree.variable];
  const args = tree.args.map((a) => evaluate(a, point));
  if (tree.op === 'neg') return -args[0];
  if (own(BINARY, tree.op)) return BINARY[tree.op](args[0], args[1]);
  return tree.op === 'ball' ? ball(...args, point) : FUNCTIONS[tree.op][1](...args);
}

// The point the Plaits editor gives an equation at grid row i, column j.
export function point(i, j) {
  const x = 2 * j / (GRID - 1) - 1;
  const y = 2 * i / (GRID - 1) - 1;
  const theta = Math.atan2(y, x);
  return { x, y, r: Math.sqrt(x * x + y * y), theta, mu: (Math.abs(theta) - Math.PI) / -Math.PI };
}

// Samples values (rows of x) and normalizes them to -127..127 as the Plaits editor does; a flat grid is -127.
export function quantize(values) {
  if (values.length !== GRID_SIZE) throw new Error('A grid is 64 x 64.');
  let low = Infinity;
  let high = -Infinity;
  values.forEach((z, k) => {
    if (!Number.isFinite(z)) throw new RangeError(`Not a number at x ${point(0, k % GRID).x.toFixed(2)}, y ${point(Math.floor(k / GRID), 0).y.toFixed(2)}.`);
    low = Math.min(low, z);
    high = Math.max(high, z);
  });
  const scale = 2 / (high === low ? 1 : high - low);
  if (!(Number.isFinite(scale) && scale > 0 && Number.isFinite(high - low))) {
    throw new RangeError('Values too large or too small.');
  }
  return Int8Array.from(values, (z) => Math.round(((z - low) * scale - 1) * 127));
}

// A grid from an equation; throws SyntaxError or RangeError with a short message.
export function terrain(text) {
  const tree = parse(text);
  const values = new Float64Array(GRID_SIZE);
  for (let i = 0; i < GRID; ++i) for (let j = 0; j < GRID; ++j) values[i * GRID + j] = evaluate(tree, point(i, j));
  return quantize(values);
}

// 1-16 grids as the TERR payload.
export function grids(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_GRIDS) throw new Error('Use 1 to 16 terrains.');
  const bytes = new Uint8Array(list.length * GRID_SIZE);
  for (let i = 0; i < list.length; ++i) {
    const g = list[i];
    if (!(g instanceof Int8Array) || g.length !== GRID_SIZE) throw new Error(`Terrain ${i + 1} is malformed.`);
    bytes.set(new Uint8Array(g.buffer, g.byteOffset, g.length), i * GRID_SIZE);
  }
  checkTerrains(bytes);
  return bytes;
}

// A TERR payload back to its grids; refuses what the writer refuses.
export function readGrids(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('TERR must be 1 to 16 grids of 64 x 64.');
  checkTerrains(bytes);
  const count = bytes.length / GRID_SIZE;
  return Array.from({ length: count }, (_, i) => Int8Array.from(bytes.subarray(i * GRID_SIZE, (i + 1) * GRID_SIZE), (v) => (v << 24) >> 24));
}

// A grid from image luminance (rows from the top, 0-255), as the Plaits editor reads images.
export function fromLuminance(luminance) {
  if (luminance.length !== GRID_SIZE) throw new Error('A grid is 64 x 64.');
  const values = new Float64Array(GRID_SIZE);
  for (let i = 0; i < GRID; ++i) for (let j = 0; j < GRID; ++j) values[(GRID - 1 - i) * GRID + j] = luminance[i * GRID + j];
  return quantize(values);
}

// A preview of a circular orbit over the grid (the Plaits editor's player), frequency in cycles per sample.
export function preview(grid, frequency, radius, offset, length) {
  const lookup = (x, y) => {
    const s = (GRID - 2) * 0.5;
    const xs = (x + 1) * s;
    const ys = (y + 1) * s;
    const xi = Math.floor(xs);
    const yi = Math.floor(ys);
    let k = yi * GRID + xi;
    const z0 = grid[k] + (grid[k + 1] - grid[k]) * (xs - xi);
    k += GRID;
    const z1 = grid[k] + (grid[k + 1] - grid[k]) * (xs - xi);
    return (z0 + (z1 - z0) * (ys - yi)) / 128;
  };
  const out = new Float32Array(length);
  let p = 0;
  for (let i = 0; i < length; ++i) {
    p += frequency;
    if (p >= 1) p -= 1;
    const x = Math.sin(2 * Math.PI * p) * radius * (1 - Math.abs(offset)) + offset;
    out[i] = lookup(x, Math.cos(2 * Math.PI * p) * radius);
  }
  return out;
}
