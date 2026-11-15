import { ruleTable, runElementary, toggleRuleBit } from '../../core/automata/elementary';
import { packBits, unpackBits } from '../../core/automata/life';
import { newSeed, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { hexToRgb, prefersReducedMotion, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';

const MIN_CELLS = 31;
const MAX_CELLS = 301;

type Start = 'single' | 'random' | 'custom';
const STARTS: readonly { id: Start; name: string }[] = [
  { id: 'single', name: 'Single cell' },
  { id: 'random', name: 'Random' },
  { id: 'custom', name: 'Edited by hand' },
];

const NOTABLE: readonly { rule: number; start: Start; why: string }[] = [
  {
    rule: 30,
    start: 'single',
    why: 'Rule 30 is chaotic even from one cell. Its centre column has served as a random number generator.',
  },
  {
    rule: 90,
    start: 'single',
    why: 'Rule 90 makes each cell the XOR of its two neighbours. One cell grows into the Sierpinski triangle.',
  },
  {
    rule: 110,
    start: 'single',
    why: 'Rule 110 grows moving structures on a regular background. It can compute anything a computer can.',
  },
  {
    rule: 184,
    start: 'random',
    why: 'Rule 184 is a traffic model. A car moves right when the cell ahead is free, and jams drift left.',
  },
];

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Rows of cells stacked from top to bottom. Each row is computed from the row above it.',
  );

  const url = urlState({
    rule: 30,
    cells: 161,
    start: 'single',
    seed: 1,
    wrap: true,
    row: '',
    speed: 30,
  });
  const settings = url.state;
  settings.rule = Math.max(0, Math.min(255, Math.round(settings.rule)));
  settings.cells = Math.max(MIN_CELLS, Math.min(MAX_CELLS, Math.round(settings.cells)));
  if (!STARTS.some((s) => s.id === settings.start)) settings.start = 'single';
  settings.row = settings.row.slice(0, 200);

  let first: Uint8Array = new Uint8Array(settings.cells);
  let grid: Uint8Array = new Uint8Array(0);
  let rows = 1;
  const image = document.createElement('canvas');
  const imageCtx = image.getContext('2d');

  const theme = watchPalette(() => {
    paintImage();
    draw();
  });
  const stage = createStage(canvas, () => draw());
  const player = tracePlayer({
    speed: settings.speed,
    minSpeed: 2,
    maxSpeed: 400,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render: () => update(),
  });

  // --- Model ---

  function makeFirstRow() {
    const n = settings.cells;
    if (settings.start === 'custom') {
      first = unpackBits(settings.row, n);
    } else {
      first = new Uint8Array(n);
      if (settings.start === 'single') {
        first[n >> 1] = 1;
      } else {
        const random = seeded(settings.seed);
        for (let i = 0; i < n; i++) first[i] = random() < 0.5 ? 1 : 0;
      }
    }
  }

  /** Reruns the automaton. The cursor stays where it is unless `position` is given. */
  function retrace(position?: number) {
    rows = Math.max(2, Math.round(settings.cells * 0.75));
    grid = runElementary(first, settings.rule, rows, settings.wrap);
    paintImage();
    syncRuleControls();
    const at = position ?? (player.position >= player.length ? rows - 1 : player.position);
    player.setLength(rows - 1, Math.min(rows - 1, at));
    url.save();
  }

  function setRule(rule: number) {
    settings.rule = rule;
    retrace();
  }

  // --- Rendering ---

  /** One image pixel per cell; drawing scales the revealed part up. */
  function paintImage() {
    if (!imageCtx || grid.length === 0) return;
    const width = settings.cells;
    image.width = width;
    image.height = rows;
    const data = imageCtx.createImageData(width, rows);
    const [r, g, b] = hexToRgb(theme.palette.ink);
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i]) continue;
      data.data[4 * i] = r;
      data.data[4 * i + 1] = g;
      data.data[4 * i + 2] = b;
      data.data[4 * i + 3] = 255;
    }
    imageCtx.putImageData(data, 0, 0);
  }

  function geometry() {
    const cell = Math.min(stage.width / settings.cells, stage.height / rows);
    return { cell, left: (stage.width - cell * settings.cells) / 2 };
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    if (grid.length === 0) return;
    const { cell, left } = geometry();
    const shown = player.position + 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, settings.cells, shown, left, 0, cell * settings.cells, cell * shown);

    // The newest row, in the accent colour.
    const y = (shown - 1) * cell;
    const base = (shown - 1) * settings.cells;
    ctx.fillStyle = palette.accent;
    for (let x = 0; x < settings.cells; x++) {
      if (grid[base + x]) ctx.fillRect(left + x * cell, y, cell + 0.5, cell + 0.5);
    }
    if (shown < rows) {
      ctx.fillStyle = palette.faint;
      ctx.fillRect(left, y + cell + 0.5, cell * settings.cells, 1);
    }
  }

  function update() {
    draw();
    const row = player.position;
    let live = 0;
    for (let x = 0; x < settings.cells; x++) live += grid[row * settings.cells + x];
    counters.set({
      rule: `${settings.rule} = ${settings.rule.toString(2).padStart(8, '0')}`,
      row: `${row} / ${rows - 1}`,
      live: `${live} / ${settings.cells}`,
    });
    status.textContent =
      row === 0
        ? 'Row 0 is the starting row. Click or drag on the canvas to edit it.'
        : `Row ${row}: each cell looked up its three neighbours in row ${row - 1}.`;
  }

  // --- Controls ---

  const counters = stats({ rule: 'Rule', row: 'Row', live: 'Live cells in row' });
  const status = el('p', { class: 'note' });
  const why = el('p', { class: 'note', style: 'flex-basis:100%' });

  const CELL =
    'display:block;width:0.6rem;height:0.6rem;border:1px solid var(--canvas-muted);box-sizing:border-box;';
  const fill = (on: number | boolean) =>
    `background:${on ? 'var(--canvas-ink)' : 'var(--canvas-bg)'};`;
  const tiles: { node: HTMLButtonElement; out: HTMLElement }[] = [];
  const tileRow = el('div', {
    style: 'display:grid;grid-template-columns:repeat(4,max-content);gap:0.4rem;',
    role: 'group',
    'aria-label': 'Rule table: click a tile to flip its output',
  });
  for (let index = 7; index >= 0; index--) {
    const out = el('span', { style: `${CELL}grid-column:2;` });
    const node = button('', () => setRule(toggleRuleBit(settings.rule, index)));
    node.setAttribute(
      'style',
      'display:grid;grid-template-columns:repeat(3,0.6rem);gap:2px;padding:0.3rem;min-height:0;min-width:0;line-height:0;',
    );
    node.append(
      el('span', { style: CELL + fill(index & 4) }),
      el('span', { style: CELL + fill(index & 2) }),
      el('span', { style: CELL + fill(index & 1) }),
      out,
    );
    tiles[index] = { node, out };
    tileRow.append(node);
  }

  const ruleSlider = slider({
    label: 'Rule number',
    min: 0,
    max: 255,
    value: settings.rule,
    onInput: setRule,
  });
  const presetSelect = select({
    label: 'Notable rules',
    options: [
      { id: 'other', name: 'Other' },
      ...NOTABLE.map((n) => ({ id: String(n.rule), name: `Rule ${n.rule}` })),
    ],
    value: 'other',
    onChange(id) {
      const preset = NOTABLE.find((n) => String(n.rule) === id);
      if (!preset) return;
      settings.rule = preset.rule;
      settings.start = preset.start;
      startSelect.input.value = preset.start;
      makeFirstRow();
      retrace(prefersReducedMotion() ? undefined : 0);
      if (!prefersReducedMotion()) player.play();
    },
  });
  const startSelect = select<Start>({
    label: 'Starting row',
    options: STARTS,
    value: settings.start as Start,
    onChange(start) {
      if (start === 'custom') settings.row = packBits(first);
      settings.start = start;
      makeFirstRow();
      retrace();
    },
  });

  function syncRuleControls() {
    const table = ruleTable(settings.rule);
    tiles.forEach(({ node, out }, index) => {
      out.setAttribute('style', `${CELL}grid-column:2;${fill(table[index])}`);
      const bits = index.toString(2).padStart(3, '0');
      node.setAttribute('aria-label', `${bits} gives ${table[index]}`);
      node.title = `${bits} gives ${table[index]}`;
      node.setAttribute('aria-pressed', String(table[index] === 1));
    });
    ruleSlider.set(settings.rule);
    const notable = NOTABLE.find((n) => n.rule === settings.rule);
    presetSelect.input.value = notable ? String(notable.rule) : 'other';
    why.textContent =
      notable?.why ?? `Rule ${settings.rule}: the eight outputs, read as a binary number.`;
  }

  // Editing the starting row: any click in a column sets that column's first cell.
  let paintValue = 1;
  const edit = (x: number) => {
    const { cell, left } = geometry();
    const column = Math.floor((x - left) / cell);
    if (column < 0 || column >= settings.cells || first[column] === paintValue) return;
    first[column] = paintValue;
    settings.start = 'custom';
    settings.row = packBits(first);
    startSelect.input.value = 'custom';
    retrace();
  };
  const stopDrag = onDrag(canvas, {
    down(point) {
      const { cell, left } = geometry();
      const column = Math.floor((point.x - left) / cell);
      if (column < 0 || column >= settings.cells) return false;
      paintValue = first[column] ? 0 : 1;
      edit(point.x);
      return true;
    },
    move: (point) => edit(point.x),
  });

  panel.append(
    fieldset(
      'Rule',
      presetSelect.root,
      ruleSlider.root,
      tileRow,
      el('p', {
        class: 'note',
        text: 'Top: a cell and its two neighbours. Bottom: the cell on the next row. Click a tile to flip it.',
      }),
    ),
    fieldset(
      'Cells',
      startSelect.root,
      button('New random row', () => {
        settings.seed = newSeed();
        settings.start = 'random';
        startSelect.input.value = 'random';
        makeFirstRow();
        retrace();
      }),
      slider({
        label: 'Width',
        min: MIN_CELLS,
        max: MAX_CELLS,
        step: 2,
        value: settings.cells,
        format: (v) => `${v} cells`,
        onInput(value) {
          settings.cells = value;
          makeFirstRow();
          retrace();
        },
      }).root,
      checkbox({
        label: 'Wrap around at the edges',
        checked: settings.wrap,
        onChange(checked) {
          settings.wrap = checked;
          retrace();
        },
      }),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    why,
    legend([
      ['var(--canvas-ink)', 'Live cell'],
      ['var(--canvas-accent)', 'Newest row'],
    ]),
  );

  about.append(
    prose(
      'The automaton is a row of cells, each on or off. To get the next row, every cell looks at itself and its two neighbours. Three cells have 8 possible patterns, and a rule says on or off for each, so there are `2^8 = 256` rules.',
    ),
    formula(
      'next[i] = bit (4·row[i−1] + 2·row[i] + row[i+1]) of the rule number\n\nrule 30 = 00011110₂ :  111→0 110→0 101→0 100→1 011→1 010→1 001→1 000→0',
    ),
    prose(
      'The rule number is just the eight outputs read as a binary number, with the pattern `111` as the high bit. Flip a tile and the number changes with it. Each row costs `O(n)` for `n` cells.',
    ),
    prose(
      'Rules this simple fall into a few kinds of behaviour: some die out or repeat, some make nested triangles (90, 150), some look random (30, 45), and a few sit in between with moving structures (110).',
    ),
  );

  makeFirstRow();
  // Only the first row exists until the person presses Play or Step.
  retrace(0);

  return () => {
    stopDrag();
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
