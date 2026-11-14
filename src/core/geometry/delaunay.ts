import type { Point } from '../point';
import { inCircle, orient } from './plane';

/**
 * Delaunay triangulation by Bowyer-Watson insertion.
 *
 * Instead of a huge "super-triangle" (which gives wrong hull triangles when it
 * is not big enough, and inexact arithmetic when it is), every hull edge
 * carries a ghost triangle whose third vertex is at infinity. A point is
 * "inside the circumcircle" of a ghost triangle when it lies strictly outside
 * the hull across that edge, or on the edge itself.
 */
export const GHOST = -1;
/** Vertex indices, anticlockwise on screen. A ghost triangle has GHOST last. */
export type Triangle = readonly [number, number, number];

export interface DelaunayStep {
  kind: 'start' | 'bad' | 'fill' | 'done';
  /** The point being inserted (or -1). */
  point: number;
  /** Indices of the points inserted so far. */
  inserted: number[];
  triangles: Triangle[];
  /** For 'bad': positions in `triangles` of those whose circumcircle holds the point. */
  bad: number[];
  /** For 'bad': the boundary of the cavity, as directed edges (GHOST allowed). */
  cavity: [number, number][];
  /** For 'fill': how many triangles at the end of `triangles` are new. */
  fresh: number;
  note: string;
}

const isBad = (points: readonly Point[], t: Triangle, p: Point): boolean => {
  const a = points[t[0]];
  const b = points[t[1]];
  if (t[2] === GHOST) {
    const side = orient(a, b, p);
    if (side !== 0) return side > 0;
    // Collinear with the hull edge: inside only when strictly between its ends.
    return (p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y) < 0;
  }
  return inCircle(a, b, points[t[2]], p) > 0;
};

/**
 * Triangulates distinct points. Returns real and ghost triangles; empty when
 * there are fewer than three points or they are all collinear.
 */
export function delaunay(points: readonly Point[], steps?: DelaunayStep[]): Triangle[] {
  const n = points.length;
  let third = 2;
  while (third < n && orient(points[0], points[1], points[third]) === 0) third++;
  if (n < 3 || third >= n) {
    steps?.push({
      kind: 'done',
      point: -1,
      inserted: points.map((_, i) => i),
      triangles: [],
      bad: [],
      cavity: [],
      fresh: 0,
      note:
        n < 3 ? 'Add at least three points.' : 'All points are collinear: there is no triangle.',
    });
    return [];
  }
  const [a, b] = orient(points[0], points[1], points[third]) > 0 ? [0, 1] : [1, 0];
  let triangles: Triangle[] = [
    [a, b, third],
    [b, a, GHOST],
    [third, b, GHOST],
    [a, third, GHOST],
  ];
  const inserted = [0, 1, third];
  steps?.push({
    kind: 'start',
    point: -1,
    inserted: [...inserted],
    triangles,
    bad: [],
    cavity: [],
    fresh: 1,
    note: `Start with one triangle: p1, p2, p${third + 1}.`,
  });

  const key = (u: number, v: number) => (u + 1) * (n + 1) + (v + 1);
  for (let i = 2; i < n; i++) {
    if (i === third) continue;
    const p = points[i];
    const bad: number[] = [];
    const edges = new Set<number>();
    triangles.forEach((t, index) => {
      if (!isBad(points, t, p)) return;
      bad.push(index);
      edges.add(key(t[0], t[1])).add(key(t[1], t[2])).add(key(t[2], t[0]));
    });
    // A cavity edge belongs to exactly one bad triangle.
    const cavity: [number, number][] = [];
    for (const index of bad) {
      const t = triangles[index];
      for (let e = 0; e < 3; e++) {
        const u = t[e];
        const v = t[(e + 1) % 3];
        if (!edges.has(key(v, u))) cavity.push([u, v]);
      }
    }
    const real = bad.filter((index) => triangles[index][2] !== GHOST).length;
    steps?.push({
      kind: 'bad',
      point: i,
      inserted: [...inserted],
      triangles,
      bad,
      cavity,
      fresh: 0,
      note:
        real === 0
          ? `Insert p${i + 1}. It is outside the hull: the hull edges it can see are removed.`
          : `Insert p${i + 1}. ${real} triangle${real === 1 ? ' has' : 's have'} it inside the circumcircle: remove ${real === 1 ? 'it' : 'them'}.`,
    });
    const badSet = new Set(bad);
    const next = triangles.filter((_, index) => !badSet.has(index));
    for (const [u, v] of cavity) {
      next.push(u === GHOST ? [v, i, GHOST] : v === GHOST ? [i, u, GHOST] : [u, v, i]);
    }
    triangles = next;
    inserted.push(i);
    const fresh = cavity.filter(([u, v]) => u !== GHOST && v !== GHOST).length;
    steps?.push({
      kind: 'fill',
      point: i,
      inserted: [...inserted],
      triangles,
      bad: [],
      cavity,
      fresh: cavity.length,
      note: `Join p${i + 1} to every edge of the hole: ${fresh} new triangle${fresh === 1 ? '' : 's'}.`,
    });
  }
  steps?.push({
    kind: 'done',
    point: -1,
    inserted: [...inserted],
    triangles,
    bad: [],
    cavity: [],
    fresh: 0,
    note: `Done: ${realTriangles(triangles).length} triangles. No circumcircle contains a point.`,
  });
  return triangles;
}

