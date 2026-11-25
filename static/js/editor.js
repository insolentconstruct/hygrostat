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
// The wavetable and terrain editor page (editor.html).
import { FACTORY, WAVES_PER_BANK, WAVE_SIZE, TABLE_BYTES, MAX_IMPORT, factoryRows, integrate, table, rows,
  shape, parseWav, resample, cycles, preview as wavePreview } from './wavetables.js?v=44fb6759b0ce7548';
import { terrain, fromLuminance, preview as terrainPreview, GRID, MAX_GRIDS } from './terrain.js?v=44fb6759b0ce7548';
import { readContent, saveContent, decodeContent } from './content.js?v=44fb6759b0ce7548';

const $ = (id) => document.getElementById(id);
const SAMPLE_RATE = 48000;
const storage = (() => { try { return localStorage; } catch { return null; } })();
const factory = factoryRows();
const state = { rows: factory.slice(), sources: [], bank: 0, wave: 0, terrains: [], selected: -1, generation: 0 };
let audio = null;
let player = null;

function report(id, text, error = false) {
  $(id).textContent = text;
  $(id).classList.toggle('error', error);
}

const sameRow = (a, b) => a.every((v, i) => v === b[i]);
const edited = (i) => !sameRow(state.rows[i], factory[i]);

// Saves, or reports in the status line with id why it could not; returns whether it saved.
function save(id) {
  const custom = state.rows.some((_, i) => edited(i));
  try {
    if (!storage) throw new Error('this browser blocks storage.');
    saveContent(storage, { wave: custom ? table(state.rows) : null, terrains: state.terrains });
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    return true;
  } catch (error) {
    report(id, `Not saved: ${error.message}`, true);
    return false;
  }
}

function load() {
  let saved;
  try {
    const content = new URLSearchParams(location.hash.slice(1)).get('content');
    saved = content === null ? storage ? readContent(storage) : null : decodeContent(content);
  } catch (error) { saved = { error }; }
  if (saved?.error) {
    report('wave-status', 'Your saved wavetables or terrains were damaged and could not be opened.', true);
    return;
  }
  if (!saved) return;
  if (saved.wave) state.rows = rows(saved.wave);
  state.terrains = saved.terrains;
  state.selected = state.terrains.length ? 0 : -1;
  showEquation();
}

function showEquation() {
  const equation = state.terrains[state.selected]?.equation;
  if (typeof equation === 'string') $('equation').value = equation;
}

// Wave drawing: the wave a row plays, peak 1, in a canvas.
function drawWave(canvas, wave, colour) {
  const context = canvas.getContext('2d');
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue(colour);
  context.lineWidth = Math.max(1, width / 256);
  context.beginPath();
  wave.forEach((v, i) => {
    const x = i * width / (WAVE_SIZE - 1);
    const y = (1 - v * 0.9) * height / 2;
    if (i) context.lineTo(x, y);
    else context.moveTo(x, y);
  });
  context.stroke();
}

const index = (w = state.wave) => state.bank * WAVES_PER_BANK + w;
const source = (i) => state.sources[i] ?? shape(state.rows[i]);

function renderWaves() {
  const grid = $('wave-grid');
  grid.replaceChildren(...Array.from({ length: WAVES_PER_BANK }, (_, w) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(w === state.wave));
    button.setAttribute('aria-label', `Wave ${w + 1}${edited(index(w)) ? ', edited' : ''}`);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    drawWave(canvas, shape(state.rows[index(w)]), edited(index(w)) ? '--edited' : '--wave');
    button.append(canvas);
    button.addEventListener('click', () => {
      state.wave = w;
      renderWaves();
      restart();
    });
    return button;
  }));
  drawWave($('wave-draw'), source(index()), '--wave');
}

// Commits a new source wave for row i, or reports why Beads can't store it.
function setWave(i, wave) {
  try {
    state.rows[i] = integrate(wave);
    state.sources[i] = wave;
    return true;
  } catch (error) {
    report('wave-status', `Wave ${i % WAVES_PER_BANK + 1}: ${error.message}`, true);
    return false;
  }
}

function changed(text) {
  const saved = save('wave-status');
  renderWaves();
  restart();
  if (text && saved) report('wave-status', text);
}

// Starts an edit that a reset or table change cancels.
const reset = () => ++state.generation;

