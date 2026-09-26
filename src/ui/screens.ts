import { el } from './dom';

/** Static pieces of the title/pause screens. */

const CONTROLS: Array<[string, string, string]> = [
  ['Move', 'W A S D', 'Left stick'],
  ['Camera', 'Mouse', 'Right stick'],
  ['Light attack', 'Left click', 'RB'],
  ['Heavy attack', 'Shift + Left click', 'RT'],
  ['Block', 'Right click / F', 'LB'],
  ['Roll (tap) · Sprint (hold)', 'Space', 'B'],
  ['Lock on', 'Q / Middle click', 'R3'],
  ['Drink Estus', 'R', 'X'],
  ['Interact', 'E', 'A'],
  ['Pause', 'Esc', 'Start'],
];

export function controlsTable(): HTMLElement {
  const grid = el('div', 'controls');
  for (const [action, key, pad] of CONTROLS) {
    el('div', 'key', grid, key);
    el('div', 'action', grid, action);
    el('div', 'pad', grid, pad);
  }
  return grid;
}

export function titleHeader(): HTMLElement {
  const wrap = el('div', 'title-header');
  el('div', 'logo', wrap, 'MINISOULS');
  el('div', 'tagline', wrap, 'One bonfire. One bridge. One boss. Many deaths.');
  return wrap;
}

export function footer(...children: HTMLElement[]): HTMLElement {
  const wrap = el('div', 'hint');
  for (const c of children) wrap.appendChild(c);
  return wrap;
}

export function hintLine(text: string): HTMLElement {
  return el('div', undefined, undefined, text);
}
