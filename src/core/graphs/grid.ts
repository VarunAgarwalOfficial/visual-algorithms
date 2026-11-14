import type { Random } from '../random';
import { MinHeap } from './heap';
import { E, S, generateMaze } from './maze';

export const FREE = 0;
export const WALL = 1;
export const MUD = 2;
/** Entering a mud cell costs this many times a normal step. */
export const MUD_COST = 5;

export interface Grid {
  cols: number;
  rows: number;
  /** FREE, WALL or MUD for each cell, row by row. */
  cells: Uint8Array;
}

export type GridAlgorithm =
  'bfs' | 'dfs' | 'dijkstra' | 'astar' | 'greedy' | 'bidirectional' | 'jps';
export type Heuristic = 'manhattan' | 'octile';

export interface GridAlgorithmInfo {
  id: GridAlgorithm;
  name: string;
  summary: string;
  /** Counts steps only: mud is treated as plain floor. */
  unweighted: boolean;
  usesHeuristic: boolean;
}

export const GRID_ALGORITHMS: readonly GridAlgorithmInfo[] = [
  {
    id: 'astar',
    name: 'A*',
    summary:
      'Expands the cell with the lowest cost so far plus estimated cost to go. Shortest path if the estimate never overshoots.',
    unweighted: false,
    usesHeuristic: true,
  },
  {
    id: 'dijkstra',
    name: 'Dijkstra',
    summary: 'Expands the cheapest cell reached so far. Always finds the cheapest path.',
    unweighted: false,
    usesHeuristic: false,
  },
  {
    id: 'bfs',
    name: 'Breadth-first search',
    summary: 'Expands cells in order of step count. Fewest steps, but it ignores mud cost.',
    unweighted: true,
    usesHeuristic: false,
  },
  {
    id: 'dfs',
    name: 'Depth-first search',
    summary: 'Follows one branch as far as it goes. Finds a path, usually a poor one.',
    unweighted: true,
    usesHeuristic: false,
  },
  {
    id: 'greedy',
    name: 'Greedy best-first',
    summary: 'Expands the cell that looks closest to the goal. Fast, but the path can be poor.',
    unweighted: false,
    usesHeuristic: true,
  },
  {
    id: 'bidirectional',
    name: 'Bidirectional BFS',
    summary:
      'Two breadth-first searches, one from each end, that stop when they meet. Fewest steps; ignores mud cost.',
    unweighted: true,
    usesHeuristic: false,
  },
  {
    id: 'jps',
    name: 'Jump point search',
    summary:
      'A* that slides along straight lines and only stops at cells where a turn could matter. Needs diagonal moves and uniform cost: mud counts as floor.',
    unweighted: true,
    usesHeuristic: false,
  },
];

export interface SearchOptions {
  diagonal: boolean;
  heuristic: Heuristic;
}

/** One expansion: `node` leaves the frontier and `opened` cells join it. */
export interface SearchStep {
  node: number;
  opened: number[];
  /** Jump point search: cells looked at while sliding from `node`. */
  scanned?: number[];
  /** Bidirectional: 1 when the step belongs to the search from the goal. */
  side?: 1;
}

export interface SearchResult {
  steps: SearchStep[];
  /** Cells from start to goal, each a legal move from the one before. Empty if unreachable. */
  path: number[];
  /** True cost of `path`, mud and diagonals included. */
  cost: number;
}

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

export function passable(grid: Grid, x: number, y: number): boolean {
  return (
    x >= 0 && y >= 0 && x < grid.cols && y < grid.rows && grid.cells[y * grid.cols + x] !== WALL
  );
}

/**
 * The one movement rule every search shares: the target must be open, and a
 * diagonal move needs both cells it squeezes past to be open (no corner cutting).
 */
export function canStep(grid: Grid, x: number, y: number, dx: number, dy: number): boolean {
  if (!passable(grid, x + dx, y + dy)) return false;
  return dx === 0 || dy === 0 || (passable(grid, x + dx, y) && passable(grid, x, y + dy));
}

export function neighbours(grid: Grid, cell: number, diagonal: boolean): number[] {
  const x = cell % grid.cols;
  const y = (cell - x) / grid.cols;
  const out: number[] = [];
  const count = diagonal ? 8 : 4;
  for (let d = 0; d < count; d++) {
    const [dx, dy] = DIRS[d];
    if (canStep(grid, x, y, dx, dy)) out.push(cell + dy * grid.cols + dx);
  }
  return out;
}

