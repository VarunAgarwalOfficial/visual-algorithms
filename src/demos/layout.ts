import { el } from '../ui/dom';

/** Builds a demo inside `root` and returns a function that tears it down. */
export type Mount = (root: HTMLElement, entry: DemoEntry) => () => void;

/** What the index knows about a demo without loading its code. */
export interface DemoEntry {
  /** Used in the URL: "#/id". */
  id: string;
  title: string;
  /** One sentence shown on the home page, and under the title when there is no `lede`. */
  summary: string;
  /**
   * The sentence under the title on the demo's own page: what the picture shows
   * and what to do first, in words the page has already explained.
   */
  lede?: string;
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
  /** Space under the canvas and its controls for what just happened, then counters. Empty by default. */
  readout: HTMLElement;
  /** The settings form, shown behind a closed "Settings" disclosure under the picture. */
  panel: HTMLElement;
  /** The explanation, behind a closed "How it works" disclosure at the end. */
  about: HTMLElement;
}

/**
 * The shared page skeleton, one column read top to bottom: heading, the sentence
 * that says what the demo shows and what to do, the picture, its key and its
 * controls, what just happened, counters, then the settings and the explanation,
 * both closed. `arrangeDemo` moves the demo's own pieces into that order once
 * the demo has filled the panel and readout.
 */
export function buildLayout(root: HTMLElement, entry: DemoEntry, canvasLabel: string): DemoLayout {
  const canvas = el('canvas', { role: 'img', 'aria-label': canvasLabel });
  const panel = el('form', { class: 'panel', 'aria-label': 'Settings' });
  panel.addEventListener('submit', (event) => event.preventDefault());
  const stage = el('div', { class: 'stage' }, canvas);
  const readout = el('div', { class: 'readout' });
  const about = el('div', { class: 'about-body' });

  root.append(
    el('h1', { text: entry.title }),
    el('p', { class: 'lede', text: entry.lede ?? entry.summary }),
    el(
      'div',
      { class: 'demo' },
      el(
        'div',
        { class: 'view' },
        stage,
        el('div', { class: 'key' }),
        el('div', { class: 'controls' }),
        readout,
      ),
      el('details', { class: 'settings' }, el('summary', { text: 'Settings' }), panel),
      el('details', { class: 'about' }, el('summary', { text: 'How it works' }), about),
    ),
  );
  return { canvas, stage, readout, panel, about };
}

/**
 * Puts a mounted demo's pieces in the one reading order. The key (legends) goes
 * straight under the picture; the demo's first action (a fieldset marked `act`)
 * and the playback buttons go under the key, so the first control on the page
 * is the first thing to do; the speed slider joins the closed settings; in the
 * readout, sentences come before counters and disclosures last. Called once,
 * right after `mount`.
 */
export function arrangeDemo(root: HTMLElement): void {
  const key = root.querySelector<HTMLElement>('.view > .key');
  const controls = root.querySelector<HTMLElement>('.view > .controls');
  const readout = root.querySelector<HTMLElement>('.view > .readout');
  const panel = root.querySelector<HTMLElement>('.settings > .panel');
  const settings = root.querySelector<HTMLDetailsElement>('.demo > .settings');
  if (!key || !controls || !readout || !panel || !settings) return;

  for (const node of root.querySelectorAll<HTMLElement>('.readout .legend, .panel .legend')) {
    if (!node.closest('.keep')) key.append(node);
  }
  key.hidden = key.childElementCount === 0;

  const acts = [...panel.querySelectorAll<HTMLElement>(':scope > fieldset.act')];
  const playback = panel.querySelector<HTMLElement>(':scope > .playback');
  controls.append(...acts);
  if (playback) {
    controls.append(playback);
    // Where the demo's own action comes first, Play is an ordinary button beside it.
    if (acts.length > 0) playback.querySelector('button.primary')?.classList.remove('primary');
    const speed = playback.querySelector<HTMLElement>('.speed');
    if (speed) panel.append(el('fieldset', {}, el('legend', { text: 'Playback speed' }), speed));
  }
  controls.hidden = controls.childElementCount === 0;

  const children = [...readout.children];
  const rank = (node: Element) =>
    node.tagName === 'DETAILS' ? 2 : node.matches('dl.stats, .stats-group') ? 1 : 0;
  readout.append(...children.sort((a, b) => rank(a) - rank(b)));

  const names = [...panel.querySelectorAll(':scope > fieldset > legend')]
    .map((legend) => legend.textContent?.trim().toLowerCase() ?? '')
    .filter(Boolean);
  const summary = settings.querySelector('summary');
  if (summary && names.length > 0) summary.textContent = `Settings: ${names.join(', ')}`;
  settings.hidden = panel.childElementCount === 0;
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
  /** Shows or hides one counter, for counts the current run never uses. */
  show(key: K, visible: boolean): void;
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
    show(key, visible) {
      const cell = cells.get(key);
      if (cell?.parentElement) cell.parentElement.hidden = !visible;
    },
  };
}

/**
 * How a key's swatch is drawn, to match the picture: a square by default, 'dot' for a filled
 * circle, 'hollow' for a ring, 'pale' for a square with an outline (a colour close to the page),
 * or a single letter for a filled circle carrying that letter.
 */
export type SwatchMark = 'dot' | 'hollow' | 'pale' | (string & {});

/** A colour key. Each item is [CSS colour or variable, label, swatch shape]. */
export function legend(
  items: readonly (readonly [string, string] | readonly [string, string, SwatchMark])[],
): HTMLUListElement {
  return el(
    'ul',
    { class: 'legend' },
    ...items.map(([colour, text, mark]) => {
      const attrs: Record<string, string> = { style: `--swatch: ${colour}`, text };
      if (mark === 'dot' || mark === 'hollow' || mark === 'pale') attrs.class = mark;
      else if (mark) {
        attrs.class = 'letter';
        attrs['data-mark'] = mark;
      }
      return el('li', attrs);
    }),
  );
}