export function realTriangles(triangles: readonly Triangle[]): Triangle[] {
  return triangles.filter((t) => t[2] !== GHOST);
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export function circumcircle(a: Point, b: Point, c: Point): Circle {
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const d = 2 * (bx * cy - by * cx);
  const ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d;
  const uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d;
  return { x: a.x + ux, y: a.y + uy, r: Math.hypot(ux, uy) };
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Keeps the part of a convex polygon nearer to `site` than to `other`. */
function clipNearer(polygon: Point[], site: Point, other: Point): Point[] {
  const nx = other.x - site.x;
  const ny = other.y - site.y;
  const limit = (nx * (site.x + other.x) + ny * (site.y + other.y)) / 2;
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    const dp = nx * p.x + ny * p.y - limit;
    const dq = nx * q.x + ny * q.y - limit;
    if (dp <= 0) out.push(p);
    if (dp <= 0 !== dq <= 0) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return out;
}

/**
 * Voronoi cells of the `sites` (indices into points), clipped to a box. A cell
 * is the box cut by the bisector with each Delaunay neighbour, so its corners
 * are the circumcentres and unbounded cells need no special case. Without a
 * triangulation (collinear sites) every other site is used.
 */
export function voronoiCells(
  points: readonly Point[],
  sites: readonly number[],
  triangles: readonly Triangle[],
  box: Box,
): Map<number, Point[]> {
  const neighbours = new Map<number, Set<number>>();
  for (const s of sites) neighbours.set(s, new Set());
  const real = realTriangles(triangles);
  for (const t of real) {
    for (let e = 0; e < 3; e++) {
      neighbours.get(t[e])?.add(t[(e + 1) % 3]);
      neighbours.get(t[(e + 1) % 3])?.add(t[e]);
    }
  }
  const cells = new Map<number, Point[]>();
  for (const s of sites) {
    let cell: Point[] = [
      { x: box.x0, y: box.y0 },
      { x: box.x1, y: box.y0 },
      { x: box.x1, y: box.y1 },
      { x: box.x0, y: box.y1 },
    ];
    const others = real.length ? (neighbours.get(s) ?? []) : sites.filter((o) => o !== s);
    for (const o of others) {
      cell = clipNearer(cell, points[s], points[o]);
      if (cell.length === 0) break;
    }
    cells.set(s, cell);
  }
  return cells;
}
