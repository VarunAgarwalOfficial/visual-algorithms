import {
  MAZE_ALGORITHMS,
  N,
  W,
  applyMazeStep,
  deadEnds,
  generateMaze,
  mazeState,
  solveMaze,
  type Maze,
  type MazeAlgorithm,
  type MazeState,
  type MazeStep,
} from '../../core/graphs/maze';
import { newSeed, seeded } from '../../core/random';
import { createStage } from '../../ui/canvas';
import { button, checkbox, el, fieldset, select, slider } from '../../ui/dom';
import { tracePlayer } from '../../ui/player';
import { mix, watchPalette } from '../../ui/theme';
import { urlState } from '../../ui/url';
import { buildLayout, legend, prose, stats, type Mount } from '../layout';

const MIN_COLS = 6;
const MAX_COLS = 40;

export const mount: Mount = (root, entry) => {
  const { canvas, readout, panel, about } = buildLayout(
    root,
    entry,
    'A grid of cells. Walls are removed one at a time until every cell is joined into a maze.',
  );

  const url = urlState({ alg: 'backtracker', cols: 24, seed: 3, solve: true, speed: 60 });
  const settings = url.state;
  settings.cols = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.round(settings.cols)));
  const algorithm = () => MAZE_ALGORITHMS.find((a) => a.id === settings.alg) ?? MAZE_ALGORITHMS[0];

  let maze: Maze = generateMaze('backtracker', 1, 1, seeded(0));
  let state: MazeState = mazeState(1, 1);
  let cursor = 0;
  let solution: number[] = [];

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
      if (position < cursor) {
        state = mazeState(maze.cols, maze.rows);
        cursor = 0;
      }
      for (; cursor < position; cursor++) applyMazeStep(state, maze.steps[cursor]);
      update();
    },
  });

  function build() {
    const cols = settings.cols;
    const rows = Math.max(4, Math.round((cols * 3) / 4));
    maze = generateMaze(algorithm().id, cols, rows, seeded(settings.seed));
    solution = solveMaze(maze.open, cols, 0, cols * rows - 1);
    state = mazeState(cols, rows);
    cursor = 0;
    caption.textContent = algorithm().summary;
    player.setLength(maze.steps.length);
    url.save();
  }

  // --- Rendering ---

  function draw() {
    const { ctx, width, height } = stage;
    const { palette } = theme;
    const { cols, rows } = maze;
    ctx.clearRect(0, 0, width, height);
    const pad = 6;
    const cell = Math.min((width - 2 * pad) / cols, (height - 2 * pad) / rows);
    const ox = (width - cell * cols) / 2;
    const oy = (height - cell * rows) / 2;
    const px = (x: number) => Math.round(ox + x * cell);
    const py = (y: number) => Math.round(oy + y * cell);
    const fill = (i: number, colour: string) => {
      const x = i % cols;
      const y = (i - x) / cols;
      ctx.fillStyle = colour;
      ctx.fillRect(px(x), py(y), px(x + 1) - px(x), py(y + 1) - py(y));
    };
    const centre = (i: number): [number, number] => [
      ox + ((i % cols) + 0.5) * cell,
      oy + (Math.floor(i / cols) + 0.5) * cell,
    ];
    const done = cursor >= maze.steps.length;
    const id = algorithm().id;

    const onWalk = new Uint8Array(cols * rows);
    for (const c of state.walk) onWalk[c] = 1;
    const frontier = mix(palette.compare, palette.bg, 0.45);
    const waiting = mix(palette.visit, palette.bg, 0.25);
    for (let i = 0; i < cols * rows; i++) {
      if (state.kind[i] === 0 && !onWalk[i]) fill(i, palette.faint);
      else if (state.kind[i] === 2) fill(i, frontier);
      else if (onWalk[i]) fill(i, id === 'wilson' ? frontier : waiting);
      else if (id === 'kruskal' && !done) {
        // One tint per set, so the merging is visible.
        const set = state.sets.find(i);
        fill(i, mix(palette.series[set % palette.series.length], palette.bg, 0.62));
      }
    }
    if (state.cursor >= 0 && !done) fill(state.cursor, palette.change);

    if (id === 'wilson' && state.walk.length > 1) {
      ctx.strokeStyle = palette.compare;
      ctx.lineWidth = Math.max(1.5, cell * 0.22);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      state.walk.forEach((c, k) => {
        const [x, y] = centre(c);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    if (done && settings.solve && solution.length > 1) {
      ctx.strokeStyle = palette.good;
      ctx.lineWidth = Math.max(1.5, cell * 0.28);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      solution.forEach((c, k) => {
        const [x, y] = centre(c);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Walls: the north and west side of each cell, then the outer border.
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = cell >= 14 ? 2 : 1;
    ctx.lineCap = 'square';
    ctx.beginPath();
    for (let i = 0; i < cols * rows; i++) {
      const x = i % cols;
      const y = (i - x) / cols;
      if (y > 0 && !(state.open[i] & N)) {
        ctx.moveTo(px(x), py(y));
        ctx.lineTo(px(x + 1), py(y));
      }
      if (x > 0 && !(state.open[i] & W)) {
        ctx.moveTo(px(x), py(y));
        ctx.lineTo(px(x), py(y + 1));
      }
    }
    ctx.rect(px(0), py(0), px(cols) - px(0), py(rows) - py(0));
    ctx.stroke();

    if (state.rejected) {
      const [a, b] = state.rejected;
      const x = b % cols;
      const y = Math.floor(b / cols);
      ctx.strokeStyle = palette.change;
      ctx.lineWidth = Math.max(3, cell * 0.2);
      ctx.beginPath();
      ctx.moveTo(px(x), py(y));
      if (b - a === 1) ctx.lineTo(px(x), py(y + 1));
      else ctx.lineTo(px(x + 1), py(y));
      ctx.stroke();
    }
  }

  function describe(step: MazeStep | undefined): string {
    if (!step)
      return 'Nothing has run yet: every cell is walled in. Press Play to watch a maze being carved, one wall at a time.';
    const id = algorithm().id;
    if (step.t === 'seed') {
      return id === 'wilson'
        ? 'Pick one cell at random to be the whole maze so far.'
        : 'Start from a random cell.';
    }
    if (step.t === 'carve') {
      if (id === 'backtracker')
        return 'Knock through to a random unvisited neighbour and move there.';
      if (id === 'prim')
        return 'Pick a random frontier cell and join it to a neighbour already in the maze.';
      return 'This wall separates two different sets: remove it and merge them.';
    }
    if (step.t === 'back') return 'Dead end: every neighbour is visited. Back up one cell.';
    if (step.t === 'reject') return 'Both sides are already connected: the wall stays.';
    if (step.t === 'commit') return 'The walk reached the maze: carve the whole walk into it.';
    if (step.keep === 0) return 'Start a random walk from a cell outside the maze.';
    return step.erased > 0
      ? `The walk crossed itself: erase a loop of ${step.erased} cell${step.erased === 1 ? '' : 's'} and carry on.`
      : 'Random step.';
  }

  function update() {
    draw();
    const total = maze.cols * maze.rows;
    const done = cursor >= maze.steps.length;
    const ends = deadEnds(state.open);
    counters.set({
      carved: `${state.carved} of ${total}`,
      ends: done ? `${ends} (${Math.round((100 * ends) / total)}%)` : ends,
      route: done ? solution.length : '–',
    });
    status.textContent = done
      ? `Finished. ${Math.round((100 * ends) / total)}% of the cells are dead ends, and the route from corner to corner passes through ${solution.length} cells.`
      : describe(maze.steps[cursor - 1]);
  }

  // --- Controls ---

  const counters = stats({
    carved: 'Cells in the maze',
    ends: 'Dead ends',
    route: 'Corner-to-corner route',
  });
  const status = el('p', { class: 'note', style: 'flex: 1 1 100%; min-height: 2.8em' });
  const caption = el('p', { class: 'note' });

  panel.append(
    fieldset(
      'Maze',
      select<MazeAlgorithm>({
        label: 'Algorithm',
        options: MAZE_ALGORITHMS,
        value: algorithm().id,
        onChange(id) {
          settings.alg = id;
          build();
        },
      }).root,
      caption,
      slider({
        label: 'Columns',
        min: MIN_COLS,
        max: MAX_COLS,
        value: settings.cols,
        onInput(value) {
          settings.cols = value;
          build();
        },
      }).root,
      checkbox({
        label: 'Show the route when finished',
        checked: settings.solve,
        onChange(checked) {
          settings.solve = checked;
          url.save();
          draw();
        },
      }),
      el(
        'div',
        { class: 'buttons' },
        button('New maze', () => {
          settings.seed = newSeed();
          build();
        }),
        button('Skip to end', () => player.seek(maze.steps.length)),
      ),
    ),
    player.root,
  );

  readout.append(
    counters.root,
    status,
    legend([
      ['var(--canvas-change)', 'Current cell or wall'],
      ['var(--canvas-faint)', 'Not yet reached'],
      [
        'color-mix(in srgb, var(--canvas-visit) 75%, var(--canvas-bg))',
        'On the stack (backtracker)',
      ],
      [
        'color-mix(in srgb, var(--canvas-compare) 55%, var(--canvas-bg))',
        'Frontier (Prim), walk (Wilson)',
      ],
      [
        'color-mix(in srgb, var(--canvas-series-3) 38%, var(--canvas-bg))',
        'One tint per connected set (Kruskal)',
      ],
      ['var(--canvas-good)', 'Route'],
    ]),
  );

  about.append(
    prose(
      'A perfect maze has exactly one route between any two cells. Think of the cells as nodes and the walls between neighbours as possible edges: such a maze is a spanning tree of the grid. Each generator here is a spanning tree algorithm with the choices made at random.',
    ),
    prose(
      'They build the same kind of object but with different texture. The backtracker is a depth-first search: it runs on until it is boxed in, which gives long winding corridors and few dead ends (about 10% of cells). Prim and Kruskal attach cells in small random pieces, which gives short branches: about 35% of cells are dead ends with Prim and about 30% with Kruskal, and the corner-to-corner route is much shorter. Compare the dead-end counter and the length of the corner-to-corner route across algorithms.',
    ),
    prose(
      "Wilson's algorithm is the only one here that is unbiased: every spanning tree of the grid is equally likely (about 29% dead ends). It starts a random walk from a cell outside the maze. Whenever the walk steps on itself the loop is erased, and when it touches the maze the remaining path is carved in. The first walk can take a long time to find the single starting cell; later walks finish quickly.",
    ),
    prose(
      'The backtracker and Prim take `O(n)` steps for `n` cells. Kruskal looks at each wall once, with a union-find structure answering "are these two cells already connected?" in near-constant time. Wilson has no fixed bound, but its expected running time on a grid is modest.',
    ),
  );

  build();

  return () => {
    player.dispose();
    stage.dispose();
    theme.dispose();
  };
};
