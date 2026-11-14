import type { Point } from '../point';
import type { Random } from '../random';

/**
 * The geometry demos work on an integer lattice: 1000 steps each way, scaled
 * 4:3 so that distances and circles are true to what is drawn. On integers this
 * small the orientation and in-circle tests below are exact in doubles, so the
 * degenerate cases (collinear, cocircular) are decided, not guessed.
 *
 * Screen coordinates have y pointing down. "Anticlockwise" and "left" always
 * mean as drawn on screen.
 */
export const LATTICE = 999;
export const WORLD_W = 4 * LATTICE;
export const WORLD_H = 3 * LATTICE;

/** Unit-square point (as stored in the URL) to the lattice. */
export function toWorld(p: Point): Point {
  const q = (v: number) => Math.max(0, Math.min(LATTICE, Math.round(v * LATTICE)));
  return { x: 4 * q(p.x), y: 3 * q(p.y) };
}

export function toUnit(p: Point): Point {
  return { x: p.x / WORLD_W, y: p.y / WORLD_H };
}

/** Snaps any world position to the nearest lattice point inside the world. */
export function snap(p: Point): Point {
  return toWorld(toUnit(p));
}

/**
 * Cross product of (b - a) and (c - a), signed so that a positive value means
 * a, b, c turn anticlockwise on screen (c is to the left of the ray a to b).
 */
export function orient(a: Point, b: Point, c: Point): number {
  return (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
}

export function dist2(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** Positive when d is strictly inside the circle through a, b, c (given anticlockwise). */
export function inCircle(a: Point, b: Point, c: Point, d: Point): number {
  const ax = a.x - d.x;
  const ay = a.y - d.y;
  const bx = b.x - d.x;
  const by = b.y - d.y;
  const cx = c.x - d.x;
  const cy = c.y - d.y;
  const det =
    (ax * ax + ay * ay) * (bx * cy - by * cx) -
    (bx * bx + by * by) * (ax * cy - ay * cx) +
    (cx * cx + cy * cy) * (ax * by - ay * bx);
  return -det;
}

/** Drops points that share a lattice position with an earlier one. */
export function dedupe(points: readonly Point[]): Point[] {
  const seen = new Set<number>();
  const out: Point[] = [];
  for (const p of points) {
    const key = p.x * 10000 + p.y;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export const DISTRIBUTIONS = [
  { id: 'uniform', name: 'Uniform' },
  { id: 'cluster', name: 'Gaussian cluster' },
  { id: 'circle', name: 'On a circle' },
  { id: 'jitter', name: 'Grid with jitter' },
  { id: 'grid', name: 'Exact grid' },
] as const;
export type Distribution = (typeof DISTRIBUTIONS)[number]['id'];

/** About `count` distinct lattice points (fewer if duplicates were dropped). */
export function randomPoints(kind: Distribution, count: number, random: Random): Point[] {
  const unit: Point[] = [];
  const margin = 0.06;
  const span = 1 - 2 * margin;
  if (kind === 'cluster') {
    const gauss = () => {
      const u = Math.max(1e-9, random());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
    };
    for (let i = 0; i < count; i++) {
      unit.push({ x: 0.5 + 0.11 * gauss(), y: 0.5 + 0.15 * gauss() });
    }
  } else if (kind === 'circle') {
    for (let i = 0; i < count; i++) {
      const angle = 2 * Math.PI * random();
      unit.push({ x: 0.5 + 0.3 * Math.cos(angle), y: 0.5 + 0.4 * Math.sin(angle) });
    }
  } else if (kind === 'jitter' || kind === 'grid') {
    const cols = Math.max(1, Math.ceil(Math.sqrt((count * 4) / 3)));
    const rows = Math.max(1, Math.ceil(count / cols));
    const jitter = kind === 'jitter' ? 0.35 : 0;
    for (let i = 0; i < count; i++) {
      const c = i % cols;
      const r = Math.floor(i / cols);
      unit.push({
        x: margin + (span * (c + 0.5 + jitter * (random() - 0.5))) / cols,
        y: margin + (span * (r + 0.5 + jitter * (random() - 0.5))) / rows,
      });
    }
  } else {
    for (let i = 0; i < count; i++) {
      unit.push({ x: margin + span * random(), y: margin + span * random() });
    }
  }
  const clamp = (v: number) => Math.max(0.02, Math.min(0.98, v));
  return dedupe(unit.map((p) => toWorld({ x: clamp(p.x), y: clamp(p.y) })));
}
