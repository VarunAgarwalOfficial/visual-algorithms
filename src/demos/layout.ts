import { el } from '../ui/dom';

/** Builds a demo inside `root` and returns a function that tears it down. */
export type Mount = (root: HTMLElement, entry: DemoEntry) => () => void;

/** What the index knows about a demo without loading its code. */
export interface DemoEntry {
  /** Used in the URL: "#/id". */
  id: string;
  title: string;
  /** One sentence shown under the title and on the home page. */
  summary: string;
  /** Extra words the search should match: algorithm names, synonyms. */
  keywords?: string;
  load(): Promise<{ mount: Mount }>;
}

export interface Section {
  id: string;
  title: string;
  blurb: string;
  demos: readonly DemoEntry[];
}

export interface DemoLayout {
  canvas: HTMLCanvasElement;
  /** The box around the canvas, for demos that add a second canvas or an overlay. */
  stage: HTMLElement;
  /** Space directly under the canvas for counters and status. Empty by default. */
  readout: HTMLElement;
  panel: HTMLElement;
  about: HTMLElement;
}

/** The shared page skeleton: heading, canvas stage, control panel, notes. */
export function buildLayout(root: HTMLElement, entry: DemoEntry, canvasLabel: string): DemoLayout {
  const canvas = el('canvas', { role: 'img', 'aria-label': canvasLabel });
  const panel = el('form', { class: 'panel', 'aria-label': 'Controls' });
  panel.addEventListener('submit', (event) => event.preventDefault());
  const stage = el('div', { class: 'stage' }, canvas);
  const readout = el('div', { class: 'readout' });
  const about = el(
    'section',
    { class: 'about', 'aria-label': 'How it works' },
    el('h2', { text: 'How it works' }),
  );

  root.append(
    el('h1', { text: entry.title }),
    el('p', { class: 'lede', text: entry.summary }),
    el('div', { class: 'demo' }, el('div', { class: 'view' }, stage, readout), panel, about),
  );
  keepPlaybackNearCanvas(panel);
  return { canvas, stage, readout, panel, about };
}

const NARROW = window.matchMedia('(max-width: 40rem)');

/**
 * On a phone the panel sits under the picture, so Play and Step go first in it
 * rather than below every other setting. The fieldset is moved in the document,
 * not just on screen, so the tab order matches what is seen.
 */
function keepPlaybackNearCanvas(panel: HTMLElement): void {
  let home: ChildNode | null = null;
  const place = () => {
    if (!panel.isConnected) {
      NARROW.removeEventListener('change', place);
      return;
    }
    const playback = panel.querySelector(':scope > .playback');
    if (!playback) return;
    if (NARROW.matches && panel.firstElementChild !== playback) {
      home = playback.nextSibling;
      panel.prepend(playback);
    } else if (!NARROW.matches && panel.firstElementChild === playback) {
      panel.insertBefore(playback, home);
    }
  };
  NARROW.addEventListener('change', place);
  // The demo fills the panel right after this returns.
  queueMicrotask(place);
}

/** Builds a paragraph from text with `code` spans marked by backticks. */
export function prose(text: string): HTMLParagraphElement {
  const p = el('p');
  text.split('`').forEach((part, i) => {
    p.append(i % 2 === 1 ? el('code', { text: part }) : part);
  });
  return p;
}

/** A displayed formula or recurrence, in monospace on its own lines. */
export function formula(text: string): HTMLPreElement {
  return el('pre', { class: 'formula', text });
}

export interface Stats<K extends string> {
  root: HTMLElement;
  set(values: Partial<Record<K, string | number>>): void;
}

/** A row of labelled live counters for the readout under the canvas. */
export function stats<K extends string>(labels: Record<K, string>): Stats<K> {
  const cells = new Map<string, HTMLElement>();
  const root = el('dl', { class: 'stats' });
  for (const [key, label] of Object.entries<string>(labels)) {
    const dd = el('dd', { text: '0' });
    cells.set(key, dd);
    root.append(el('div', {}, el('dt', { text: label }), dd));
  }
  return {
    root,
    set(values) {
      for (const [key, value] of Object.entries(values)) {
        const cell = cells.get(key);
        if (cell) cell.textContent = String(value);
      }
    },
  };
}

/** A colour key. Each item is [CSS colour or variable, label]. */
export function legend(items: readonly (readonly [string, string])[]): HTMLUListElement {
  return el(
    'ul',
    { class: 'legend' },
    ...items.map(([colour, text]) => el('li', { style: `--swatch: ${colour}`, text })),
  );
}
