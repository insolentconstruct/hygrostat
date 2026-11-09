// Copyright 2026 Insolent Construct.
//
// Author: Insolent Construct (insolentconstruct@gmail.com)
//
// MIT licence: see encoder.js.
//
// The Beads front panel, to scale, with the controls of one destination
// highlighted. Centres and sizes in mm are the printable guide's geometry
// (Mutable Instruments Beads panel file, geometry only, CC BY-SA 3.0); the
// drawing is plain SVG with no artwork.
import { pageOf, KNOBS } from './layout.js?v=da0451ebd88dfdfa';

const SVG = 'http://www.w3.org/2000/svg';
const WIDTH = 70.8, HEIGHT = 128.52;
// Room either side of the panel for the names of the controls in use.
const MARGIN = 29;

// [x, y, cap diameter, part]: knob caps; large and medium ones have a white top.
const KNOB_CAPS = [
  [35.40, 24.11, 18.4], [11.59, 38.40, 18.4], [59.25, 38.40, 18.4],
  [24.29, 60.59, 14.2], [46.55, 60.59, 14.2]
];
const SMALL_KNOBS = [
  [6.79, 60.59, 'knob-0'], [64.05, 60.59, 'knob-1'], [64.05, 76.82, 'knob-2'],
  [18.22, 80.59], [29.69, 80.59], [41.12, 80.59], [52.58, 80.59]
];
// [x, y, diameter, part]
const BUTTONS = [
  [8.73, 17.76, 8.01, 'freeze'], [62.07, 17.76, 8.01, 'seed'],
  [35.40, 45.03, 5.19, 'a'], [6.76, 76.78, 5.19, 'm']
];
const LEDS = [
  [29.02, 45.03, 'a-led'], [6.77, 69.81, 'led-0'], [64.03, 69.81, 'led-1'],
  [64.03, 86.01, 'led-2'], [12.52, 104.74]
];
const JACK_X = [6.77, 18.24, 29.67, 41.13, 52.56, 64.03];
const JACK_Y = [96.48, 111.09];
const MOUNTS = [[7.50, 3.02], [63.38, 3.02], [7.50, 125.50], [63.38, 125.50]];
// Panel legends: [x, y, text].
const PRINT = [
  [8.73, 25.4, 'FREEZE'], [62.07, 25.4, 'SEED'], [35.40, 37.0, 'DENSITY'],
  [11.59, 51.4, 'TIME'], [59.25, 51.4, 'PITCH'], [24.29, 71.2, 'SIZE'], [46.55, 71.2, 'SHAPE'],
  [64.03, 91.2, 'DENSITY'], [6.77, 105.8, 'IN L'], [18.24, 105.8, 'IN R'],
  [29.67, 105.8, 'FREEZE'], [41.13, 105.8, 'SEED']
];
// Names beside the panel: [x, y, text, anchor, part, x of the control's edge].
const CALLOUTS = [
  [-1.8, 17.76, 'FREEZE', 'end', 'freeze', 4.2], [WIDTH + 1.8, 17.76, 'SEED', 'start', 'seed', 66.6],
  [-1.8, 60.59, 'FEEDBACK', 'end', 'knob-0', 2.6], [WIDTH + 1.8, 60.59, 'DRY/WET', 'start', 'knob-1', 68.3],
  [-1.8, 76.78, '[M]', 'end', 'm', 3.6], [WIDTH + 1.8, 76.82, 'REVERB', 'start', 'knob-2', 68.3]
];

function node(name, attributes, parent) {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (parent) parent.append(element);
  return element;
}

function text(parent, x, y, content, attributes) {
  node('text', { x, y, ...attributes }, parent).textContent = content;
}

// A ring drawn behind a control while it is part of the gesture.
function halo(g, cx, cy, r, part) {
  node('circle', { cx, cy, r, class: 'halo', 'data-part': part }, g);
}

export function drawPanel(svg) {
  svg.setAttribute('viewBox', `${-MARGIN} -1 ${WIDTH + 2 * MARGIN} ${HEIGHT + 2}`);
  svg.replaceChildren();
  const g = node('g', {}, svg);
  node('rect', { width: WIDTH, height: HEIGHT, rx: 0.8, class: 'face' }, g);
  for (const [cx, cy] of MOUNTS) node('ellipse', { cx, cy, rx: 2.5, ry: 1.6, class: 'hole' }, g);
  node('line', { x1: 4, y1: 11.8, x2: WIDTH - 4, y2: 11.8, class: 'band' }, g);
  node('rect', { x: 46.4, y: 101.8, width: 23.8, height: 16.6, rx: 1, class: 'well' }, g);
  node('line', { x1: 4, y1: 120.2, x2: WIDTH - 4, y2: 120.2, class: 'rule' }, g);

  for (const [cx, cy, d] of KNOB_CAPS) {
    const r = d / 2;
    node('circle', { cx, cy, r: r + 1.2, class: 'scale' }, g);
    node('circle', { cx, cy, r, class: 'skirt' }, g);
    node('circle', { cx, cy, r: r * 0.66, class: 'cap' }, g);
    node('line', { x1: cx, y1: cy - r * 0.62, x2: cx, y2: cy - r * 0.25, class: 'mark' }, g);
  }
  for (const [cx, cy, part] of SMALL_KNOBS) {
    if (part) halo(g, cx, cy, 5.3, part);
    node('circle', { cx, cy, r: 3.9, class: 'skirt' + (part ? ' part' : ''), ...(part && { 'data-part': part }) }, g);
    node('line', { x1: cx, y1: cy - 3.3, x2: cx, y2: cy - 1.2, class: 'pointer' }, g);
  }
  for (const [cx, cy, d, part] of BUTTONS) {
    const r = d / 2;
    halo(g, cx, cy, r + 1.6, part);
    node('circle', { cx, cy, r: r + 0.5, class: 'bezel' }, g);
    node('circle', { cx, cy, r: r - 0.4, class: `part ${d > 6 ? 'lamp' : 'tact'}`, 'data-part': part }, g);
  }
  for (const [cx, cy, part] of LEDS) {
    node('circle', { cx, cy, r: 1.55, class: 'led part', ...(part && { 'data-part': part }) }, g);
  }
  for (const cy of JACK_Y) {
    for (const cx of JACK_X) {
      node('circle', { cx, cy, r: 3.9, class: 'nut' }, g);
      node('circle', { cx, cy, r: 2.5, class: 'sleeve' }, g);
      node('circle', { cx, cy, r: 1.75, class: 'socket' }, g);
    }
  }
  for (const [x, y, content] of PRINT) text(g, x, y, content, { class: 'print', 'text-anchor': 'middle' });
  text(g, 52.56, 105.2, 'L', { class: 'print inverse', 'text-anchor': 'middle' });
  text(g, 64.03, 105.2, 'R', { class: 'print inverse', 'text-anchor': 'middle' });

  for (const [x, y, content, anchor, part, edge] of CALLOUTS) {
    node('line', { x1: x + (anchor === 'end' ? 0.8 : -0.8), y1: y, x2: edge, y2: y, class: 'leader', 'data-label': part }, g);
    text(g, x, y + 1.5, content, { class: 'name', 'text-anchor': anchor, 'data-label': part });
  }
  text(g, 39.2, 46.4, '[A]', { class: 'name', 'data-label': 'a' });
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
