// Copyright 2026 Insolent Construct. MIT licence: see ../static/js/encoder.js.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parse, evaluate, point, terrain, grids, readGrids, fromLuminance, preview,
  GRID, GRID_SIZE, MAX_NODES, MAX_LENGTH } from '../static/js/terrain.js';
import { writeRegion, KINDS } from '../static/js/region.js';

const prototypeKeys = Reflect.ownKeys(Object.prototype);
const variables = ['x', 'y', 'r', 'theta', 'mu'];
const functions = {
  sin: [Math.sin, [0.3]], cos: [Math.cos, [0.3]], tan: [Math.tan, [0.3]],
  atan: [Math.atan, [0.3]], atan2: [Math.atan2, [1, -2]],
  floor: [Math.floor, [1.7]], ceil: [Math.ceil, [1.2]], round: [Math.round, [1.7]],
  sqrt: [Math.sqrt, [4]], exp: [Math.exp, [1]], log: [Math.log, [2]],
  pow: [Math.pow, [2, 3]], abs: [Math.abs, [-2]], sign: [Math.sign, [-2]],
  tanh: [Math.tanh, [0.3]], min: [Math.min, [2, -3]], max: [Math.max, [2, -3]],
  ball: [(xm, ym, std) => Math.exp(-((sample.x - xm) ** 2 + (sample.y - ym) ** 2) / std ** 2), [0.2, -0.3, 0.7]]
};
const sample = point(17, 42);
const value = (text, p = sample) => evaluate(parse(text), p);
for (const [text, expected] of [
  ['1+2*3', 7], ['-pow(2,2)', -4], ['pow(2,-1)', 0.5], ['pow(2,pow(3,2))', 512],
  ['7%4', 3], ['+2', 2], ['4-6/2', 1], ['pi', Math.PI], ['e', Math.E]
]) assert.equal(value(text), expected, text);
for (const text of ['x^2', '2**3', 'x ^ y', 'pow(x,2)^2']) {
  assert.throws(() => parse(text), { name: 'SyntaxError', message: 'For powers, use pow(a, b).' });
}
for (const [name, [fn, args]] of Object.entries(functions)) {
  assert.equal(value(`${name}(${args.join(',')})`), fn(...args), name);
  assert.throws(() => parse(`${name}(${[...args, 1].join(',')})`), SyntaxError, name);
  assert.throws(() => parse(`${name}(${args.slice(1).join(',')})`), SyntaxError, name);
}
assert.deepEqual(point(0, 0), { x: -1, y: -1, r: Math.sqrt(2), theta: -3 * Math.PI / 4, mu: 0.25 });
assert.equal(sample.x, 2 * 42 / 63 - 1);
assert.equal(sample.y, 2 * 17 / 63 - 1);
assert.equal(sample.r, Math.sqrt(sample.x * sample.x + sample.y * sample.y));
assert.equal(sample.theta, Math.atan2(sample.y, sample.x));
assert.equal(sample.mu, (Math.abs(sample.theta) - Math.PI) / -Math.PI);
for (const name of variables) assert.equal(value(name), sample[name]);
assert.equal(value('SIN(X)'), Math.sin(sample.x));
assert.equal(value('ball(x,y,1)'), 1);

const flat = terrain('1');
const ripples = terrain('sin(5 * (y + theta))');
for (const grid of [flat, ripples]) {
  assert(grid instanceof Int8Array);
  assert.equal(grid.length, 4096);
  assert(grid.every((n) => n >= -127 && n <= 127));
}
assert(flat.every((n) => n === -127));
assert(terrain('-5').every((n) => n === -127));
assert.equal(Math.min(...ripples), -127);
assert.equal(Math.max(...ripples), 127);
const alongX = terrain('x');
const alongY = terrain('y');
for (let y = 0; y < GRID; ++y) for (let x = 0; x < GRID; ++x) {
  const k = y * GRID + x;
  assert.equal(alongX[k], alongX[x]);
  assert.equal(alongY[k], alongY[y * GRID]);
  if (x) assert(alongX[k] > alongX[k - 1]);
  if (y) assert(alongY[k] > alongY[k - GRID]);
}

