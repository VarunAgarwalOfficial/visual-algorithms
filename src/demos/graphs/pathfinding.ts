import { packCells, unpackCells } from '../../core/encode';
import {
  FREE,
  GRID_ALGORITHMS,
  MUD,
  MUD_COST,
  WALL,
  emptyGrid,
  mazeGrid,
  randomGrid,
  searchGrid,
  type Grid,
  type GridAlgorithm,
  type Heuristic,
  type SearchResult,
} from '../../core/graphs/grid';
import { newSeed, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { onDrag } from '../../ui/pointer';
import { mix, watchPalette } from '../../ui/theme';
import { phoneDefault, urlState } from '../../ui/url';
import { FONT, labelSize } from '../../ui/font';
import { buildLayout, formula, legend, prose, stats, type Mount } from '../layout';

type Preset = 'random' | 'maze' | 'empty';
const PRESETS: readonly { id: Preset; name: string }[] = [
  { id: 'random', name: 'Random obstacles' },
  { id: 'maze', name: 'Maze' },
  { id: 'empty', name: 'Empty' },
];
type Brush = 'wall' | 'mud';
const BRUSHES: readonly { id: Brush; name: string }[] = [
  { id: 'wall', name: 'Walls' },
  { id: 'mud', name: `Mud (${MUD_COST}× the cost of a step)` },
];
const HEURISTICS: readonly { id: Heuristic; name: string }[] = [
  { id: 'manhattan', name: 'Manhattan: steps across plus steps down' },
  { id: 'octile', name: 'Octile: allows for diagonal steps' },
];
/** Names for the comparison table and the menu, with no abbreviations. */
const SHORT: Record<GridAlgorithm, string> = {
  astar: 'A* (A star)',
  dijkstra: 'Dijkstra',
  bfs: 'Breadth-first',
  dfs: 'Depth-first',
  greedy: 'Greedy best-first',
  bidirectional: 'Bidirectional breadth-first',
  jps: 'Jump point search',
};

const MIN_COLS = 11;
const MAX_COLS = 61;
const odd = (v: number) => (v % 2 === 0 ? v - 1 : v);
const format = (cost: number) => (Number.isInteger(cost) ? String(cost) : cost.toFixed(1));

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'A grid of cells with walls, a start and a goal. The search colours the cells it has reached.',
  );

  const url = urlState({
    alg: 'astar',
    h: 'manhattan',
    diag: false,
    cols: 31,
    preset: 'random',
    brush: 'wall',
    seed: 4,
    // `paint` is what was painted, as the difference from the preset. `cells` is the
    // whole grid, as older links stored it: still read, no longer written.
    paint: '',
    cells: '',
    s: -1,
    g: -1,
    speed: 120,
  });
  const settings = url.state;
  // Cells a finger can hit.
  if (phoneDefault()) settings.cols = 19;
  settings.cols = odd(Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(settings.cols))));
  const info = () => GRID_ALGORITHMS.find((a) => a.id === settings.alg) ?? GRID_ALGORITHMS[0];
  const heuristic = (): Heuristic => (settings.h === 'octile' ? 'octile' : 'manhattan');
  const preset = (): Preset => PRESETS.find((p) => p.id === settings.preset)?.id ?? 'random';
  if (info().id === 'jps') settings.diag = true;

  let grid: Grid = emptyGrid(1, 1);
  /** The preset grid before any painting: the link stores only how `grid` differs from it. */
  let base = new Uint8Array(1);
  let start = 0;
  let goal = 0;
  let result: SearchResult = { steps: [], path: [], cost: 0 };
  // Playback state, rebuilt by applying steps: 0 unseen, 1 frontier, 2 expanded.
  let state = new Uint8Array(0);
  let fromGoal = new Uint8Array(0);
  let scanned = new Uint8Array(0);
  let cursor = 0;
  let frontier = 0;

  const theme = watchPalette(() => draw());
  const stage = createStage(canvas, () => draw());
  const player = tracePlayer({
    speed: settings.speed,
    maxSpeed: 2000,
    onSpeed(value) {
      settings.speed = value;
      url.save();
    },
    render(position) {
      if (position < cursor) resetState();
      for (; cursor < position; cursor++) apply(cursor);
      update();
    },
  });

  // --- Model ---

  const rowsFor = (cols: number) => odd(Math.round((cols * 3) / 4));

  function defaultEnds(): [number, number] {
    const y = Math.floor(grid.rows / 2) | 1;
    return [
      Math.min(y, grid.rows - 1) * grid.cols + 1,
      Math.min(y, grid.rows - 1) * grid.cols + grid.cols - 2,
    ];
  }

  /** Builds the grid from the preset and seed, or from painted cells in the URL. */
  function loadGrid() {
    const cols = settings.cols;
    const rows = rowsFor(cols);
    const random = seeded(settings.seed);
    if (preset() === 'maze') grid = mazeGrid(cols, rows, random);
    else if (preset() === 'empty') grid = emptyGrid(cols, rows);
    else grid = randomGrid(cols, rows, random);
    base = grid.cells.slice();
    const n = cols * rows;
    if (settings.paint) {
      // Each value is how far the cell is from the preset, counting FREE, WALL, MUD in a ring.
      const change = unpackCells(settings.paint.slice(0, 2 * n), n);
      for (let i = 0; i < n; i++) grid.cells[i] = (base[i] + (change[i] % 3)) % 3;
    } else if (settings.cells) {
      grid.cells = unpackCells(settings.cells.slice(0, 2 * n), n);
      for (let i = 0; i < n; i++) if (grid.cells[i] > MUD) grid.cells[i] = FREE;
    }

    [start, goal] = defaultEnds();
    const inRange = (v: number) => Number.isInteger(v) && v >= 0 && v < cols * rows;
    if (inRange(settings.s) && inRange(settings.g) && settings.s !== settings.g) {
      start = settings.s;
      goal = settings.g;
    }
    grid.cells[start] = FREE;
    grid.cells[goal] = FREE;
  }

  function resetState() {
    const n = grid.cells.length;
    state = new Uint8Array(n);
    fromGoal = new Uint8Array(n);
    scanned = new Uint8Array(n);
    state[start] = 1;
    if (settings.alg === 'bidirectional') {
      state[goal] = 1;
      fromGoal[goal] = 1;
    }
    frontier = settings.alg === 'bidirectional' ? 2 : 1;
    cursor = 0;
  }

  function apply(index: number) {
    const step = result.steps[index];
    if (state[step.node] === 1) frontier--;
    state[step.node] = 2;
    for (const cell of step.opened) {
      // In a bidirectional search the other side may already hold this cell.
      if (state[cell] !== 0) continue;
      state[cell] = 1;
      if (step.side) fromGoal[cell] = 1;
      frontier++;
    }
    if (step.scanned) for (const cell of step.scanned) scanned[cell] = 1;
  }

  const options = () => ({ diagonal: settings.diag, heuristic: heuristic() });

  /** Re-runs the search. `keepEnd` leaves the player on the finished result, for live editing. */
  function retrace(keepEnd = false) {
    result = searchGrid(info().id, grid, start, goal, options());
    resetState();
    caption.textContent = info().summary;
    showKey();
    compare();
    player.setLength(result.steps.length, keepEnd ? result.steps.length : 0);
    url.save();
  }

  /** The key lists only the kinds of cell this grid and search can show. */
  function showKey() {
    const items: [string, string][] = [
      ['var(--canvas-ink)', 'S: start'],
      ['var(--canvas-ink)', 'G: goal'],
      ['color-mix(in srgb, var(--canvas-ink) 70%, var(--canvas-bg))', 'Wall'],
    ];
    if (grid.cells.includes(MUD)) {
      items.push([
        'repeating-linear-gradient(135deg, var(--canvas-muted) 0 1.5px, var(--canvas-faint) 1.5px 4px)',
        `Mud, hatched (costs ${MUD_COST} steps to cross)`,
      ]);
    }
    items.push(
      ['var(--canvas-compare)', 'Reached, waiting to be visited'],
      ['var(--canvas-visit)', 'Visited'],
    );
    if (settings.alg === 'bidirectional') {
      items.push([
        'color-mix(in srgb, var(--canvas-visit) 55%, var(--canvas-accent))',
        'Visited by the search from the goal',
      ]);
    }
    if (settings.alg === 'jps') {
      items.push([
        'color-mix(in srgb, var(--canvas-visit) 40%, var(--canvas-bg))',
        'Looked at while sliding past',
      ]);
    }
    items.push(['var(--canvas-good)', 'Route found (at the end)']);
    key.replaceChildren(...legend(items).children);
  }

  /** Runs every algorithm on the current grid so their costs can be read side by side. */
  function compare() {
    const values: Partial<Record<GridAlgorithm, string>> = {};
    for (const { id } of GRID_ALGORITHMS) {
      if (id === 'jps' && !settings.diag) {
        values[id] = 'needs diagonals';
        continue;
      }
      const run = id === settings.alg ? result : searchGrid(id, grid, start, goal, options());
      values[id] = run.path.length > 0 ? `${run.steps.length} · ${format(run.cost)}` : 'no path';
    }
    table.set(values);
  }

  /** Saves the painted grid and the end points into the URL. */
  function saveGrid() {
    const change = grid.cells.map((v, i) => (v - base[i] + 3) % 3);
    let end = change.length;
    while (end > 0 && change[end - 1] === 0) end--;
    settings.paint = packCells(change.subarray(0, end));
    settings.cells = '';
    const [s, g] = defaultEnds();
    settings.s = start === s && goal === g ? -1 : start;
    settings.g = start === s && goal === g ? -1 : goal;
  }

  function newGrid() {
    settings.paint = '';
    settings.cells = '';
    settings.s = -1;
    settings.g = -1;
    loadGrid();
    retrace();
  }

  // --- Rendering ---

  function geometry() {
    const cell = Math.min(stage.width / grid.cols, stage.height / grid.rows);
    return {
      cell,
      ox: (stage.width - cell * grid.cols) / 2,
      oy: (stage.height - cell * grid.rows) / 2,
    };
  }

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const { cols, rows, cells } = grid;
    const { cell, ox, oy } = geometry();
    ctx.clearRect(0, 0, width, height);
    const px = (x: number) => Math.round(ox + x * cell);
    const py = (y: number) => Math.round(oy + y * cell);
    const centre = (i: number): [number, number] => [
      ox + ((i % cols) + 0.5) * cell,
      oy + (Math.floor(i / cols) + 0.5) * cell,
    ];

    const wall = mix(palette.ink, palette.bg, 0.3);
    const otherSide = mix(palette.visit, palette.accent, 0.45);
    const scan = mix(palette.visit, palette.bg, 0.6);
    for (let i = 0; i < cells.length; i++) {
      let colour: string | undefined;
      if (cells[i] === WALL) colour = wall;
      // Untouched, nothing is waiting yet; the start is only marked by its letter.
      else if (state[i] === 1 && cursor > 0) colour = palette.compare;
      else if (state[i] === 2) colour = fromGoal[i] ? otherSide : palette.visit;
      else if (scanned[i]) colour = scan;
      else if (cells[i] === MUD) colour = palette.faint;
      if (!colour) continue;
      const x = i % cols;
      const y = (i - x) / cols;
      ctx.fillStyle = colour;
      ctx.fillRect(px(x), py(y), px(x + 1) - px(x), py(y + 1) - py(y));
    }

    // Mud is hatched so it stays visible under the search colours.
    ctx.strokeStyle = palette.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== MUD) continue;
      const x = px(i % cols);
      const y = py(Math.floor(i / cols));
      const s = px((i % cols) + 1) - x;
      ctx.moveTo(x, y + s);
      ctx.lineTo(x + s, y);
      if (s >= 10) {
        ctx.moveTo(x, y + s / 2);
        ctx.lineTo(x + s / 2, y);
        ctx.moveTo(x + s / 2, y + s);
        ctx.lineTo(x + s, y + s / 2);
      }
    }
    ctx.stroke();

    if (cell >= 7) {
      ctx.strokeStyle = palette.faint;
      ctx.beginPath();
      for (let x = 0; x <= cols; x++) {
        ctx.moveTo(px(x) + 0.5, py(0));
        ctx.lineTo(px(x) + 0.5, py(rows));
      }
      for (let y = 0; y <= rows; y++) {
        ctx.moveTo(px(0), py(y) + 0.5);
        ctx.lineTo(px(cols), py(y) + 0.5);
      }
      ctx.stroke();
    }

    const done = cursor >= result.steps.length;
    if (done && result.path.length > 1) {
      ctx.strokeStyle = palette.good;
      ctx.lineWidth = Math.max(2, cell * 0.36);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      result.path.forEach((i, k) => {
        const [x, y] = centre(i);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else if (cursor > 0) {
      const node = result.steps[cursor - 1].node;
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(px(node % cols) + 1, py(Math.floor(node / cols)) + 1, cell - 2, cell - 2);
    }

    const marker = (i: number, colour: string, letter: string) => {
      const [x, y] = centre(i);
      const r = Math.max(5, cell * 0.48);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = palette.bg;
      ctx.stroke();
      ctx.fillStyle = palette.bg;
      ctx.font = `600 ${labelSize(Math.max(8, Math.round(r * 1.2)))}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, x, y + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    };
    // Start and goal are named by their letters, in the ink: they are places, not states.
    marker(start, palette.ink, 'S');
    marker(goal, palette.ink, 'G');
  }

  function update() {
    draw();
    const total = result.steps.length;
    const done = cursor >= total;
    const found = result.path.length > 0;
    counters.set({
      expanded: cursor,
      // Before the first step nothing has been reached: the start joins the waiting list when the search begins.
      frontier: cursor === 0 ? 0 : frontier,
      steps: done && found ? result.path.length - 1 : '–',
      cost: done && found ? format(result.cost) : '–',
    });
    const at = (i: number) => `column ${(i % grid.cols) + 1}, row ${Math.floor(i / grid.cols) + 1}`;
    if (!done) {
      if (cursor === 0)
        status.textContent = `Nothing has run yet. ${info().name === 'A*' ? 'A* (A star)' : info().name} will look for a route from S to G around the walls (the solid grey squares). Press Play to watch it, or Step forward to go one cell at a time.`;
      else {
        const step = result.steps[cursor - 1];
        const fresh = step.opened.length;
        status.textContent =
          `Visit the outlined cell at ${at(step.node)}${step.side ? ', searching from the goal' : ''}: ` +
          (fresh === 0
            ? 'no new neighbours to add.'
            : `${fresh} neighbour${fresh === 1 ? '' : 's'} reached for the first time, now waiting to be visited.`);
      }
      return;
    }
    if (!found) {
      status.textContent = `No route: walls cut G off from S. ${total} cells visited.`;
      return;
    }
    let text = `Route found: ${result.path.length - 1} steps from S to G, costing ${format(result.cost)}, after visiting ${total} cells.`;
    if (info().unweighted && grid.cells.includes(MUD)) {
      text +=
        ' This search ignores mud when choosing where to go, so a cheaper path may exist. The cost shown still counts the mud on its path.';
    } else if (info().id === 'astar' && settings.diag && heuristic() === 'manhattan') {
      text +=
        ' Manhattan distance overestimates diagonal moves, so this may not be the cheapest path.';
    }
    status.textContent = text;
  }

  // --- Pointer: paint cells, drag the ends ---

  let dragging: 'start' | 'goal' | 'paint' = 'paint';
  let paintValue = WALL;
  const cellAt = (x: number, y: number): number => {
    const { cell, ox, oy } = geometry();
    const cx = Math.floor((x - ox) / cell);
    const cy = Math.floor((y - oy) / cell);
    if (cx < 0 || cy < 0 || cx >= grid.cols || cy >= grid.rows) return -1;
    return cy * grid.cols + cx;
  };
  let lastCell = -1;
  function touch(i: number) {
    if (i < 0 || i === lastCell) return;
    // Fill in the cells between two pointer events so fast strokes leave no gaps.
    const line: number[] = [];
    if (lastCell >= 0 && dragging === 'paint') {
      const x0 = lastCell % grid.cols;
      const y0 = Math.floor(lastCell / grid.cols);
      const x1 = i % grid.cols;
      const y1 = Math.floor(i / grid.cols);
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let k = 1; k <= n; k++) {
        line.push(
          Math.round(y0 + ((y1 - y0) * k) / n) * grid.cols + Math.round(x0 + ((x1 - x0) * k) / n),
        );
      }
    } else line.push(i);
    lastCell = i;
    const wasAtEnd = player.position >= player.length;
    if (dragging === 'paint') {
      for (const c of line) if (c !== start && c !== goal) grid.cells[c] = paintValue;
    } else if (grid.cells[i] !== WALL && i !== start && i !== goal) {
      if (dragging === 'start') start = i;
      else goal = i;
    } else return;
    saveGrid();
    retrace(wasAtEnd);
  }
  const stopDrag = onDrag(canvas, {
    down(p) {
      const i = cellAt(p.x, p.y);
      if (i < 0) return false;
      lastCell = -1;
      if (i === start || i === goal) {
        dragging = i === start ? 'start' : 'goal';
        lastCell = i;
        return true;
      }
      dragging = 'paint';
      const brush = settings.brush === 'mud' ? MUD : WALL;
      paintValue = grid.cells[i] === brush ? FREE : brush;
      touch(i);
      return true;
    },
    move(p) {
      touch(cellAt(p.x, p.y));
    },
  });

  // --- Controls ---

  const counters = stats({
    expanded: 'Cells visited',
    frontier: 'Cells waiting',
    steps: 'Route steps',
    cost: 'Route cost',
  });
  const table = stats(
    Object.fromEntries(GRID_ALGORITHMS.map((a) => [a.id, SHORT[a.id]])) as Record<
      GridAlgorithm,
      string
    >,
  );
  const status = el('p', { class: 'note', style: 'flex: 1 1 100%; min-height: 2.8em' });
  const caption = el('p', { class: 'note' });
  const key = el('ul', { class: 'legend' });

  const presetSelect = select<Preset>({
    label: 'Preset',
    options: PRESETS,
    value: preset(),
    onChange(id) {
      settings.preset = id;
      newGrid();
    },
  });
  const algorithmSelect = select<GridAlgorithm>({
    label: 'Algorithm',
    options: GRID_ALGORITHMS.map((a) => ({ id: a.id, name: SHORT[a.id] })),
    value: info().id,
    onChange(id) {
      settings.alg = id;
      if (id === 'jps' && !settings.diag) setDiagonal(true);
      retrace();
    },
  });
  const heuristicSelect = select<Heuristic>({
    label: 'Distance guess (used by A* and greedy)',
    options: HEURISTICS,
    value: heuristic(),
    onChange(id) {
      settings.h = id;
      retrace();
    },
  });
  const diagonalBox = checkbox({
    label: 'Diagonal moves',
    checked: settings.diag,
    onChange(checked) {
      setDiagonal(checked);
      if (!checked && settings.alg === 'jps') {
        settings.alg = 'astar';
        algorithmSelect.input.value = 'astar';
      }
      retrace();
    },
  });
  /** Switching the move set also picks the heuristic that fits it. */
  function setDiagonal(on: boolean) {
    settings.diag = on;
    settings.h = on ? 'octile' : 'manhattan';
    heuristicSelect.input.value = settings.h;
    const box = diagonalBox.querySelector('input');
    if (box) box.checked = on;
  }

  panel.append(
    fieldset('Search', algorithmSelect.root, caption, heuristicSelect.root, diagonalBox),
    fieldset(
      'Grid',
      select<Brush>({
        label: 'Dragging paints',
        options: BRUSHES,
        value: settings.brush === 'mud' ? 'mud' : 'wall',
        onChange(id) {
          settings.brush = id;
          url.save();
        },
      }).root,
      presetSelect.root,
      slider({
        label: 'Grid width (cells)',
        min: MIN_COLS,
        max: MAX_COLS,
        step: 2,
        value: settings.cols,
        onInput(value) {
          settings.cols = odd(value);
          newGrid();
        },
      }).root,
      el(
        'div',
        { class: 'buttons' },
        button('New layout', () => {
          settings.seed = newSeed();
          newGrid();
        }),
        button('Clear', () => {
          // The same as the empty preset with nothing painted; the start and goal stay put.
          settings.preset = 'empty';
          presetSelect.input.value = 'empty';
          settings.paint = '';
          settings.cells = '';
          loadGrid();
          retrace();
        }),
      ),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    key,
    el(
      'details',
      {},
      el('summary', { text: 'Compare every algorithm on this grid' }),
      el('p', {
        class: 'note',
        text: `Each entry is the number of cells visited, then the cost of the route found. Mud counts as ${MUD_COST} steps. Only A* and Dijkstra avoid mud while searching; the others treat it as floor.`,
      }),
      table.root,
    ),
  );

  about.append(
    prose(
      'Drag on the grid to paint walls or mud, and drag the start or goal to move it. Every search keeps a frontier of cells it has reached but not yet expanded. The algorithms differ only in which frontier cell they take next.',
    ),
    formula(
      'breadth-first   oldest cell first          (queue)\ndepth-first     newest cell first          (stack)\nDijkstra        lowest g                   g = cost from the start\ngreedy          lowest h                   h = estimated cost to the goal\nA*              lowest f = g + h',
    ),
    prose(
      `A straight step costs 1, a diagonal step \`√2\`, and entering mud costs ${MUD_COST} times as much. Only Dijkstra and A* take the mud into account while searching. The others treat it as plain floor, and the cost shown for them is the true cost of the path they happened to find. A diagonal step is not allowed to cut a wall corner. A* finds a cheapest path when \`h\` never overestimates: Manhattan distance \`|dx| + |dy|\` is right for four directions, octile distance \`max + (√2 − 1)·min\` for eight. Try Manhattan with diagonal moves to see A* go wrong.`,
    ),
    prose(
      'Bidirectional search grows two smaller regions instead of one large one. Jump point search is A* on a uniform eight-way grid: it slides along straight lines and adds a cell to the frontier only where a wall corner forces a choice, so it expands far fewer cells. The pale cells are the ones it looked at while sliding.',
    ),
    prose(
      'With a binary heap, Dijkstra and A* take `O(n log n)` time on a grid of `n` cells; the two breadth-first searches and depth-first search take `O(n)`.',
    ),
  );

  loadGrid();
  retrace();

  return () => {
    stopDrag();
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