function drawing() {
  const canvas = $('wave-draw');
  let last = null;
  let wave = null;
  const at = (e) => {
    const box = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - box.left) / box.width * (WAVE_SIZE - 1));
    const y = 1 - 2 * (e.clientY - box.top) / box.height;
    return [Math.min(Math.max(x, 0), WAVE_SIZE - 1), Math.min(Math.max(y / 0.9, -1), 1)];
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    wave = Float64Array.from(source(index()));
    last = null;
    canvas.dispatchEvent(new PointerEvent('pointermove', e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!wave) return;
    const [x, y] = at(e);
    const [x0, y0] = last ?? [x, y];
    const steps = Math.abs(x - x0);
    for (let s = 0; s <= steps; ++s) {
      const t = steps ? s / steps : 1;
      wave[Math.round(x0 + (x - x0) * t)] = y0 + (y - y0) * t;
    }
    last = [x, y];
    drawWave(canvas, wave, '--edited');
  });
  const end = () => {
    if (!wave) return;
    const drawn = wave;
    wave = null;
    if (setWave(index(), drawn)) changed('Wave drawn.');
    else renderWaves();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // Keys: left and right pick 16 samples (one with Shift), up and down move them.
  let cursor = 0;
  canvas.addEventListener('keydown', (e) => {
    const span = e.shiftKey ? 1 : 16;
    const step = { ArrowLeft: -span, ArrowRight: span }[e.key];
    const lift = { ArrowUp: 0.1, ArrowDown: -0.1 }[e.key];
    if (step === undefined && lift === undefined) return;
    e.preventDefault();
    cursor = Math.min(Math.max(cursor + (step ?? 0), 0), WAVE_SIZE - span);
    if (step !== undefined) {
      report('wave-status', `Samples ${cursor + 1} to ${cursor + span}.`);
      return;
    }
    const keyed = Float64Array.from(source(index()));
    for (let i = cursor; i < cursor + span; ++i) keyed[i] = Math.min(Math.max(keyed[i] + lift, -1), 1);
    if (setWave(index(), keyed)) changed(`Samples ${cursor + 1} to ${cursor + span} moved ${lift > 0 ? 'up' : 'down'}.`);
  });
}

async function importWavs(files) {
  const list = Array.from(files);
  const first = state.wave;
  const bank = state.bank * WAVES_PER_BANK;
  const generation = state.generation;
  const phaseAlign = $('wav-align').checked;
  const banked = $('wav-cycles').checked;
  let next = first;
  for (const file of list) {
    if (next >= WAVES_PER_BANK) break;
    try {
      if (file.size > MAX_IMPORT) throw new Error('WAV files are 4 MB at most.');
      const buffer = await file.arrayBuffer();
      if (generation !== state.generation) return;
      const samples = parseWav(buffer);
      const waves = banked ? cycles(samples) : [samples];
      for (const w of waves) {
        if (next >= WAVES_PER_BANK) break;
        const cycle = w.length === WAVE_SIZE && !phaseAlign ? w : resample(w, phaseAlign);
        if (!setWave(bank + next, cycle)) return changed();
        ++next;
      }
    } catch (error) {
      report('wave-status', `${file.name}: ${error.message}`, true);
      return changed();
    }
  }
  changed(`Imported ${next - first} wave${next - first === 1 ? '' : 's'}.`);
}

async function openTable(file) {
  try {
    if (file.size !== TABLE_BYTES) throw new Error(`A table file is ${TABLE_BYTES} bytes.`);
    const generation = reset();
    const opened = rows(new Uint8Array(await file.arrayBuffer()));
    if (generation !== state.generation) return;
    reset();
    state.rows = opened;
    state.sources = [];
    changed('Table opened.');
  } catch (error) {
    report('wave-status', `${file.name}: ${error.message}`, true);
  }
}