/** Cost of the legal move between two adjacent cells; `weighted` false counts mud as floor. */
export function moveCost(grid: Grid, from: number, to: number, weighted = true): number {
  const straight = Math.abs(from - to) === 1 || Math.abs(from - to) === grid.cols;
  const base = weighted && grid.cells[to] === MUD ? MUD_COST : 1;
  return straight ? base : base * Math.SQRT2;
}

export function pathCost(grid: Grid, path: readonly number[], weighted = true): number {
  let cost = 0;
  for (let i = 1; i < path.length; i++) cost += moveCost(grid, path[i - 1], path[i], weighted);
  return cost;
}

/** True if every move in the path is one the movement rule allows. */
export function isLegalPath(grid: Grid, path: readonly number[], diagonal: boolean): boolean {
  for (let i = 1; i < path.length; i++) {
    if (!neighbours(grid, path[i - 1], diagonal).includes(path[i])) return false;
  }
  return path.length > 0;
}

function estimate(grid: Grid, a: number, b: number, heuristic: Heuristic): number {
  const dx = Math.abs((a % grid.cols) - (b % grid.cols));
  const dy = Math.abs(Math.floor(a / grid.cols) - Math.floor(b / grid.cols));
  if (heuristic === 'manhattan') return dx + dy;
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function trace(parent: Int32Array, start: number, goal: number): number[] {
  if (parent[goal] < 0) return [];
  const path = [goal];
  while (path[path.length - 1] !== start) path.push(parent[path[path.length - 1]]);
  return path.reverse();
}

function finish(grid: Grid, steps: SearchStep[], path: number[]): SearchResult {
  return { steps, path, cost: pathCost(grid, path) };
}

function breadthFirst(grid: Grid, start: number, goal: number, diagonal: boolean): SearchResult {
  const parent = new Int32Array(grid.cells.length).fill(-1);
  const steps: SearchStep[] = [];
  parent[start] = start;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    const opened: number[] = [];
    if (node !== goal) {
      for (const next of neighbours(grid, node, diagonal)) {
        if (parent[next] >= 0) continue;
        parent[next] = node;
        queue.push(next);
        opened.push(next);
      }
    }
    steps.push({ node, opened });
    if (node === goal) break;
  }
  return finish(grid, steps, trace(parent, start, goal));
}

function depthFirst(grid: Grid, start: number, goal: number, diagonal: boolean): SearchResult {
  const n = grid.cells.length;
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const steps: SearchStep[] = [];
  parent[start] = start;
  seen[start] = 1;
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop() as number;
    if (closed[node]) continue;
    closed[node] = 1;
    const opened: number[] = [];
    if (node !== goal) {
      // Pushed in reverse so the first direction is explored first.
      const around = neighbours(grid, node, diagonal).reverse();
      for (const next of around) {
        if (closed[next]) continue;
        parent[next] = node;
        stack.push(next);
        if (!seen[next]) {
          seen[next] = 1;
          opened.push(next);
        }
      }
    }
    steps.push({ node, opened });
    if (node === goal) break;
  }
  return finish(grid, steps, closed[goal] ? trace(parent, start, goal) : []);
}

interface Entry {
  key: number;
  tie: number;
  node: number;
}
const byKey = (a: Entry, b: Entry) => a.key < b.key || (a.key === b.key && a.tie < b.tie);

function bestFirst(
  grid: Grid,
  start: number,
  goal: number,
  options: SearchOptions,
  mode: 'dijkstra' | 'astar' | 'greedy',
): SearchResult {
  const n = grid.cells.length;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const steps: SearchStep[] = [];
  const heap = new MinHeap<Entry>(byKey);
  const entry = (node: number): Entry => {
    const h = mode === 'dijkstra' ? 0 : estimate(grid, node, goal, options.heuristic);
    // Among equal keys prefer the cell nearer the goal, so ties do not fan out.
    return { key: mode === 'greedy' ? h : g[node] + h, tie: h, node };
  };
  g[start] = 0;
  parent[start] = start;
  heap.push(entry(start));
  while (heap.size > 0) {
    const { node } = heap.pop() as Entry;
    if (closed[node]) continue;
    closed[node] = 1;
    const opened: number[] = [];
    if (node !== goal) {
      for (const next of neighbours(grid, node, options.diagonal)) {
        if (closed[next]) continue;
        const cost = g[node] + moveCost(grid, node, next);
        if (cost >= g[next]) continue;
        // Greedy search keeps the first parent it finds.
        if (mode === 'greedy' && parent[next] >= 0) continue;
        if (parent[next] < 0) opened.push(next);
        g[next] = cost;
        parent[next] = node;
        heap.push(entry(next));
      }
    }
    steps.push({ node, opened });
    if (node === goal) break;
  }
  return finish(grid, steps, closed[goal] ? trace(parent, start, goal) : []);
}

