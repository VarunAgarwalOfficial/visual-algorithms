import { el } from '../ui/dom';

export interface Demo {
  id: string;
  title: string;
  /** One sentence shown under the title and on the home page. */
  summary: string;
  /** Builds the demo inside `root` and returns a function that tears it down. */
  mount(root: HTMLElement): () => void;
}

export interface DemoLayout {
  canvas: HTMLCanvasElement;
  /** Space directly under the canvas for readouts. Empty by default. */
  readout: HTMLElement;
  panel: HTMLElement;
  about: HTMLElement;
}

/** The shared page skeleton: heading, canvas stage, control panel, notes. */
export function buildLayout(root: HTMLElement, demo: Demo, canvasLabel: string): DemoLayout {
  const canvas = el('canvas', { role: 'img', 'aria-label': canvasLabel });
  const panel = el('form', { class: 'panel', 'aria-label': 'Controls' });
  panel.addEventListener('submit', (event) => event.preventDefault());
  const readout = el('div', { class: 'readout' });
  const about = el('section', { class: 'about', 'aria-label': 'How it works' });
  root.append(
    el('h1', { text: demo.title }),
    el('p', { class: 'lede', text: demo.summary }),
    el(
      'div',
      { class: 'demo' },
      el('div', {}, el('div', { class: 'stage' }, canvas), readout),
      panel,
    ),
    about,
  );
  return { canvas, readout, panel, about };
}

/** Builds a paragraph from text with `code` spans marked by backticks. */
export function prose(text: string): HTMLParagraphElement {
  const p = el('p');
  text.split('`').forEach((part, i) => {
    p.append(i % 2 === 1 ? el('code', { text: part }) : part);
  });
  return p;
}
