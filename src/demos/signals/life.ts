import {
  packBits,
  parseRle,
  parseRule,
  placePattern,
  stepLife,
  unpackBits,
} from '../../core/automata/life';
import { newSeed, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select } from '../../ui/dom';
import { simPlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { hexToRgb, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, formula, prose, stats, type Mount } from '../layout';
import { snapshotRing } from './ring';
import { FONT, SMALL } from '../../ui/font';

const COLS = 96;
const ROWS = 72;
const SIZE = COLS * ROWS;
/** Generations the Back button can undo. */
const HISTORY = 400;
/** Points kept for the population graph. */
const SPARK_POINTS = 300;

const RULES = [
  { id: 'life', name: 'Life (B3/S23)', notation: 'B3/S23' },
  { id: 'highlife', name: 'HighLife (B36/S23)', notation: 'B36/S23' },
  { id: 'seeds', name: 'Seeds (B2/S)', notation: 'B2/S' },
  { id: 'daynight', name: 'Day and Night (B3678/S34678)', notation: 'B3678/S34678' },
  { id: 'replicator', name: 'Replicator (B1357/S1357)', notation: 'B1357/S1357' },
  { id: 'maze', name: 'Maze (B3/S12345)', notation: 'B3/S12345' },
] as const;

const PRESETS = [
  {
    id: 'gosper',
    name: 'Gosper glider gun',
    rle: '24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4bobo$10bo5bo7bo$11bo3bo$12b2o!',
    at: [0.3, 0.2],
    wrap: false,
    note: 'The gun fires a glider every 30 generations. Bounded edges destroy them at the border; on a torus they come back and wreck the gun.',
  },
  {
    id: 'glider',
    name: 'Glider',
    rle: 'bob$2bo$3o!',
    at: [0.2, 0.2],
    wrap: true,
    note: 'Five cells that rebuild themselves one cell down and right every 4 generations.',
  },
  {
    id: 'rpent',
    name: 'R-pentomino',
    rle: 'b2o$2o$bo!',
    at: [0.5, 0.5],
    wrap: true,
    note: 'Five cells that take over a thousand generations to settle on an open plane.',
  },
  {
    id: 'pulsar',
    name: 'Pulsar',
    rle: '2b3o3b3o2$o4bobo4bo$o4bobo4bo$o4bobo4bo$2b3o3b3o2$2b3o3b3o$o4bobo4bo$o4bobo4bo$o4bobo4bo2$2b3o3b3o!',
    at: [0.5, 0.5],
    wrap: true,
    note: 'An oscillator that repeats every 3 generations.',
  },
  {
    id: 'acorn',
    name: 'Acorn',
    rle: 'bo$3bo$2o2b3o!',
    at: [0.55, 0.5],
    wrap: true,
    note: 'Seven cells that grow for thousands of generations and throw off gliders.',
  },
  {
    id: 'soup',
    name: 'Random soup',
    rle: '',
    at: [0.5, 0.5],
    wrap: true,
    note: 'A third of the cells start alive, at random.',
  },
] as const;

interface Snapshot {
  cells: Uint8Array;
  generation: number;
  population: number;
}

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'Grid of cells that are born, survive or die each generation.',
  );

  const url = urlState({
    rule: 'life',
    preset: 'gosper',
    seed: 1,
    wrap: false,
    cells: '',
    speed: 1,
  });
  const settings = url.state;
  if (!RULES.some((r) => r.id === settings.rule)) settings.rule = 'life';
  if (settings.preset !== 'custom' && !PRESETS.some((p) => p.id === settings.preset)) {
    settings.preset = 'gosper';
  }
  settings.cells = settings.cells.slice(0, 2 * SIZE);

  let rule = parseRule(RULES.find((r) => r.id === settings.rule)?.notation ?? 'B3/S23');
  let cells = new Uint8Array(SIZE);
  let next = new Uint8Array(SIZE);
  /** What Reset returns to: the pattern the URL describes. */
  let start: Uint8Array = new Uint8Array(SIZE);
  let generation = 0;
  let population = 0;
  let message = '';
  let graph: number[] = [];
  const ring = snapshotRing<Snapshot>(HISTORY, () => ({
    cells: new Uint8Array(SIZE),
    generation: 0,
    population: 0,
  }));

  const image = document.createElement('canvas');
  image.width = COLS;
  image.height = ROWS;
  const imageCtx = image.getContext('2d');
  const sparkCanvas = el('canvas', {
    role: 'img',
    'aria-label': 'Graph of the population over recent generations',
    style: 'display:block;width:100%;height:2.75rem;',
  });

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());

  // --- Model ---

  const count = (grid: Uint8Array) => grid.reduce((sum, v) => sum + v, 0);

  function buildStart() {
    start = new Uint8Array(SIZE);
    const preset = PRESETS.find((p) => p.id === settings.preset);
    if (!preset) {
      start = unpackBits(settings.cells, SIZE);
    } else if (preset.id === 'soup') {
      const random = seeded(settings.seed);
      for (let i = 0; i < SIZE; i++) start[i] = random() < 0.33 ? 1 : 0;
    } else {
      placePattern(
        start,
        COLS,
        ROWS,
        parseRle(preset.rle),
        COLS * preset.at[0],
        ROWS * preset.at[1],
      );
    }
  }

  function restart() {
    cells = start.slice();
    generation = 0;
    population = count(cells);
    graph = [population];
    message = PRESETS.find((p) => p.id === settings.preset)?.note ?? 'Your own pattern.';
    ring.clear();
    player?.clearHistory();
  }

  function step() {
    ring.push((slot) => {
      slot.cells.set(cells);
      slot.generation = generation;
      slot.population = population;
    });
    population = stepLife(cells, next, COLS, ROWS, rule, settings.wrap);
    let born = 0;
    let died = 0;
    for (let i = 0; i < SIZE; i++) {
      if (cells[i] !== next[i]) {
        if (next[i]) born++;
        else died++;
      }
    }
    [cells, next] = [next, cells];
    generation++;
    graph.push(population);
    if (graph.length > SPARK_POINTS) graph.shift();
    message =
      population === 0
        ? 'Every cell is dead.'
        : born + died === 0
          ? 'Still life: nothing changed this generation.'
          : `Generation ${generation}: ${born} born, ${died} died.`;
  }

  function back() {
    const slot = ring.pop();
    if (!slot) {
      message = 'No earlier generation is saved.';
      player.clearHistory();
      return;
    }
    cells.set(slot.cells);
    generation = slot.generation;
    population = slot.population;
    if (graph.length > 1) graph.pop();
    message = `Back to generation ${generation}.`;
    // The player counts frames, not generations: once the last saved generation is used, Back is spent.
    if (ring.size === 0) player.clearHistory();
  }

  /** The user's drawing becomes the pattern in the URL and the Reset target. */
  function saveDrawing() {
    population = count(cells);
    graph[graph.length - 1] = population;
    start = cells.slice();
    settings.preset = 'custom';
    settings.cells = packBits(cells);
    presetSelect.input.value = 'custom';
    url.save();
  }

  // --- Rendering ---

  function geometry() {
    const cell = Math.min(stage.width / COLS, stage.height / ROWS);
    return {
      cell,
      left: (stage.width - cell * COLS) / 2,
      top: (stage.height - cell * ROWS) / 2,
    };
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    const { cell, left, top } = geometry();

    if (imageCtx) {
      const data = imageCtx.createImageData(COLS, ROWS);
      const [r, g, b] = hexToRgb(palette.ink);
      for (let i = 0; i < SIZE; i++) {
        if (!cells[i]) continue;
        data.data[4 * i] = r;
        data.data[4 * i + 1] = g;
        data.data[4 * i + 2] = b;
        data.data[4 * i + 3] = 255;
      }
      imageCtx.putImageData(data, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, left, top, cell * COLS, cell * ROWS);
    }

    if (cell >= 5) {
      ctx.beginPath();
      for (let c = 0; c <= COLS; c++) {
        const x = Math.round(left + c * cell) + 0.5;
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + cell * ROWS);
      }
      for (let r = 0; r <= ROWS; r++) {
        const y = Math.round(top + r * cell) + 0.5;
        ctx.moveTo(left, y);
        ctx.lineTo(left + cell * COLS, y);
      }
      ctx.strokeStyle = palette.faint;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    counters.set({ generation, population });
    status.textContent = message;
    drawSpark();
  }

  function drawSpark() {
    const { ctx, width, height } = spark;
    const { palette } = theme;
    ctx.clearRect(0, 0, width, height);
    const top = Math.max(1, ...graph);
    const pad = 3;
    ctx.beginPath();
    graph.forEach((value, i) => {
      const x = pad + (i / (SPARK_POINTS - 1)) * (width - 2 * pad);
      const y = height - pad - (value / top) * (height - 2 * pad);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = palette.muted;
    ctx.font = `${SMALL}px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`population, peak ${top}`, width - pad, 0);
  }

  // --- Controls ---

  const counters = stats({ generation: 'Generation', population: 'Population' });
  const status = el('p', { class: 'note' });

  const player = simPlayer<number>({
    step,
    draw,
    snapshot: () => 0,
    restore: back,
    // The player saves a token per frame; the grids themselves live in `ring`.
    history: 4 * HISTORY,
    reset: restart,
    ticksPerSecond: 10,
    speed: Math.max(0.25, Math.min(8, settings.speed)),
    minSpeed: 0.25,
    maxSpeed: 8,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
  });

  const presetSelect = select({
    label: 'Pattern',
    options: [...PRESETS, { id: 'custom', name: 'Drawn by hand' }],
    value: settings.preset,
    onChange(id) {
      if (id === 'custom') {
        saveDrawing();
        return;
      }
      settings.preset = id;
      settings.cells = '';
      const preset = PRESETS.find((p) => p.id === id);
      if (preset) {
        settings.wrap = preset.wrap;
        wrapBox.checked = preset.wrap;
      }
      url.save();
      buildStart();
      restart();
      draw();
    },
  });
  const wrapCheck = checkbox({
    label: 'Wrap around (torus)',
    checked: settings.wrap,
    onChange(checked) {
      settings.wrap = checked;
      url.save();
    },
  });
  const wrapBox = wrapCheck.querySelector('input') as HTMLInputElement;

  // Drawing: the first cell touched decides whether this stroke draws or erases.
  let paintValue = 1;
  let last: [number, number] | undefined;
  const cellAt = (x: number, y: number): [number, number] => {
    const { cell, left, top } = geometry();
    return [
      Math.max(0, Math.min(COLS - 1, Math.floor((x - left) / cell))),
      Math.max(0, Math.min(ROWS - 1, Math.floor((y - top) / cell))),
    ];
  };
  const paintTo = (cx: number, cy: number) => {
    let [x, y] = last ?? [cx, cy];
    const steps = Math.max(Math.abs(cx - x), Math.abs(cy - y), 1);
    const dx = (cx - x) / steps;
    const dy = (cy - y) / steps;
    for (let i = 0; i <= steps; i++) {
      cells[Math.round(y) * COLS + Math.round(x)] = paintValue;
      x += dx;
      y += dy;
    }
    last = [cx, cy];
    saveDrawing();
    message = paintValue ? 'Drawing cells.' : 'Erasing cells.';
    draw();
  };
  const stopDrag = onDrag(canvas, {
    down(point) {
      const [cx, cy] = cellAt(point.x, point.y);
      paintValue = cells[cy * COLS + cx] ? 0 : 1;
      last = undefined;
      paintTo(cx, cy);
      return true;
    },
    move(point) {
      paintTo(...cellAt(point.x, point.y));
    },
  });

  const spark = createStage(sparkCanvas, () => drawSpark());

  panel.append(
    fieldset(
      'Pattern',
      presetSelect.root,
      el(
        'div',
        { class: 'buttons' },
        button('New soup', () => {
          settings.seed = newSeed();
          settings.preset = 'soup';
          settings.cells = '';
          presetSelect.input.value = 'soup';
          url.save();
          buildStart();
          restart();
          draw();
        }),
        button('Clear', () => {
          cells.fill(0);
          saveDrawing();
          restart();
          draw();
        }),
      ),
      el('p', { class: 'note', text: 'Drag on the grid to draw. Start on a live cell to erase.' }),
    ),
    fieldset(
      'Rule',
      select({
        label: 'Births / survivals',
        options: RULES,
        value: settings.rule,
        onChange(id) {
          settings.rule = id;
          rule = parseRule(RULES.find((r) => r.id === id)?.notation ?? 'B3/S23');
          url.save();
        },
      }).root,
      wrapCheck,
    ),
    player.root,
  );

  readout.append(counters.root, status, sparkCanvas);

  about.append(
    prose(
      'Every cell is alive or dead and has eight neighbours. All cells update at once. In Conway’s rule a dead cell with exactly 3 live neighbours is born, a live cell with 2 or 3 survives, and every other cell is dead in the next generation.',
    ),
    formula(
      'n = live neighbours of the cell (0..8)\n\nalive next  =  (dead and n ∈ B)  or  (alive and n ∈ S)\n\nLife: B = {3}, S = {2, 3}        written B3/S23',
    ),
    prose(
      'Other rules only change the two sets. HighLife adds a birth at 6 and has a pattern that copies itself. Seeds has no survivals at all, so everything explodes. Day and Night is symmetric: swapping live and dead gives the same behaviour.',
    ),
    prose(
      'One generation costs `O(cells)`: each cell reads 8 neighbours. On a torus the left edge touches the right and the top touches the bottom, so a glider that leaves comes back. With bounded edges everything outside counts as dead.',
    ),
  );

  buildStart();
  restart();
  draw();

  return () => {
    stopDrag();
    player.dispose();
    stage.dispose();
    spark.dispose();
    theme.dispose();
  };
};
