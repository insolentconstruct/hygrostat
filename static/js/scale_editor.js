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
import { effectiveScales, importScala, MAX_SCALES, PULSE_NAMES, validateScales } from './scales.js?v=eec2dd70c5a9cfff';

const node = (tag, text = '') => {
  const value = document.createElement(tag);
  value.textContent = text;
  return value;
};
const button = (label, action) => {
  const value = node('button', label);
  value.type = 'button';
  value.onclick = action;
  return value;
};
const hex = (color) => '#' + color.map((v) => v.toString(16).padStart(2, '0')).join('');
const cents = (value) => String(Number((value * 100).toFixed(4)));

export function scaleEditor(root, { get, set, error, releaseKey }) {
  let chosen = null;
  const report = (message) => {
    error(message);
    const local = root.querySelector('#scale-error');
    if (local) local.textContent = message;
  };
  const apply = (bank, message) => {
    try { set(validateScales(bank), message); }
    catch (problem) { report(problem.message); }
  };
  const nextId = (bank) => Array.from({ length: MAX_SCALES }, (_, i) => i + 2).find((id) => !bank.some((s) => s.id === id));
  return function render(enabled) {
    root.hidden = !enabled;
    if (!enabled) return;
    const scales = get();
    const bank = effectiveScales(scales);
    if (!bank.some((s) => s.id === chosen)) chosen = bank[0]?.id ?? null;
    const head = node('div'); head.className = 'section-head';
    head.append(node('h2', 'Pitch scales'), button('Restore factory scales', () => { chosen = null; apply(null, 'Factory scales restored.'); }));
    const about = node('p', 'Choose the scales available in the Scale position, in SEED-tap order. Off and Chromatic remain separate knob choices.');
    const list = node('ol'); list.className = 'scale-list';
    bank.forEach((scale, index) => {
      const row = node('li');
      const select = button(scale.name, () => { chosen = scale.id; render(true); root.querySelector(`#scale-select-${chosen}`)?.focus(); });
      select.id = `scale-select-${scale.id}`;
      select.setAttribute('aria-pressed', String(chosen === scale.id));
      const swatch = node('span'); swatch.className = 'scale-swatch'; swatch.style.backgroundColor = hex(scale.color);
      swatch.setAttribute('aria-hidden', 'true'); select.prepend(swatch);
      const move = (direction) => {
        const copy = bank.slice();
        [copy[index], copy[index + direction]] = [copy[index + direction], copy[index]];
        apply(copy, 'Scale order updated. Saved selections keep their scale identity.');
      };
      const up = button('Up', () => move(-1)); up.disabled = index === 0;
      up.setAttribute('aria-label', `Move ${scale.name} up`);
      const down = button('Down', () => move(1)); down.disabled = index === bank.length - 1;
      down.setAttribute('aria-label', `Move ${scale.name} down`);
      const remove = button('Remove', () => apply(bank.filter((s) => s.id !== scale.id), `${scale.name} removed.`));
      remove.setAttribute('aria-label', `Remove ${scale.name}`);
      row.append(select, node('small', PULSE_NAMES[scale.pulses]), up, down, remove);
      list.append(row);
    });
    const actions = node('div'); actions.className = 'inspector-actions';
    const add = button('Add scale', () => {
      const id = nextId(bank); if (id === undefined) return;
      chosen = id;
      apply([...bank, { id, name: 'User scale', repeat: 12, notes: [0, 4, 7], color: [255, 160, 0], pulses: 0 }], 'Scale added. Edit its notes below.');
    });
    add.disabled = bank.length >= MAX_SCALES;
    const file = node('input'); file.type = 'file'; file.accept = '.scl,text/plain'; file.id = 'scale-import';
    file.setAttribute('aria-label', 'Import Scala scale');
    file.disabled = bank.length >= MAX_SCALES;
    file.onchange = async () => {
      const source = file.files?.[0]; if (!source) return;
      try {
        if (source.size > 65536) throw new Error('Scala file is too large.');
        const release = releaseKey();
        const text = await source.text();
        if (release !== releaseKey()) throw new Error('Firmware selection changed. Import the Scala file again.');
        const current = effectiveScales(get());
        const id = nextId(current);
        if (id === undefined) throw new Error('Remove a scale before importing another.');
        const scale = importScala(text, id);
        chosen = id;
        apply([...current, scale], 'Scala scale imported.');
      } catch (problem) { report(problem.message); }
      finally { file.value = ''; }
    };
    const importLabel = node('label', 'Import Scala (.scl) '); importLabel.append(file);
    actions.append(add, importLabel);
    const note = node('p', 'Up to 14 scales, each with 1–24 notes. Notes and repeat are in cents; 1,200 cents is an octave. Removing a selected scale falls back to Off.'); note.className = 'note';
    const problem = node('p'); problem.id = 'scale-error'; problem.className = 'error'; problem.setAttribute('role', 'alert');
    root.replaceChildren(head, about, list, actions, note, problem);
    const scale = bank.find((s) => s.id === chosen);
    if (!scale) { root.append(node('p', 'No scales in the cycle. Add one or restore the factory set.')); return; }
    const form = node('form'); form.id = 'scale-form'; form.className = 'scale-form';
    const field = (label, name, value, type = 'text') => {
      const wrap = node('label', label);
      const input = node(name === 'notes' ? 'textarea' : 'input');
      input.name = name; input.id = `scale-${name}`; input.value = value;
      if (input.tagName === 'INPUT') input.type = type;
      wrap.append(input); form.append(wrap); return input;
    };
    const name = field('Name', 'name', scale.name); name.required = true;
    const repeat = field('Repeat (cents)', 'repeat', cents(scale.repeat), 'number');
    repeat.step = 'any'; repeat.min = '1'; repeat.max = '12800'; repeat.required = true;
    const notes = field('Notes (cents, separated by spaces or commas)', 'notes', scale.notes.map(cents).join(' '));
    notes.required = true;
    const color = field('LED colour', 'color', hex(scale.color), 'color');
    const label = node('label', 'LED flash pattern');
    const pulses = node('select'); pulses.name = 'pulses'; pulses.id = 'scale-pulses';
    PULSE_NAMES.forEach((text, i) => pulses.add(new Option(text, i))); pulses.value = scale.pulses;
    label.append(pulses); form.append(label);
    const save = node('button', 'Apply scale'); save.type = 'submit'; form.append(save);
    form.onsubmit = (event) => {
      event.preventDefault();
      const tokens = notes.value.trim().split(/[\s,]+/);
      const number = (text) => /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) / 100 : NaN;
      const updated = { ...scale, name: name.value, repeat: number(repeat.value),
        notes: tokens.map(number), color: [1, 3, 5].map((i) => parseInt(color.value.slice(i, i + 2), 16)), pulses: Number(pulses.value) };
      apply(bank.map((s) => s.id === scale.id ? updated : s), `${updated.name} updated.`);
    };
    root.append(form);
  };
}