const forbidden = ['constructor', '__proto__', 'prototype', 'this', 'globalThis', 'window', 'process'];
const invalid = [
  '', '   ', ...forbidden, 'toString(x)', 'valueOf()', 'hasOwnProperty(x)', 'require(1)', 'import(1)',
  'Function(1)', 'eval(1)', 'x;1', 'x=1', 'x,1', 'x.y', 'x[0]', '`x`', '"x"', "'x'",
  'x => x', '() => 1', 'sin', 'sin()', 'sin(1,2)', 'atan2(1)', 'ball(1,2)', 'random()',
  'x y', '(x', 'x)', '1..2', '1e400', 'x ? 1 : 2', 'x && y', 'x | y', 'x == y',
  'x < y', '!x', '~x', 'new Date()', 'sin(x)(y)', 'a'.repeat(201), '('.repeat(17) + 'x' + ')'.repeat(17)
];
for (const text of [...invalid, null, 42, {}, []]) assert.throws(() => parse(text), SyntaxError, String(text));
// Each node costs at least one character; MAX_NODES is defence in depth behind MAX_LENGTH.
assert.equal(MAX_NODES, 200);
assert.equal(MAX_LENGTH, 200);
assert.doesNotThrow(() => parse('x+'.repeat(99) + 'x'));
assert.throws(() => parse(' '.repeat(MAX_LENGTH + 1)), /At most/);
for (const text of ['1e308*x', '1e-320*x']) assert.throws(() => terrain(text), /too large or too small/);
assert.deepEqual(terrain('1e300*x'), terrain('x'));
for (const text of ['1/(x-x)', 'log(x-x)', 'sqrt(-1-x*x)']) {
  assert.throws(() => terrain(text), (error) => error instanceof RangeError && error.message.startsWith('Not a number'));
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
    n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
const random = mulberry32(0x4a796772);
const alphabet = '0123456789xyreipnsocatlgbmhqdw+-*/%^(),. _';
const names = [...variables, 'pi', 'e', ...Object.keys(functions), ...forbidden, 'require', 'eval', 'Function', 'random'];
const arities = new Map([...Object.entries(functions).map(([name, [, args]]) => [name, args.length]),
  ...['+', '-', '*', '/', '%'].map((op) => [op, 2]), ['neg', 1]]);
function checkTree(tree) {
  assert.equal(Object.getPrototypeOf(tree), Object.prototype);
  const keys = Object.keys(tree).sort();
  if (keys.length === 1 && keys[0] === 'number') {
    assert.equal(typeof tree.number, 'number');
    assert(Number.isFinite(tree.number));
    return 1;
  }
  if (keys.length === 1 && keys[0] === 'variable') {
    assert(variables.includes(tree.variable));
    return 1;
  }
  assert.deepEqual(keys, ['args', 'op']);
  assert(arities.has(tree.op));
  assert(Array.isArray(tree.args));
  assert.equal(tree.args.length, arities.get(tree.op));
  return 1 + tree.args.reduce((count, arg) => count + checkTree(arg), 0);
}
const fuzzStart = performance.now();
let accepted = 0;
for (let i = 0; i < 20000; ++i) {
  let text = '';
  const length = 1 + Math.floor(random() * 220);
  while (text.length < length) {
    text += random() < 0.15 ? names[Math.floor(random() * names.length)] : alphabet[Math.floor(random() * alphabet.length)];
  }
  let tree;
  try { tree = parse(text); } catch (error) {
    assert(error instanceof SyntaxError, `${text}: ${error}`);
    continue;
  }
  ++accepted;
  assert(!text.includes('^'));
  assert(checkTree(tree) <= MAX_NODES);
  assert.equal(typeof evaluate(tree, point(0, 0)), 'number');
}
assert(accepted > 0);
assert(performance.now() - fuzzStart < 20000, 'fuzz loop must finish within 20 seconds');
assert.deepEqual(Reflect.ownKeys(Object.prototype), prototypeKeys);
assert.equal(({}).polluted, undefined);

const worst = 'sin('.repeat(16) + '-'.repeat(119) + 'x' + ')'.repeat(16);
assert.equal(worst.length, 200);
assert.doesNotThrow(() => parse(worst));
const boundedStart = performance.now();
assert.equal(terrain(worst).length, GRID_SIZE);
assert(performance.now() - boundedStart < 2000, 'bounded terrain evaluation must finish within 2 seconds');

const extreme = Int8Array.from({ length: GRID_SIZE }, (_, i) => i % 2 ? 127 : -128);
for (const count of [1, 16]) {
  const list = Array.from({ length: count }, (_, i) => i % 2 ? alongY : extreme);
  const payload = grids(list);
  assert.deepEqual(readGrids(payload), list);
  let written;
  assert.doesNotThrow(() => { written = writeRegion({ release: 20261121, terrain: payload }); });
  assert.equal(written.directory.length, 1);
  const section = written.directory[0];
  assert.equal(section.kind, KINDS.TERR);
  assert.deepEqual(written.region.subarray(section.offset + 32, section.offset + 32 + payload.length), payload);
}
for (const list of [[], Array(17).fill(extreme), [new Int8Array(4095)], [new Uint8Array(4096)], Array(1), Object.assign([extreme], { 2: extreme })]) {
  assert.throws(() => grids(list));
}
for (const bytes of [new Uint8Array(0), new Uint8Array(4097), new Uint8Array(17 * 4096),
  new Int8Array(4096), new ArrayBuffer(4096), [], null]) assert.throws(() => readGrids(bytes));
const luminance = Uint8Array.from({ length: GRID_SIZE }, (_, k) => Math.floor(k / GRID));
const flipped = fromLuminance(luminance);
assert.equal(flipped[63 * GRID], -127);
assert.equal(flipped[0], 127);
for (let y = 0; y < GRID; ++y) for (let x = 0; x < GRID; ++x) {
  assert.equal(flipped[(63 - y) * GRID + x], alongY[y * GRID]);
}
assert.throws(() => fromLuminance(new Uint8Array(4095)));
for (const offset of [-1, 0, 1]) {
  const samples = preview(ripples, 1 / 137, 1, offset, 1000);
  assert(samples instanceof Float32Array);
  assert.equal(samples.length, 1000);
  assert(samples.every((n) => Number.isFinite(n) && n >= -1 && n <= 1));
}
assert.deepEqual(Reflect.ownKeys(Object.prototype), prototypeKeys);
assert.equal(({}).polluted, undefined);
console.log('ok terrain: equations, safety, fuzz, bounded evaluation, grids, image, preview and TERR region');