function download() {
  const url = URL.createObjectURL(new Blob([table(state.rows)], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'beads-wavetables.bin';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Terrains.
function drawTerrain(canvas, grid) {
  const context = canvas.getContext('2d');
  const image = context.createImageData(GRID, GRID);
  grid.forEach((z, k) => {
    const p = ((GRID - 1 - Math.floor(k / GRID)) * GRID + k % GRID) * 4;
    image.data.set(z < 0 ? [-z * 2, 0, -z, 255] : [0, z * 1.5, z * 1.2, 255], p);
  });
  context.putImageData(image, 0, 0);
}

function renderTerrains() {
  $('terrain-list').replaceChildren(...state.terrains.map((t, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(i === state.selected));
    button.setAttribute('aria-label', `Terrain ${i + 1}: ${t.equation ?? 'image'}`);
    button.title = t.equation ?? 'Image';
    const canvas = document.createElement('canvas');
    canvas.width = GRID;
    canvas.height = GRID;
    drawTerrain(canvas, t.grid);
    button.append(canvas);
    button.addEventListener('click', () => {
      state.selected = i;
      showEquation();
      renderTerrains();
      restart();
    });
    return button;
  }));
  const current = state.terrains[state.selected];
  if (current) drawTerrain($('terrain-view'), current.grid);
  else $('terrain-view').getContext('2d').clearRect(0, 0, GRID, GRID);
  $('terrain-count').textContent = `${state.terrains.length} of ${MAX_GRIDS}`;
  $('terrain-add').disabled = state.terrains.length >= MAX_GRIDS;
  $('terrain-replace').disabled = $('terrain-remove').disabled = state.selected < 0;
}

function putTerrain(entry, replace, text) {
  if (replace) state.terrains[state.selected] = entry;
  else if (state.terrains.length < MAX_GRIDS) state.selected = state.terrains.push(entry) - 1;
  if (save('terrain-status')) report('terrain-status', text);
  renderTerrains();
  restart();
}

function fromEquation(replace) {
  const equation = $('equation').value;
  try {
    putTerrain({ equation, grid: terrain(equation) }, replace, replace ? 'Terrain replaced.' : 'Terrain added.');
  } catch (error) {
    report('terrain-status', error.message, true);
  }
}

async function fromImage(file) {
  try {
    if (file.size > MAX_IMPORT) throw new Error('Images are 4 MB at most.');
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = GRID;
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, side, side, 0, 0, GRID, GRID);
    bitmap.close();
    const pixels = context.getImageData(0, 0, GRID, GRID).data;
    const luminance = Float64Array.from({ length: GRID * GRID },
      (_, k) => 0.2126 * pixels[4 * k] + 0.7152 * pixels[4 * k + 1] + 0.0722 * pixels[4 * k + 2]);
    putTerrain({ equation: null, grid: fromLuminance(luminance) }, false, 'Image added.');
  } catch (error) {
    report('terrain-status', `${file.name}: ${error.message}`, true);
  }
}

// Preview: one second of the selected wave or terrain, looped.
const frequency = (id) => 440 * 2 ** ((Number($(id).value) - 69) / 12) / SAMPLE_RATE;

function render(kind) {
  if (kind === 'wave') {
    const bank = state.rows.slice(state.bank * WAVES_PER_BANK, (state.bank + 1) * WAVES_PER_BANK);
    return wavePreview(bank, Number($('wave-position').value), frequency('wave-note'), SAMPLE_RATE);
  }
  const current = state.terrains[state.selected];
  return current ? terrainPreview(current.grid, frequency('terrain-note'), Number($('terrain-radius').value),
    Number($('terrain-offset').value), SAMPLE_RATE) : null;
}

function stop() {
  if (player) player.source.stop();
  $(`${player?.kind ?? 'wave'}-play`).setAttribute('aria-pressed', 'false');
  $(`${player?.kind ?? 'wave'}-play`).textContent = 'Play';
  player = null;
}

function play(kind) {
  const samples = render(kind);
  if (!samples) return;
  audio ??= new AudioContext({ sampleRate: SAMPLE_RATE });
  const buffer = audio.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.getChannelData(0).set(samples.map((v) => v * 0.5));
  const node = audio.createBufferSource();
  node.buffer = buffer;
  node.loop = true;
  node.connect(audio.destination);
  node.start();
  player = { kind, source: node };
  $(`${kind}-play`).setAttribute('aria-pressed', 'true');
  $(`${kind}-play`).textContent = 'Stop';
}

function restart() {
  if (!player) return;
  const { kind } = player;
  stop();
  play(kind);
}

function toggle(kind) {
  const same = player?.kind === kind;
  if (player) stop();
  if (!same) play(kind);
}

function bind() {
  $('bank').replaceChildren(...FACTORY.map(([name], b) => {
    const option = document.createElement('option');
    option.value = String(b);
    option.textContent = `${String.fromCharCode(65 + b)}: ${name}`;
    return option;
  }));
  $('bank').addEventListener('change', () => {
    state.bank = Number($('bank').value);
    renderWaves();
    restart();
  });
  $('wav-file').addEventListener('change', async (e) => {
    await importWavs(e.target.files);
    e.target.value = '';
  });
  $('table-file').addEventListener('change', async (e) => {
    if (e.target.files[0]) await openTable(e.target.files[0]);
    e.target.value = '';
  });
  $('wave-reset').addEventListener('click', () => {
    reset();
    state.rows[index()] = factory[index()];
    state.sources[index()] = undefined;
    changed('Wave reset.');
  });
  $('bank-reset').addEventListener('click', () => {
    reset();
    for (let w = 0; w < WAVES_PER_BANK; ++w) {
      state.rows[index(w)] = factory[index(w)];
      state.sources[index(w)] = undefined;
    }
    changed('Bank reset.');
  });
  $('table-reset').addEventListener('click', () => {
    reset();
    state.rows = factory.slice();
    state.sources = [];
    changed('All waves reset to the factory table.');
  });
  $('table-download').addEventListener('click', download);
  $('terrain-add').addEventListener('click', () => fromEquation(false));
  $('terrain-replace').addEventListener('click', () => fromEquation(true));
  $('equation').addEventListener('keydown', (e) => { if (e.key === 'Enter') fromEquation(false); });
  $('terrain-remove').addEventListener('click', () => {
    state.terrains.splice(state.selected, 1);
    state.selected = Math.min(state.selected, state.terrains.length - 1);
    showEquation();
    if (save('terrain-status')) report('terrain-status', 'Terrain removed.');
    renderTerrains();
    if (player?.kind === 'terrain') stop();
  });
  $('image-file').addEventListener('change', async (e) => {
    if (e.target.files[0]) await fromImage(e.target.files[0]);
    e.target.value = '';
  });
  $('wave-play').addEventListener('click', () => toggle('wave'));
  $('terrain-play').addEventListener('click', () => toggle('terrain'));
  for (const id of ['wave-note', 'wave-position', 'terrain-note', 'terrain-radius', 'terrain-offset']) {
    $(id).addEventListener('change', restart);
  }
  drawing();
}

load();
bind();
renderWaves();
renderTerrains();
