/**
 * The Gray-Scott reaction-diffusion model. Two chemicals A and B diffuse over a
 * grid; the reaction A + 2B -> 3B turns A into B, A is fed in at rate `feed`
 * and B is removed at rate `feed + kill`.
 */

export interface GrayScott {
  width: number;
  height: number;
  a: Float32Array;
  b: Float32Array;
  /** Scratch buffers; `step` swaps them with a and b. */
  a2: Float32Array;
  b2: Float32Array;
}

export interface GrayScottParams {
  feed: number;
  kill: number;
  /** Diffusion rates. 1 and 0.5 are the usual choice: B spreads half as fast as A. */
  da: number;
  db: number;
}

/** A grid in the trivial steady state: A = 1 and B = 0 everywhere. */
export function createGrayScott(width: number, height: number): GrayScott {
  const n = width * height;
  return {
    width,
    height,
    a: new Float32Array(n).fill(1),
    b: new Float32Array(n),
    a2: new Float32Array(n),
    b2: new Float32Array(n),
  };
}

/**
 * One explicit Euler step with dt = 1 on a torus. The Laplacian uses the
 * nine-point stencil: 0.2 for edge neighbours, 0.05 for corners, -1 for the centre.
 */
export function stepGrayScott(grid: GrayScott, params: GrayScottParams): void {
  const { width, height, a, b, a2, b2 } = grid;
  const { feed, da, db } = params;
  const drain = params.feed + params.kill;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const up = (y === 0 ? height - 1 : y - 1) * width;
    const down = (y === height - 1 ? 0 : y + 1) * width;
    for (let x = 0; x < width; x++) {
      const l = x === 0 ? width - 1 : x - 1;
      const r = x === width - 1 ? 0 : x + 1;
      const i = row + x;
      const av = a[i];
      const bv = b[i];
      const lapA =
        0.2 * (a[row + l] + a[row + r] + a[up + x] + a[down + x]) +
        0.05 * (a[up + l] + a[up + r] + a[down + l] + a[down + r]) -
        av;
      const lapB =
        0.2 * (b[row + l] + b[row + r] + b[up + x] + b[down + x]) +
        0.05 * (b[up + l] + b[up + r] + b[down + l] + b[down + r]) -
        bv;
      const reaction = av * bv * bv;
      a2[i] = av + da * lapA - reaction + feed * (1 - av);
      b2[i] = bv + db * lapB + reaction - drain * bv;
    }
  }
  grid.a = a2;
  grid.b = b2;
  grid.a2 = a;
  grid.b2 = b;
}

/** Drops a disc of chemical B centred at (cx, cy), in cells. Wraps like the grid. */
export function paintB(grid: GrayScott, cx: number, cy: number, radius: number): void {
  const { width, height } = grid;
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x = (((Math.round(cx) + dx) % width) + width) % width;
      const y = (((Math.round(cy) + dy) % height) + height) % height;
      grid.b[y * width + x] = 1;
      grid.a[y * width + x] = 0.5;
    }
  }
}

/** Fraction of cells where B is clearly present. */
export function coverage(grid: GrayScott): number {
  let count = 0;
  for (let i = 0; i < grid.b.length; i++) if (grid.b[i] > 0.1) count++;
  return count / grid.b.length;
}
