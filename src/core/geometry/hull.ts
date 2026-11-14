import type { Point } from '../point';
import { dist2, orient } from './plane';

/** One frame of a hull algorithm: everything needed to draw it. */
export interface HullStep {
  note: string;
  /** Orientation tests (cross products) evaluated so far. */
  tests: number;
  /** The chain or polygon being built, as point indices. */
  chain: number[];
  closed: boolean;
  /** A finished part kept alongside the chain (the lower hull in monotone chain). */
  done?: number[];
  /** The turn being tested: a to b to c, the cross product, and whether it passed. */
  turn?: { a: number; b: number; c: number; cross: number; keep: boolean };
  /** Points ruled out so far. */
  dropped: number[];
  /** Points the current sub-problem is looking at (quickhull). */
  active?: number[];
}

export interface HullResult {
  /** Hull vertices, anticlockwise on screen. Collinear boundary points are left out. */
  hull: number[];
  steps: HullStep[];
}

export const HULL_ALGORITHMS = [
  { id: 'graham', name: 'Graham scan' },
  { id: 'monotone', name: "Andrew's monotone chain" },
  { id: 'quickhull', name: 'Quickhull' },
  { id: 'wrap', name: 'Gift wrapping (Jarvis march)' },
] as const;
export type HullAlgorithm = (typeof HULL_ALGORITHMS)[number]['id'];

const lexLess = (a: Point, b: Point) => a.x < b.x || (a.x === b.x && a.y < b.y);

class Recorder {
  steps: HullStep[] = [];
  tests = 0;
  dropped: number[] = [];
  constructor(readonly points: readonly Point[]) {}
  /** Counts and returns one orientation test. */
  cross(a: number, b: number, c: number): number {
    this.tests++;
    return orient(this.points[a], this.points[b], this.points[c]);
  }
  push(step: Omit<HullStep, 'tests' | 'dropped'>): void {
    this.steps.push({ ...step, tests: this.tests, dropped: [...this.dropped] });
  }
}

const name = (i: number) => `p${i + 1}`;

function trivial(points: readonly Point[]): HullResult | undefined {
  if (points.length >= 3) return undefined;
  const hull = points.map((_, i) => i);
  return {
    hull,
    steps: [
      {
        note: 'Fewer than three points: nothing to scan.',
        tests: 0,
        chain: hull,
        closed: false,
        dropped: [],
      },
    ],
  };
}

function finish(rec: Recorder, hull: number[]): HullResult {
  const on = new Set(hull);
  rec.dropped = rec.points.map((_, i) => i).filter((i) => !on.has(i));
  rec.push({
    note: `Done. The hull has ${hull.length} vertices.`,
    chain: hull,
    closed: true,
  });
  return { hull, steps: rec.steps };
}

/** The scan shared by Graham and monotone chain: pop while the turn is not a left turn. */
function scan(rec: Recorder, order: readonly number[], done?: number[]): number[] {
  const stack: number[] = [];
  for (const c of order) {
    while (stack.length >= 2) {
      const a = stack[stack.length - 2];
      const b = stack[stack.length - 1];
      const cross = rec.cross(a, b, c);
      if (cross > 0) {
        rec.push({
          note: `${name(a)}, ${name(b)}, ${name(c)} turn left (cross > 0): keep ${name(b)}.`,
          chain: [...stack],
          closed: false,
          done,
          turn: { a, b, c, cross, keep: true },
        });
        break;
      }
      stack.pop();
      rec.dropped.push(b);
      rec.push({
        note: `${name(a)}, ${name(b)}, ${name(c)} ${cross === 0 ? 'are collinear (cross = 0)' : 'turn right (cross < 0)'}: pop ${name(b)}.`,
        chain: [...stack],
        closed: false,
        done,
        turn: { a, b, c, cross, keep: false },
      });
    }
    stack.push(c);
    rec.push({ note: `Push ${name(c)}.`, chain: [...stack], closed: false, done });
  }
  return stack;
}

export function grahamScan(points: readonly Point[]): HullResult {
  const small = trivial(points);
  if (small) return small;
  const rec = new Recorder(points);
  let pivot = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const q = points[pivot];
    if (p.y > q.y || (p.y === q.y && p.x < q.x)) pivot = i;
  }
  const rest = points.map((_, i) => i).filter((i) => i !== pivot);
  rest.sort((a, b) => {
    const cross = rec.cross(pivot, a, b);
    if (cross !== 0) return -cross;
    return dist2(points[pivot], points[a]) - dist2(points[pivot], points[b]);
  });
  rec.push({
    note: `Pivot ${name(pivot)} is the lowest point. The others are sorted by angle around it.`,
    chain: [pivot],
    closed: false,
    active: rest,
  });
  const hull = scan(rec, [pivot, ...rest]);
  return finish(rec, hull);
}

