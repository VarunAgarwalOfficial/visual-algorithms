import { shuffle, type Random } from '../random';
import { UnionFind } from './unionfind';

/** Passage bits for one cell. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

export type MazeAlgorithm = 'backtracker' | 'prim' | 'kruskal' | 'wilson';

export const MAZE_ALGORITHMS: readonly { id: MazeAlgorithm; name: string; summary: string }[] = [
  {
    id: 'backtracker',
    name: 'Recursive backtracker (DFS)',
    summary:
      'Walks to a random unvisited neighbour until stuck, then backs up. Long winding corridors, few dead ends.',
  },
  {
    id: 'prim',
    name: "Randomised Prim's",
    summary:
      'Grows one region by attaching a random frontier cell. Short branches and many dead ends, spreading from the start.',
  },
  {
    id: 'kruskal',
    name: "Randomised Kruskal's",
    summary:
      'Takes the walls in random order and removes one whenever it separates two different sets. Many short dead ends everywhere.',
  },
  {
    id: 'wilson',
    name: "Wilson's (loop-erased walk)",
    summary:
      'Random walks from an unvisited cell until it hits the maze, erasing any loops. Every spanning tree is equally likely.',
  },
];

export type MazeStep =
  /** `cell` becomes the first cell of the maze. */
  | { t: 'seed'; cell: number; push?: boolean; frontier?: number[] }
  /** Open the wall between two neighbours. `frontier` lists cells that become candidates (Prim). */
  | { t: 'carve'; from: number; to: number; push?: boolean; frontier?: number[] }
  /** Depth-first search is stuck: pop the stack; `cell` is the new top (or -1). */
  | { t: 'back'; cell: number }
  /** Kruskal: the wall between a and b stays, both are already connected. */
  | { t: 'reject'; a: number; b: number }
  /** Wilson: cut the walk back to `keep` cells (erasing a loop), then step to `cell`. */
  | { t: 'walk'; cell: number; keep: number; erased: number }
  /** Wilson: the walk reached the maze; carve it. */
  | { t: 'commit' };

export interface Maze {
  cols: number;
  rows: number;
  /** Passage bits (N, E, S, W) for each cell. */
  open: Uint8Array;
  steps: MazeStep[];
}

/** The state part-way through a generation, rebuilt by applying steps. */
export interface MazeState {
  cols: number;
  rows: number;
  open: Uint8Array;
  /** 0 untouched, 1 part of the maze, 2 frontier. */
  kind: Uint8Array;
  /** DFS stack or Wilson's current walk. */
  walk: number[];
  /** The cell being worked on, or -1. */
  cursor: number;
  /** A wall just rejected by Kruskal, as [a, b], or undefined. */
  rejected: [number, number] | undefined;
  carved: number;
  sets: UnionFind;
}

export function mazeState(cols: number, rows: number): MazeState {
  return {
    cols,
    rows,
    open: new Uint8Array(cols * rows),
    kind: new Uint8Array(cols * rows),
    walk: [],
    cursor: -1,
    rejected: undefined,
    carved: 0,
    sets: new UnionFind(cols * rows),
  };
}

function link(open: Uint8Array, cols: number, a: number, b: number): void {
  const d = b - a;
  if (d === 1) {
    open[a] |= E;
    open[b] |= W;
  } else if (d === -1) {
    open[a] |= W;
    open[b] |= E;
  } else if (d === cols) {
    open[a] |= S;
    open[b] |= N;
  } else {
    open[a] |= N;
    open[b] |= S;
  }
}

function join(state: MazeState, cell: number): void {
  if (state.kind[cell] !== 1) {
    state.kind[cell] = 1;
    state.carved++;
  }
}

export function applyMazeStep(state: MazeState, step: MazeStep): void {
  state.rejected = undefined;
  if (step.t === 'seed') {
    join(state, step.cell);
    state.cursor = step.cell;
    if (step.push) state.walk.push(step.cell);
    if (step.frontier) for (const cell of step.frontier) state.kind[cell] = 2;
  } else if (step.t === 'carve') {
    link(state.open, state.cols, step.from, step.to);
    join(state, step.from);
    join(state, step.to);
    state.sets.union(step.from, step.to);
    state.cursor = step.to;
    if (step.push) state.walk.push(step.to);
    if (step.frontier) for (const cell of step.frontier) state.kind[cell] = 2;
  } else if (step.t === 'back') {
    state.walk.pop();
    state.cursor = step.cell;
  } else if (step.t === 'reject') {
    state.rejected = [step.a, step.b];
    state.cursor = -1;
  } else if (step.t === 'walk') {
    state.walk.length = Math.min(state.walk.length, step.keep);
    state.walk.push(step.cell);
    state.cursor = step.cell;
  } else {
    for (let i = 0; i + 1 < state.walk.length; i++) {
      link(state.open, state.cols, state.walk[i], state.walk[i + 1]);
      state.sets.union(state.walk[i], state.walk[i + 1]);
    }
    for (const cell of state.walk) join(state, cell);
    state.walk = [];
    state.cursor = -1;
  }
}

/** The grid neighbours of a cell, in N, E, S, W order. */
export function cellNeighbours(cols: number, rows: number, cell: number): number[] {
  const x = cell % cols;
  const y = (cell - x) / cols;
  const out: number[] = [];
  if (y > 0) out.push(cell - cols);
  if (x < cols - 1) out.push(cell + 1);
  if (y < rows - 1) out.push(cell + cols);
  if (x > 0) out.push(cell - 1);
  return out;
}

