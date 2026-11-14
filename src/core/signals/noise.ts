import { seeded, shuffle } from '../random';

/**
 * Gradient noise in two dimensions: Perlin's lattice noise, simplex noise and,
 * for contrast, value noise. All three return values in [-1, 1] and are fixed
 * by the seed.
 */

export type Fade = 'quintic' | 'smoothstep' | 'linear';
export type NoiseKind = 'perlin' | 'simplex' | 'value';

export function fade(t: number, kind: Fade): number {
  if (kind === 'quintic') return t * t * t * (t * (t * 6 - 15) + 10);
  if (kind === 'smoothstep') return t * t * (3 - 2 * t);
  return t;
}

export interface Corner {
  /** Lattice point in noise coordinates. */
  x: number;
  y: number;
  /** Its gradient (zero for value noise). */
  gx: number;
  gy: number;
  /** What this corner offers before blending: gradient · offset, or its value. */
  dot: number;
  /** Its share in the result. The contributions sum to the noise value. */
  contribution: number;
}

export interface Noise {
  perlin(x: number, y: number, fadeKind?: Fade): number;
  simplex(x: number, y: number): number;
  value(x: number, y: number, fadeKind?: Fade): number;
  /** Unit gradient at an integer lattice point (Perlin). */
  gradient(ix: number, iy: number): [number, number];
  /** Unit gradient at a simplex lattice point, given its skewed integer coordinates. */
  simplexGradient(i: number, j: number): [number, number];
  /** The lattice corners around a point and what each contributes. */
  corners(kind: NoiseKind, x: number, y: number, fadeKind?: Fade): Corner[];
}

export const SKEW = 0.5 * (Math.sqrt(3) - 1);
export const UNSKEW = (3 - Math.sqrt(3)) / 6;
const F2 = SKEW;
const G2 = UNSKEW;
/** Twelve directions for simplex noise, as in Gustavson's reference code. */
const GRAD_X = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
const GRAD_Y = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1];
const SIMPLEX_SCALE = 70;
/** 2D Perlin noise with unit gradients peaks at √2 / 2. */
const PERLIN_SCALE = Math.SQRT2;

