import {
  caseIndex,
  crossing,
  segmentsForCase,
  BOTTOM,
  LEFT,
  RIGHT,
  TOP,
} from '../marching/squares';
import type { Edge } from '../marching/squares';
import type { Random } from '../random';

/** Heights are whole numbers 0..63 so a painted field packs into the URL. */
export const FIELD_MAX = 63;

export const FIELD_PRESETS = [
  { id: 'bumps', name: 'Two bumps' },
  { id: 'noise', name: 'Noise' },
  { id: 'saddles', name: 'Egg box (saddles)' },
  { id: 'ring', name: 'Ring' },
  { id: 'flat', name: 'Flat (paint your own)' },
] as const;
export type FieldPreset = (typeof FIELD_PRESETS)[number]['id'];

const quantise = (v: number) => Math.max(0, Math.min(FIELD_MAX, Math.round(v * FIELD_MAX)));

/** A preset sampled at the (cols + 1) x (rows + 1) corners of a grid of cells, row by row. */
export function presetField(
  kind: FieldPreset,
  cols: number,
  rows: number,
  random: Random,
): Uint8Array {
  const values = new Uint8Array((cols + 1) * (rows + 1));
  // Smooth noise: random values on a coarse lattice, blended with a smoothstep.
  const size = 6;
  const lattice = Array.from({ length: (size + 1) * (size + 1) }, () => random());
  const noise = (u: number, v: number) => {
    const x = Math.min(size - 1e-6, u * size);
    const y = Math.min(size - 1e-6, v * size);
    const i = Math.floor(x);
    const j = Math.floor(y);
    const sx = (x - i) ** 2 * (3 - 2 * (x - i));
    const sy = (y - j) ** 2 * (3 - 2 * (y - j));
    const at = (a: number, b: number) => lattice[b * (size + 1) + a];
    const top = at(i, j) + sx * (at(i + 1, j) - at(i, j));
    const bottom = at(i, j + 1) + sx * (at(i + 1, j + 1) - at(i, j + 1));
    return top + sy * (bottom - top);
  };
  const bump = (u: number, v: number, cx: number, cy: number, r: number) =>
    Math.exp(-((u - cx) ** 2 + ((v - cy) * 0.75) ** 2) / (r * r));
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const v = r / rows;
      let h = 0;
      if (kind === 'bumps') h = bump(u, v, 0.33, 0.42, 0.2) + 0.75 * bump(u, v, 0.68, 0.6, 0.17);
      else if (kind === 'noise') h = noise(u, v);
      else if (kind === 'saddles') {
        // Phases chosen so the saddle points fall inside cells, not on grid lines.
        h = 0.5 + 0.5 * Math.sin(3.3 * Math.PI * u + 0.5) * Math.sin(2.7 * Math.PI * v + 0.4);
      } else if (kind === 'ring') {
        const d = Math.hypot(u - 0.5, (v - 0.5) * 0.75);
        h = Math.exp(-(((d - 0.26) / 0.09) ** 2));
      }
      values[r * (cols + 1) + c] = quantise(h);
    }
  }
  return values;
}

/** Bilinear resampling to another grid size. */
export function resampleField(
  values: ArrayLike<number>,
  cols: number,
  rows: number,
  newCols: number,
  newRows: number,
): Uint8Array {
  const out = new Uint8Array((newCols + 1) * (newRows + 1));
  for (let r = 0; r <= newRows; r++) {
    for (let c = 0; c <= newCols; c++) {
      const x = (c / newCols) * cols;
      const y = (r / newRows) * rows;
      const i = Math.min(cols - 1, Math.floor(x));
      const j = Math.min(rows - 1, Math.floor(y));
      const at = (a: number, b: number) => values[b * (cols + 1) + a];
      const top = at(i, j) + (x - i) * (at(i + 1, j) - at(i, j));
      const bottom = at(i, j + 1) + (x - i) * (at(i + 1, j + 1) - at(i, j + 1));
      out[r * (newCols + 1) + c] = Math.round(top + (y - j) * (bottom - top));
    }
  }
  return out;
}

/** Raises (or lowers, for a negative amount) the field under a round soft brush. Units are cells. */
export function paintField(
  values: Uint8Array,
  cols: number,
  rows: number,
  x: number,
  y: number,
  radius: number,
  amount: number,
): void {
  for (
    let r = Math.max(0, Math.floor(y - radius));
    r <= Math.min(rows, Math.ceil(y + radius));
    r++
  ) {
    for (
      let c = Math.max(0, Math.floor(x - radius));
      c <= Math.min(cols, Math.ceil(x + radius));
      c++
    ) {
      const d = Math.hypot(c - x, r - y) / radius;
      if (d >= 1) continue;
      const i = r * (cols + 1) + c;
      const next = values[i] + amount * (1 - d * d);
      values[i] = Math.max(0, Math.min(FIELD_MAX, Math.round(next)));
    }
  }
}

export interface CellShape {
  /** The 4-bit case, 0..15. */
  index: number;
  /** True when a saddle was resolved by joining the two inside corners. */
  joined: boolean;
  /** Contour segments in cell coordinates (0..1), packed x1, y1, x2, y2. */
  segments: number[];
  /** The inside region as polygons, each packed x, y, x, y, ... */
  inside: number[][];
}

/**
 * One cell of marching squares, with the choices exposed. With `interpolate`
 * off every crossing sits mid-edge. With `disambiguate` on, a saddle joins its
 * two inside corners when the average of the four corners is inside.
 */
export function cellShape(
  tl: number,
  tr: number,
  br: number,
  bl: number,
  threshold: number,
  interpolate: boolean,
  disambiguate: boolean,
): CellShape {
  const index = caseIndex(tl, tr, br, bl, threshold);
  const saddle = index === 5 || index === 10;
  const joined = saddle && disambiguate && (tl + tr + br + bl) / 4 >= threshold;
  if (index === 0) return { index, joined, segments: [], inside: [] };
  if (index === 15) return { index, joined, segments: [], inside: [[0, 0, 1, 0, 1, 1, 0, 1]] };

  const at = (a: number, b: number) => (interpolate ? crossing(a, b, threshold) : 0.5);
  const point = (edge: Edge): [number, number] => {
    if (edge === TOP) return [at(tl, tr), 0];
    if (edge === RIGHT) return [1, at(tr, br)];
    if (edge === BOTTOM) return [at(bl, br), 1];
    return [0, at(tl, bl)];
  };
  const segments: number[] = [];
  for (const [from, to] of segmentsForCase(index, joined))
    segments.push(...point(from), ...point(to));

  // Corners clockwise from the top-left, each followed by the edge leading to the next.
  const corners: [number, number, boolean, Edge][] = [
    [0, 0, tl >= threshold, TOP],
    [1, 0, tr >= threshold, RIGHT],
    [1, 1, br >= threshold, BOTTOM],
    [0, 1, bl >= threshold, LEFT],
  ];
  const inside: number[][] = [];
  if (saddle && !joined) {
    // Two separate corners: each is a triangle with the crossings on its two edges.
    corners.forEach(([x, y, isInside, edge], k) => {
      if (!isInside) return;
      const before = corners[(k + 3) % 4][3];
      inside.push([...point(before), x, y, ...point(edge)]);
    });
  } else {
    const polygon: number[] = [];
    corners.forEach(([x, y, isInside, edge], k) => {
      if (isInside) polygon.push(x, y);
      if (isInside !== corners[(k + 1) % 4][2]) polygon.push(...point(edge));
    });
    inside.push(polygon);
  }
  return { index, joined, segments, inside };
}