function bidirectional(grid: Grid, start: number, goal: number, diagonal: boolean): SearchResult {
  const n = grid.cells.length;
  const dist = [new Int32Array(n).fill(-1), new Int32Array(n).fill(-1)];
  const parent = [new Int32Array(n).fill(-1), new Int32Array(n).fill(-1)];
  const steps: SearchStep[] = [];
  const ends = [start, goal];
  let frontier = [[start], [goal]];
  for (const side of [0, 1]) {
    dist[side][ends[side]] = 0;
    parent[side][ends[side]] = ends[side];
  }
  let best = Infinity;
  let meet = -1;
  while (meet < 0 && frontier[0].length > 0 && frontier[1].length > 0) {
    // Grow the smaller side by one whole level. The level is finished even after the
    // searches touch, because a later cell in it may give a shorter join.
    const side = frontier[0].length <= frontier[1].length ? 0 : 1;
    const next: number[] = [];
    for (const node of frontier[side]) {
      const opened: number[] = [];
      for (const cell of neighbours(grid, node, diagonal)) {
        if (dist[side][cell] >= 0) continue;
        dist[side][cell] = dist[side][node] + 1;
        parent[side][cell] = node;
        next.push(cell);
        opened.push(cell);
        const other = dist[1 - side][cell];
        if (other >= 0 && dist[side][cell] + other < best) {
          best = dist[side][cell] + other;
          meet = cell;
        }
      }
      steps.push(side === 1 ? { node, opened, side: 1 } : { node, opened });
    }
    frontier = side === 0 ? [next, frontier[1]] : [frontier[0], next];
  }
  if (meet < 0) return finish(grid, steps, []);
  const path = trace(parent[0], start, meet);
  const back = trace(parent[1], goal, meet).reverse();
  return finish(grid, steps, [...path, ...back.slice(1)]);
}

/**
 * Jump point search (Harabor and Grastien), in the variant where diagonal moves
 * may not cut corners. From each expanded cell it slides in the directions that
 * could still matter and stops only at the goal or at a cell with a forced
 * neighbour: one that is reached more cheaply through this cell than around it.
 */