export function createNoise(seed: number): Noise {
  const random = seeded(seed);
  const table = shuffle(
    Array.from({ length: 256 }, (_, i) => i),
    random,
  );
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = table[i & 255];
  // 256 unit vectors, evenly spread around the circle.
  const cos = new Float64Array(256);
  const sin = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    cos[i] = Math.cos((i / 256) * 2 * Math.PI);
    sin[i] = Math.sin((i / 256) * 2 * Math.PI);
  }
  const hash = (ix: number, iy: number) => perm[perm[ix & 255] + (iy & 255)];

  function perlin(x: number, y: number, fadeKind: Fade = 'quintic'): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const dx = x - x0;
    const dy = y - y0;
    const h00 = hash(x0, y0);
    const h10 = hash(x0 + 1, y0);
    const h01 = hash(x0, y0 + 1);
    const h11 = hash(x0 + 1, y0 + 1);
    const d00 = cos[h00] * dx + sin[h00] * dy;
    const d10 = cos[h10] * (dx - 1) + sin[h10] * dy;
    const d01 = cos[h01] * dx + sin[h01] * (dy - 1);
    const d11 = cos[h11] * (dx - 1) + sin[h11] * (dy - 1);
    const u = fade(dx, fadeKind);
    const v = fade(dy, fadeKind);
    const top = d00 + (d10 - d00) * u;
    const bottom = d01 + (d11 - d01) * u;
    return Math.max(-1, Math.min(1, (top + (bottom - top) * v) * PERLIN_SCALE));
  }

  function value(x: number, y: number, fadeKind: Fade = 'quintic'): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const u = fade(x - x0, fadeKind);
    const v = fade(y - y0, fadeKind);
    const a = hash(x0, y0);
    const b = hash(x0 + 1, y0);
    const c = hash(x0, y0 + 1);
    const d = hash(x0 + 1, y0 + 1);
    const top = a + (b - a) * u;
    const bottom = c + (d - c) * u;
    return ((top + (bottom - top) * v) / 255) * 2 - 1;
  }

  /** One simplex corner: a radial falloff times gradient · offset. */
  function bump(ix: number, iy: number, dx: number, dy: number): number {
    const t = 0.5 - dx * dx - dy * dy;
    if (t <= 0) return 0;
    const g = hash(ix, iy) % 12;
    return t * t * t * t * (GRAD_X[g] * dx + GRAD_Y[g] * dy);
  }

  function simplex(x: number, y: number): number {
    // Skew the plane so the triangles become half squares, and find the cell.
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const dx0 = x - (i - t);
    const dy0 = y - (j - t);
    // Which of the two triangles in the cell.
    const i1 = dx0 > dy0 ? 1 : 0;
    const j1 = 1 - i1;
    const sum =
      bump(i, j, dx0, dy0) +
      bump(i + i1, j + j1, dx0 - i1 + G2, dy0 - j1 + G2) +
      bump(i + 1, j + 1, dx0 - 1 + 2 * G2, dy0 - 1 + 2 * G2);
    return Math.max(-1, Math.min(1, SIMPLEX_SCALE * sum));
  }

  function corners(kind: NoiseKind, x: number, y: number, fadeKind: Fade = 'quintic'): Corner[] {
    if (kind === 'simplex') {
      const s = (x + y) * F2;
      const i = Math.floor(x + s);
      const j = Math.floor(y + s);
      const upper = x - (i - (i + j) * G2) > y - (j - (i + j) * G2) ? 0 : 1;
      const cells = [
        [i, j],
        [i + 1 - upper, j + upper],
        [i + 1, j + 1],
      ];
      return cells.map(([ci, cj]) => {
        const cx = ci - (ci + cj) * G2;
        const cy = cj - (ci + cj) * G2;
        const g = hash(ci, cj) % 12;
        return {
          x: cx,
          y: cy,
          gx: GRAD_X[g],
          gy: GRAD_Y[g],
          dot: GRAD_X[g] * (x - cx) + GRAD_Y[g] * (y - cy),
          contribution: SIMPLEX_SCALE * bump(ci, cj, x - cx, y - cy),
        };
      });
    }
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const u = fade(x - x0, fadeKind);
    const v = fade(y - y0, fadeKind);
    const out: Corner[] = [];
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= 1; i++) {
        const h = hash(x0 + i, y0 + j);
        const weight = (i ? u : 1 - u) * (j ? v : 1 - v);
        if (kind === 'value') {
          const dot = (h / 255) * 2 - 1;
          out.push({ x: x0 + i, y: y0 + j, gx: 0, gy: 0, dot, contribution: dot * weight });
        } else {
          const dot = cos[h] * (x - x0 - i) + sin[h] * (y - y0 - j);
          out.push({
            x: x0 + i,
            y: y0 + j,
            gx: cos[h],
            gy: sin[h],
            dot,
            contribution: dot * weight * PERLIN_SCALE,
          });
        }
      }
    }
    return out;
  }

  return {
    perlin,
    simplex,
    value,
    gradient(ix, iy) {
      const h = hash(ix, iy);
      return [cos[h], sin[h]];
    },
    simplexGradient(i, j) {
      const g = hash(i, j) % 12;
      const length = Math.hypot(GRAD_X[g], GRAD_Y[g]);
      return [GRAD_X[g] / length, GRAD_Y[g] / length];
    },
    corners,
  };
}

/**
 * Fractal Brownian motion: octaves of the same noise, each `lacunarity` times
 * finer and `persistence` times weaker, divided by the total weight so the
 * result stays in [-1, 1].
 */
export function fbm(
  sample: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * sample(x * frequency, y * frequency);
    total += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total > 0 ? sum / total : 0;
}