export function monotoneChain(points: readonly Point[]): HullResult {
  const small = trivial(points);
  if (small) return small;
  const rec = new Recorder(points);
  const order = points
    .map((_, i) => i)
    .sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y);
  rec.push({
    note: 'Sort the points left to right. First pass: the lower hull.',
    chain: [],
    closed: false,
  });
  const lower = scan(rec, order);
  rec.dropped = [];
  rec.push({
    note: 'Second pass, right to left: the upper hull.',
    chain: [],
    closed: false,
    done: lower,
  });
  const upper = scan(rec, [...order].reverse(), lower);
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return finish(rec, hull.length ? hull : lower);
}

export function quickhull(points: readonly Point[]): HullResult {
  const small = trivial(points);
  if (small) return small;
  const rec = new Recorder(points);
  let left = 0;
  let right = 0;
  points.forEach((p, i) => {
    if (lexLess(p, points[left])) left = i;
    if (lexLess(points[right], p)) right = i;
  });
  const hull = [left, right];
  const above: number[] = [];
  const below: number[] = [];
  points.forEach((_, i) => {
    if (i === left || i === right) return;
    const cross = rec.cross(left, right, i);
    if (cross > 0) above.push(i);
    else if (cross < 0) below.push(i);
    else rec.dropped.push(i);
  });
  rec.push({
    note: `${name(left)} and ${name(right)} are the leftmost and rightmost points. Split the rest by side.`,
    chain: [...hull],
    closed: true,
  });

  // Finds the hull between a and b among `set`, the points strictly left of a to b.
  const expand = (a: number, b: number, set: number[]) => {
    if (set.length === 0) return;
    let far = set[0];
    let best = -1;
    for (const i of set) {
      const cross = rec.cross(a, b, i);
      if (cross > best || (cross === best && lexLess(points[i], points[far]))) {
        best = cross;
        far = i;
      }
    }
    hull.splice(hull.indexOf(a) + 1, 0, far);
    const first: number[] = [];
    const second: number[] = [];
    for (const i of set) {
      if (i === far) continue;
      if (rec.cross(a, far, i) > 0) first.push(i);
      else if (rec.cross(far, b, i) > 0) second.push(i);
      else rec.dropped.push(i);
    }
    rec.push({
      note: `${name(far)} is farthest from edge ${name(a)}–${name(b)}, so it is on the hull. Points inside the triangle are discarded; ${first.length + second.length} remain outside.`,
      chain: [...hull],
      closed: true,
      turn: { a, b, c: far, cross: best, keep: true },
      active: [...first, ...second],
    });
    expand(a, far, first);
    expand(far, b, second);
  };
  // Outside is to the left of each edge here, so the polygon grows clockwise.
  expand(left, right, above);
  expand(right, left, below);
  hull.reverse();
  return finish(rec, [...hull]);
}

export function giftWrap(points: readonly Point[]): HullResult {
  const small = trivial(points);
  if (small) return small;
  const rec = new Recorder(points);
  let start = 0;
  points.forEach((p, i) => {
    if (lexLess(p, points[start])) start = i;
  });
  const hull = [start];
  rec.push({
    note: `Start at the leftmost point ${name(start)}.`,
    chain: [...hull],
    closed: false,
  });
  let current = start;
  for (let guard = 0; guard <= points.length; guard++) {
    let candidate = current === 0 ? 1 : 0;
    for (let i = 0; i < points.length; i++) {
      if (i === current || i === candidate) continue;
      const cross = rec.cross(current, candidate, i);
      const better =
        cross < 0 ||
        (cross === 0 &&
          dist2(points[current], points[i]) > dist2(points[current], points[candidate]));
      rec.push({
        note: better
          ? `${name(i)} is to the right of ${name(current)}–${name(candidate)}: it becomes the candidate.`
          : `${name(i)} is not to the right of ${name(current)}–${name(candidate)}: keep the candidate.`,
        chain: [...hull],
        closed: false,
        turn: { a: current, b: candidate, c: i, cross, keep: !better },
      });
      if (better) candidate = i;
    }
    if (candidate === start) break;
    hull.push(candidate);
    rec.push({
      note: `Nothing is to the right of ${name(current)}–${name(candidate)}: ${name(candidate)} is the next hull vertex.`,
      chain: [...hull],
      closed: false,
    });
    current = candidate;
  }
  return finish(rec, hull);
}

export function convexHull(algorithm: HullAlgorithm, points: readonly Point[]): HullResult {
  if (algorithm === 'monotone') return monotoneChain(points);
  if (algorithm === 'quickhull') return quickhull(points);
  if (algorithm === 'wrap') return giftWrap(points);
  return grahamScan(points);
}