function backtracker(cols: number, rows: number, random: Random, steps: MazeStep[]): void {
  const seen = new Uint8Array(cols * rows);
  const start = Math.floor(random() * cols * rows);
  const stack = [start];
  seen[start] = 1;
  steps.push({ t: 'seed', cell: start, push: true });
  while (stack.length > 0) {
    const cell = stack[stack.length - 1];
    const options = cellNeighbours(cols, rows, cell).filter((n) => !seen[n]);
    if (options.length === 0) {
      stack.pop();
      steps.push({ t: 'back', cell: stack.length > 0 ? stack[stack.length - 1] : -1 });
      continue;
    }
    const next = options[Math.floor(random() * options.length)];
    seen[next] = 1;
    stack.push(next);
    steps.push({ t: 'carve', from: cell, to: next, push: true });
  }
}

function prim(cols: number, rows: number, random: Random, steps: MazeStep[]): void {
  // 0 untouched, 1 in the maze, 2 frontier.
  const kind = new Uint8Array(cols * rows);
  const frontier: number[] = [];
  const add = (cell: number): number[] => {
    kind[cell] = 1;
    const fresh = cellNeighbours(cols, rows, cell).filter((n) => kind[n] === 0);
    for (const n of fresh) {
      kind[n] = 2;
      frontier.push(n);
    }
    return fresh;
  };
  const start = Math.floor(random() * cols * rows);
  steps.push({ t: 'seed', cell: start, frontier: add(start) });
  while (frontier.length > 0) {
    const pick = Math.floor(random() * frontier.length);
    const cell = frontier[pick];
    frontier[pick] = frontier[frontier.length - 1];
    frontier.pop();
    const inside = cellNeighbours(cols, rows, cell).filter((n) => kind[n] === 1);
    const from = inside[Math.floor(random() * inside.length)];
    steps.push({ t: 'carve', from, to: cell, frontier: add(cell) });
  }
}

function kruskal(cols: number, rows: number, random: Random, steps: MazeStep[]): void {
  const walls: [number, number][] = [];
  for (let cell = 0; cell < cols * rows; cell++) {
    if (cell % cols < cols - 1) walls.push([cell, cell + 1]);
    if (cell + cols < cols * rows) walls.push([cell, cell + cols]);
  }
  shuffle(walls, random);
  const sets = new UnionFind(cols * rows);
  let joined = 1;
  for (const [a, b] of walls) {
    if (joined === cols * rows) break;
    if (sets.union(a, b) < 0) {
      steps.push({ t: 'reject', a, b });
    } else {
      joined++;
      steps.push({ t: 'carve', from: a, to: b });
    }
  }
}

function wilson(cols: number, rows: number, random: Random, steps: MazeStep[]): void {
  const n = cols * rows;
  const inMaze = new Uint8Array(n);
  const order = shuffle(
    Array.from({ length: n }, (_, i) => i),
    random,
  );
  inMaze[order[0]] = 1;
  steps.push({ t: 'seed', cell: order[0] });
  // Position of each cell in the current walk, or -1.
  const at = new Int32Array(n).fill(-1);
  for (const start of order) {
    if (inMaze[start]) continue;
    const walk = [start];
    at[start] = 0;
    steps.push({ t: 'walk', cell: start, keep: 0, erased: 0 });
    let cell = start;
    while (!inMaze[cell]) {
      const options = cellNeighbours(cols, rows, cell);
      cell = options[Math.floor(random() * options.length)];
      let keep = walk.length;
      const before = walk.length;
      if (at[cell] >= 0) {
        // The walk crossed itself: erase the loop.
        keep = at[cell];
        for (let i = keep; i < walk.length; i++) at[walk[i]] = -1;
        walk.length = keep;
      }
      at[cell] = walk.length;
      walk.push(cell);
      steps.push({ t: 'walk', cell, keep, erased: before - keep });
    }
    for (const c of walk) {
      inMaze[c] = 1;
      at[c] = -1;
    }
    steps.push({ t: 'commit' });
  }
}

/** Runs a generator once and records every step. The final maze is a spanning tree of the grid. */
export function generateMaze(
  algorithm: MazeAlgorithm,
  cols: number,
  rows: number,
  random: Random,
): Maze {
  const steps: MazeStep[] = [];
  if (algorithm === 'prim') prim(cols, rows, random, steps);
  else if (algorithm === 'kruskal') kruskal(cols, rows, random, steps);
  else if (algorithm === 'wilson') wilson(cols, rows, random, steps);
  else backtracker(cols, rows, random, steps);
  const state = mazeState(cols, rows);
  for (const step of steps) applyMazeStep(state, step);
  return { cols, rows, open: state.open, steps };
}

/** Cells reachable through open passages from `cell`. */
export function passages(open: Uint8Array, cols: number, cell: number): number[] {
  const out: number[] = [];
  const bits = open[cell];
  if (bits & N) out.push(cell - cols);
  if (bits & E) out.push(cell + 1);
  if (bits & S) out.push(cell + cols);
  if (bits & W) out.push(cell - 1);
  return out;
}

/** Shortest path through the passages (breadth-first), as a list of cells; empty if there is none. */
export function solveMaze(open: Uint8Array, cols: number, from: number, to: number): number[] {
  const parent = new Int32Array(open.length).fill(-1);
  parent[from] = from;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    if (cell === to) break;
    for (const next of passages(open, cols, cell)) {
      if (parent[next] >= 0) continue;
      parent[next] = cell;
      queue.push(next);
    }
  }
  if (parent[to] < 0) return [];
  const path = [to];
  while (path[path.length - 1] !== from) path.push(parent[path[path.length - 1]]);
  return path.reverse();
}

/** Number of cells with exactly one passage. */
export function deadEnds(open: Uint8Array): number {
  let count = 0;
  for (const bits of open) if (bits === N || bits === E || bits === S || bits === W) count++;
  return count;
}
