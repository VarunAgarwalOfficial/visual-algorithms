import type { Point } from '../point';

/** Reads a flat list of numbers ("x y x y" or "x,y x,y") into points, as used by SVG polylines. */
export function parsePoints(text: string): Point[] {
  const numbers = text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];
  const points: Point[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push({ x: numbers[i], y: numbers[i + 1] });
  }
  return points;
}

/** Length of the polyline through `points`, including the closing edge when `closed`. */
export function pathLength(points: readonly Point[], closed: boolean): number {
  let total = 0;
  const edges = closed ? points.length : points.length - 1;
  for (let i = 0; i < edges; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * Resamples a polyline to `count` points evenly spaced by arc length. The DFT
 * assumes equal time steps, so even spacing makes the pen move at a steady speed.
 * A closed path includes the edge from the last point back to the first.
 */
export function resample(points: readonly Point[], count: number, closed = true): Point[] {
  if (points.length === 0 || count <= 0) return [];
  const total = pathLength(points, closed);
  if (total === 0) return Array.from({ length: count }, () => ({ ...points[0] }));

  const edges = closed ? points.length : points.length - 1;
  const spacing = closed ? total / count : total / Math.max(1, count - 1);
  const out: Point[] = [];
  let edge = 0;
  let edgeStart = 0; // arc length at the start of the current edge
  for (let i = 0; i < count; i++) {
    const target = Math.min(i * spacing, total);
    for (;;) {
      const a = points[edge];
      const b = points[(edge + 1) % points.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (target <= edgeStart + length || edge === edges - 1) {
        const f = length === 0 ? 0 : Math.min(1, (target - edgeStart) / length);
        out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
        break;
      }
      edgeStart += length;
      edge++;
    }
  }
  return out;
}

/** Centres points on their bounding box and scales them to fit [-1, 1] on the longer side. */
export function normalise(points: readonly Point[]): Point[] {
  if (points.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const half = Math.max(maxX - minX, maxY - minY) / 2 || 1;
  return points.map((p) => ({ x: (p.x - cx) / half, y: (p.y - cy) / half }));
}

/**
 * Joins several outlines into one path for a single pen. Starts with the
 * longest, then keeps moving to whichever remaining outline has a point nearest
 * the pen. A closed outline (first point equal to its last) is entered at that
 * nearest point; an open one at whichever end is nearer.
 */
export function joinOutlines(outlines: readonly (readonly Point[])[]): Point[] {
  const rest = outlines.filter((o) => o.length > 0).map((o) => [...o]);
  if (rest.length === 0) return [];
  rest.sort((a, b) => pathLength(b, false) - pathLength(a, false));
  const out = rest.shift() as Point[];
  const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  while (rest.length > 0) {
    const pen = out[out.length - 1];
    let best = { outline: 0, index: 0, distance: Infinity };
    rest.forEach((points, outline) => {
      const closed = gap(points[0], points[points.length - 1]) < 1e-6;
      const candidates = closed ? points.map((_, i) => i) : [0, points.length - 1];
      for (const index of candidates) {
        const distance = gap(pen, points[index]);
        if (distance < best.distance) best = { outline, index, distance };
      }
    });
    const [points] = rest.splice(best.outline, 1);
    const closed = gap(points[0], points[points.length - 1]) < 1e-6;
    if (closed) out.push(...points.slice(best.index), ...points.slice(0, best.index + 1));
    else out.push(...(best.index === 0 ? points : points.reverse()));
  }
  return out;
}
