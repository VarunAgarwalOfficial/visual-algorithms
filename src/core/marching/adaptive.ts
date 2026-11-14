import { cellSegments } from './squares';

export interface AdaptiveContour {
  /** Contour segments in field units, packed [x1, y1, x2, y2, ...]. */
  segments: number[];
  /** The quadtree leaves that were visited, packed [x, y, size, ...]. */
  leaves: number[];
  /** Every point where the field was evaluated, packed [x, y, value, ...]. */
  samples: number[];
}

/**
 * Marching squares on a quadtree instead of a full grid. The plane is first cut
 * into coarse cells of `fine * 2^levels`. A cell is split in four when the
 * contour may pass through it: its corners disagree, or its centre disagrees
 * with its corners (a blob or a gap smaller than the cell). Only cells of the
 * finest size emit segments, so the outline is the one a uniform grid of
 * `fine` cells would give.
 *
 * Those tests can miss a contour that bulges into a coarse cell through one
 * side. So the outline is also followed: whenever a fine cell's segment ends on
 * an edge, the cell across that edge is processed too, even inside a coarse
 * leaf. Every outline that is found is therefore closed. Only a blob lying
 * wholly inside a coarse cell, clear of its corners and centre, is missed.
 */
export function adaptiveContour(
  field: (x: number, y: number) => number,
  width: number,
  height: number,
  fine: number,
  levels: number,
  threshold: number,
  interpolate: boolean,
): AdaptiveContour {
  const coarse = 2 ** levels; // in fine cells
  const cols = Math.ceil(width / (fine * coarse)) * coarse;
  const rows = Math.ceil(height / (fine * coarse)) * coarse;
  const stride = 2 * cols + 1; // half-cell resolution, so cell centres have keys too
  const cache = new Map<number, number>();
  const out: AdaptiveContour = { segments: [], leaves: [], samples: [] };

  /** The field at (c, r) in half-fine-cell units, evaluated once. */
  const sample = (c: number, r: number): number => {
    const key = r * stride + c;
    let value = cache.get(key);
    if (value === undefined) {
      const x = (c * fine) / 2;
      const y = (r * fine) / 2;
      value = field(x, y);
      cache.set(key, value);
      out.samples.push(x, y, value);
    }
    return value;
  };

  const done = new Set<number>();
  const queue: number[] = [];
  const inside = (v: number) => v >= threshold;

  /** Emits one finest-size cell and queues the cells its segments lead into. */
  const emit = (c: number, r: number) => {
    done.add(r * cols + c);
    out.leaves.push(c * fine, r * fine, fine);
    const tl = sample(2 * c, 2 * r);
    const tr = sample(2 * c + 2, 2 * r);
    const br = sample(2 * c + 2, 2 * r + 2);
    const bl = sample(2 * c, 2 * r + 2);
    const cell = cellSegments(tl, tr, br, bl, threshold, interpolate);
    for (let k = 0; k < cell.length; k += 2) {
      const x = cell[k];
      const y = cell[k + 1];
      out.segments.push((x + c) * fine, (y + r) * fine);
      // Each endpoint lies on one side of the cell; the contour continues across it.
      const nc = y === 0 || y === 1 ? c : x === 0 ? c - 1 : c + 1;
      const nr = y === 0 ? r - 1 : y === 1 ? r + 1 : r;
      if (nc >= 0 && nr >= 0 && nc < cols && nr < rows) queue.push(nc, nr);
    }
  };

  const visit = (c: number, r: number, size: number) => {
    if (size === 1) {
      emit(c, r);
      return;
    }
    // c, r and size are in fine cells; samples are addressed in half cells.
    const tl = sample(2 * c, 2 * r);
    const tr = sample(2 * (c + size), 2 * r);
    const br = sample(2 * (c + size), 2 * (r + size));
    const bl = sample(2 * c, 2 * (r + size));
    const mixed =
      inside(tl) !== inside(tr) || inside(tr) !== inside(br) || inside(br) !== inside(bl);
    if (!mixed && inside(sample(2 * c + size, 2 * r + size)) === inside(tl)) {
      out.leaves.push(c * fine, r * fine, size * fine);
      return;
    }
    const half = size / 2;
    visit(c, r, half);
    visit(c + half, r, half);
    visit(c, r + half, half);
    visit(c + half, r + half, half);
  };

  for (let r = 0; r < rows; r += coarse) {
    for (let c = 0; c < cols; c += coarse) visit(c, r, coarse);
  }
  while (queue.length > 0) {
    const r = queue.pop() as number;
    const c = queue.pop() as number;
    if (!done.has(r * cols + c)) emit(c, r);
  }
  return out;
}
