import type { Point } from '../geometry';

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
