// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// MIT licence: see encoder.js.
//
// The upper Beads panel, drawn with the printable guide's geometry
// (Mutable Instruments Beads panel file, geometry only, CC BY-SA 3.0), with
// the controls of one destination highlighted.
import { pageOf, KNOBS } from './layout.js?v=16766575c2758e9e';

const SVG = 'http://www.w3.org/2000/svg';
// Guide coordinates, shifted so the labels fit.
const X = -398, Y = -88;
const PARTS = [
  ['rect', 'freeze', { x: 503.4, y: 101.8, width: 22.7, height: 22.7, rx: 4 }],
  ['rect', 'seed', { x: 654.6, y: 101.8, width: 22.7, height: 22.7, rx: 4 }],
  ['rect', 'a', { x: 583.0, y: 183.1, width: 14.7, height: 14.7, rx: 4 }],
  ['circle', 'a-led', { cx: 572.3, cy: 190.5, r: 4.5 }],
  ['rect', 'm', { x: 501.8, y: 273.1, width: 14.7, height: 14.7, rx: 4 }],
  ['circle', 'knob-0', { cx: 509.2, cy: 234.6, r: 9.7 }],
  ['circle', 'knob-1', { cx: 671.6, cy: 234.6, r: 9.7 }],
  ['circle', 'knob-2', { cx: 671.6, cy: 280.6, r: 9.7 }],
  ['circle', 'led-0', { cx: 509.2, cy: 260.7, r: 4.4 }],
  ['circle', 'led-1', { cx: 671.5, cy: 260.7, r: 4.4 }],
  ['circle', 'led-2', { cx: 671.5, cy: 306.6, r: 4.4 }]
];
const OUTLINES = [[541.6, 291.3, 9.7], [574.2, 291.3, 9.7], [606.6, 291.3, 9.7], [639.0, 291.3, 9.7],
  [558.9, 234.6, 20.1], [622.0, 234.6, 20.1], [522.9, 171.7, 26.1], [658.0, 171.7, 26.1], [590.3, 131.2, 26.1]];
const LABELS = [
  [482, 117, 'FREEZE', 'end', 'freeze'], [698.7, 117, 'SEED', 'start', 'seed'],
  [590.3, 214.8, '[A]', 'middle', 'a'], [482, 239.6, 'FEEDBACK', 'end', 'knob-0'],
  [482, 285.5, '[M]', 'end', 'm'], [698.7, 239.6, 'DRY/WET', 'start', 'knob-1'],
  [698.7, 285.6, 'REVERB', 'start', 'knob-2']
];

function node(name, attributes) {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

export function drawPanel(svg) {
  svg.setAttribute('viewBox', '0 0 390 236');
  svg.replaceChildren();
  const g = node('g', { transform: `translate(${X} ${Y})` });
  g.append(node('rect', { x: 490, y: 94, width: 200.7, height: 221.1, rx: 3, class: 'plate' }));
  for (const [cx, cy, r] of OUTLINES) g.append(node('circle', { cx, cy, r, class: 'outline' }));
  for (const [name, part, attributes] of PARTS) g.append(node(name, { ...attributes, class: 'part', 'data-part': part }));
  for (const [x, y, text, anchor, part] of LABELS) {
    const label = node('text', { x, y, 'text-anchor': anchor, class: 'legend', 'data-label': part });
    label.textContent = text;
    g.append(label);
  }
  svg.append(g);
}

// Highlight a destination and return its gesture in words.
export function highlight(svg, kind, slot) {
  const on = new Set();
  const lit = new Set();
  let text = 'Not on a control.';
  if (kind === 'page' && slot) {
    const page = pageOf(slot), knob = (slot - 1) % 3;
    on.add('m'); on.add(`knob-${knob}`); lit.add('a-led');
    for (const led of page === 4 ? [0, 1, 2] : [page - 1]) lit.add(`led-${led}`);
    text = `Hold [M] 3 s, tap to page ${page} (${page === 4 ? 'all three LEDs' : KNOBS[page - 1] + ' LED'} pulses), turn ${KNOBS[knob]}. [A] shows the value.`;
  } else if (kind === 'amount' && slot) {
    on.add('a'); on.add(`knob-${slot}`);
    text = `Hold [A] and turn ${KNOBS[slot]}.`;
  } else if (kind === 'action' && slot) {
    on.add('a');
    if (slot === 1) on.add('seed');
    if (slot === 2) on.add('freeze');
    text = ['', 'Hold [A] and press SEED.', 'Hold [A] and press FREEZE.', 'Hold [A] with both inputs unplugged.'][slot];
  }
  svg.querySelectorAll('[data-part], [data-label]').forEach((element) => {
    const part = element.dataset.part || element.dataset.label;
    element.classList.toggle('on', on.has(part));
    element.classList.toggle('lit', lit.has(part));
  });
  return text;
}