function jumpPoint(grid: Grid, start: number, goal: number): SearchResult {
  const { cols } = grid;
  const n = grid.cells.length;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  // Direction of travel when the cell was reached, as an index into DIRS, or -1 for the start.
  const arrived = new Int8Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const steps: SearchStep[] = [];
  const heap = new MinHeap<Entry>(byKey);
  const open = (x: number, y: number) => passable(grid, x, y);

  /** A straight mover at (x, y) has a forced neighbour on side `s` (perpendicular offset). */
  const forced = (x: number, y: number, dx: number, dy: number, s: number): boolean =>
    dx !== 0 ? !open(x - dx, y + s) && open(x, y + s) : !open(x + s, y - dy) && open(x + s, y);

  /** Slides from (x, y) in direction (dx, dy). Returns the jump point found, or -1. */
  const jump = (x: number, y: number, dx: number, dy: number, scanned: number[]): number => {
    for (;;) {
      if (!canStep(grid, x, y, dx, dy)) return -1;
      x += dx;
      y += dy;
      const cell = y * cols + x;
      scanned.push(cell);
      if (cell === goal) return cell;
      if (dx !== 0 && dy !== 0) {
        // A diagonal mover stops where a straight slide would find something.
        if (jump(x, y, dx, 0, scanned) >= 0 || jump(x, y, 0, dy, scanned) >= 0) return cell;
      } else if (forced(x, y, dx, dy, 1) || forced(x, y, dx, dy, -1)) {
        return cell;
      }
    }
  };

  /** The directions worth trying from a cell that was reached moving in direction `d`. */
  const directions = (x: number, y: number, d: number): (readonly [number, number])[] => {
    if (d < 0) return [...DIRS];
    const [dx, dy] = DIRS[d];
    if (dx !== 0 && dy !== 0) {
      return [
        [dx, 0],
        [0, dy],
        [dx, dy],
      ];
    }
    const out: (readonly [number, number])[] = [[dx, dy]];
    for (const s of [1, -1]) {
      if (!forced(x, y, dx, dy, s)) continue;
      if (dx !== 0) out.push([0, s], [dx, s]);
      else out.push([s, 0], [s, dy]);
    }
    return out;
  };

  const entry = (node: number): Entry => {
    const h = estimate(grid, node, goal, 'octile');
    return { key: g[node] + h, tie: h, node };
  };
  g[start] = 0;
  parent[start] = start;
  heap.push(entry(start));
  while (heap.size > 0) {
    const { node } = heap.pop() as Entry;
    if (closed[node]) continue;
    closed[node] = 1;
    const opened: number[] = [];
    const scanned: number[] = [];
    if (node !== goal) {
      const x = node % cols;
      const y = (node - x) / cols;
      for (const [dx, dy] of directions(x, y, arrived[node])) {
        const found = jump(x, y, dx, dy, scanned);
        if (found < 0 || closed[found]) continue;
        const length = Math.max(
          Math.abs((found % cols) - x),
          Math.abs(Math.floor(found / cols) - y),
        );
        const cost = g[node] + length * (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
        if (cost >= g[found]) continue;
        if (parent[found] < 0) opened.push(found);
        g[found] = cost;
        parent[found] = node;
        arrived[found] = DIRS.findIndex((dir) => dir[0] === dx && dir[1] === dy);
        heap.push(entry(found));
      }
    }
    steps.push({ node, opened, scanned });
    if (node === goal) break;
  }
  if (!closed[goal]) return finish(grid, steps, []);
  // Fill in the cells between consecutive jump points.
  const points = trace(parent, start, goal);
  const path = [start];
  for (let i = 1; i < points.length; i++) {
    let at = points[i - 1];
    const to = points[i];
    const sx = Math.sign((to % cols) - (at % cols));
    const sy = Math.sign(Math.floor(to / cols) - Math.floor(at / cols));
    while (at !== to) {
      at += sy * cols + sx;
      path.push(at);
    }
  }
  return finish(grid, steps, path);
}

/**
 * Runs a search once and records every expansion. Jump point search always
 * moves in eight directions, whatever `options.diagonal` says.
 */
export function searchGrid(
  algorithm: GridAlgorithm,
  grid: Grid,
  start: number,
  goal: number,
  options: SearchOptions,
): SearchResult {
  if (grid.cells[start] === WALL || grid.cells[goal] === WALL) return finish(grid, [], []);
  if (start === goal) return finish(grid, [], [start]);
  if (algorithm === 'bfs') return breadthFirst(grid, start, goal, options.diagonal);
  if (algorithm === 'dfs') return depthFirst(grid, start, goal, options.diagonal);
  if (algorithm === 'bidirectional') return bidirectional(grid, start, goal, options.diagonal);
  if (algorithm === 'jps') return jumpPoint(grid, start, goal);
  return bestFirst(grid, start, goal, options, algorithm);
}

// --- Presets ---

export function emptyGrid(cols: number, rows: number): Grid {
  return { cols, rows, cells: new Uint8Array(cols * rows) };
}

export function randomGrid(cols: number, rows: number, random: Random): Grid {
  const grid = emptyGrid(cols, rows);
  for (let i = 0; i < grid.cells.length; i++) {
    const r = random();
    grid.cells[i] = r < 0.23 ? WALL : r < 0.31 ? MUD : FREE;
  }
  return grid;
}

/**
 * A maze drawn with wall cells: rooms sit at odd coordinates. A few extra walls
 * are knocked out so there is more than one route. Works best with odd sizes.
 */
export function mazeGrid(cols: number, rows: number, random: Random): Grid {
  const grid = emptyGrid(cols, rows);
  grid.cells.fill(WALL);
  const mc = Math.max(1, (cols - 1) >> 1);
  const mr = Math.max(1, (rows - 1) >> 1);
  const maze = generateMaze('backtracker', mc, mr, random);
  for (let cell = 0; cell < mc * mr; cell++) {
    const x = 2 * (cell % mc) + 1;
    const y = 2 * Math.floor(cell / mc) + 1;
    if (x >= cols || y >= rows) continue;
    grid.cells[y * cols + x] = FREE;
    const right = x + 1 < cols - 1 && (cell % mc) + 1 < mc;
    const down = y + 1 < rows - 1 && cell + mc < mc * mr;
    if (right && (maze.open[cell] & E || random() < 0.07)) grid.cells[y * cols + x + 1] = FREE;
    if (down && (maze.open[cell] & S || random() < 0.07)) grid.cells[(y + 1) * cols + x] = FREE;
  }
  return grid;
}
