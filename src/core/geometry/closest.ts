import type { Point } from '../point';
import { dist2 } from './plane';

/** One frame of the divide-and-conquer closest pair. */
export interface ClosestStep {
  kind: 'split' | 'compare' | 'strip' | 'merged' | 'done';
  /** x-range of the sub-problem being worked on. */
  x0: number;
  x1: number;
  /** Split lines of the enclosing calls, outermost first, ending with this call's. */
  splits: number[];
  /** Smallest distance known inside this sub-problem (Infinity before any). */
  d: number;
  /** For 'strip' and comparisons inside it: the points within d of the split line. */
  strip?: number[];
  /** The pair being measured. */
  pair?: [number, number];
  /** Closest pair seen so far anywhere. */
  best?: [number, number];
  /** Distance computations so far. */
  distances: number;
  /** Most later strip points any one strip point has been compared with. */
  neighbours: number;
  note: string;
}

export interface ClosestResult {
  pair?: [number, number];
  distance: number;
  steps: ClosestStep[];
}

export function bruteForceClosest(points: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) best = Math.min(best, dist2(points[i], points[j]));
  }
  return Math.sqrt(best);
}

export function closestPair(points: readonly Point[]): ClosestResult {
  const steps: ClosestStep[] = [];
  const byX = points
    .map((_, i) => i)
    .sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y);
  let distances = 0;
  let neighbours = 0;
  let best: [number, number] | undefined;
  let bestD2 = Infinity;
  const name = (i: number) => `p${i + 1}`;
  const round = (d2: number) => (Number.isFinite(d2) ? Math.sqrt(d2).toFixed(0) : '∞');

  interface Local {
    d2: number;
    /** The sub-problem's points sorted by y, for the merge. */
    byY: number[];
  }

  const solve = (lo: number, hi: number, splits: number[]): Local => {
    const x0 = points[byX[lo]].x;
    const x1 = points[byX[hi - 1]].x;
    let d2 = Infinity;
    const push = (step: Pick<ClosestStep, 'kind' | 'note' | 'pair' | 'strip'>, lines = splits) => {
      steps.push({
        ...step,
        x0,
        x1,
        splits: lines,
        d: Math.sqrt(d2),
        best,
        distances,
        neighbours,
      });
    };
    const measure = (i: number, j: number, strip?: number[], lines = splits) => {
      distances++;
      const value = dist2(points[i], points[j]);
      const improved = value < d2;
      if (improved) d2 = value;
      if (value < bestD2) {
        bestD2 = value;
        best = [i, j];
      }
      push(
        {
          kind: 'compare',
          pair: [i, j],
          strip,
          note: `Distance ${name(i)}–${name(j)} is ${round(value)}${improved ? ': the best in this part so far.' : '.'}`,
        },
        lines,
      );
    };

    if (hi - lo <= 3) {
      for (let i = lo; i < hi; i++) {
        for (let j = i + 1; j < hi; j++) measure(byX[i], byX[j]);
      }
      const byY = byX.slice(lo, hi).sort((a, b) => points[a].y - points[b].y);
      return { d2, byY };
    }

    const mid = (lo + hi) >> 1;
    const line = (points[byX[mid - 1]].x + points[byX[mid]].x) / 2;
    const lines = [...splits, line];
    push(
      {
        kind: 'split',
        note: `Split ${hi - lo} points into ${mid - lo} left and ${hi - mid} right of the line.`,
      },
      lines,
    );
    const left = solve(lo, mid, lines);
    const right = solve(mid, hi, lines);
    d2 = Math.min(left.d2, right.d2);

    // Merge the two y-sorted halves, then keep the points within d of the line.
    const byY: number[] = [];
    for (let i = 0, j = 0; i < left.byY.length || j < right.byY.length;) {
      const takeLeft =
        j >= right.byY.length ||
        (i < left.byY.length && points[left.byY[i]].y <= points[right.byY[j]].y);
      byY.push(takeLeft ? left.byY[i++] : right.byY[j++]);
    }
    const strip = byY.filter((i) => (points[i].x - line) ** 2 < d2);
    push(
      {
        kind: 'strip',
        strip,
        note: `Both halves are done: d = ${round(d2)}. A closer pair must straddle the line, so only the ${strip.length} point${strip.length === 1 ? '' : 's'} within d of it matter.`,
      },
      lines,
    );
    for (let i = 0; i < strip.length; i++) {
      let checked = 0;
      for (let j = i + 1; j < strip.length; j++) {
        if ((points[strip[j]].y - points[strip[i]].y) ** 2 >= d2) break;
        checked++;
        neighbours = Math.max(neighbours, checked);
        measure(strip[i], strip[j], strip, lines);
      }
    }
    push(
      { kind: 'merged', note: `This part is finished: its closest pair is ${round(d2)} apart.` },
      lines,
    );
    return { d2, byY };
  };

  if (points.length >= 2) solve(0, points.length, []);
  steps.push({
    kind: 'done',
    x0: -Infinity,
    x1: Infinity,
    splits: [],
    d: Math.sqrt(bestD2),
    best,
    distances,
    neighbours,
    note: best
      ? `Done: ${name(best[0])} and ${name(best[1])} are closest, ${round(bestD2)} apart.`
      : 'Add at least two points.',
  });
  return { pair: best, distance: Math.sqrt(bestD2), steps };
}
