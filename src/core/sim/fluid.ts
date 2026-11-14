/**
 * Stable fluids after Jos Stam, on a staggered (MAC) grid of cols × rows cells
 * of side 1. Dye and pressure live at cell centres. The horizontal velocity u
 * lives on the vertical cell faces and the vertical velocity v on the
 * horizontal faces, so the flow out of a cell is just a difference of its four
 * face values, and the pressure solve can remove it exactly.
 *
 * The box is closed: the velocity through every wall face is zero.
 */
export interface Fluid {
  cols: number;
  rows: number;
  /** (cols + 1) × rows values; u[i + j (cols + 1)] is on the left face of cell (i, j). */
  u: Float32Array;
  /** cols × (rows + 1) values; v[i + j cols] is on the top face of cell (i, j). */
  v: Float32Array;
  /** Two dyes, so two streams can be told apart. */
  dyeA: Float32Array;
  dyeB: Float32Array;
  pressure: Float32Array;
  /** Divergence of each cell just before the last projection. */
  before: Float32Array;
  // Scratch buffers.
  u0: Float32Array;
  v0: Float32Array;
  s0: Float32Array;
}

export interface FluidParams {
  /** Diffusion rate of the velocity. */
  viscosity: number;
  /** Diffusion rate of the dye. */
  diffusion: number;
  /** Share of dye lost per second. */
  fade: number;
  /** Upward push per unit of dye. */
  buoyancy: number;
  /** Pressure solver passes. */
  iterations: number;
}

export function createFluid(cols: number, rows: number): Fluid {
  return {
    cols,
    rows,
    u: new Float32Array((cols + 1) * rows),
    v: new Float32Array(cols * (rows + 1)),
    dyeA: new Float32Array(cols * rows),
    dyeB: new Float32Array(cols * rows),
    pressure: new Float32Array(cols * rows),
    before: new Float32Array(cols * rows),
    u0: new Float32Array((cols + 1) * rows),
    v0: new Float32Array(cols * (rows + 1)),
    s0: new Float32Array(cols * rows),
  };
}

/** Bilinear sample of a w × h array at index-space position (fx, fy), clamped to the array. */
function sample(field: Float32Array, w: number, h: number, fx: number, fy: number): number {
  if (fx < 0) fx = 0;
  else if (fx > w - 1) fx = w - 1;
  if (fy < 0) fy = 0;
  else if (fy > h - 1) fy = h - 1;
  let i = fx | 0;
  let j = fy | 0;
  if (i > w - 2) i = Math.max(0, w - 2);
  if (j > h - 2) j = Math.max(0, h - 2);
  const tx = fx - i;
  const ty = fy - j;
  const i1 = Math.min(w - 1, i + 1);
  const j1 = Math.min(h - 1, j + 1);
  const top = field[i + j * w] * (1 - tx) + field[i1 + j * w] * tx;
  const bottom = field[i + j1 * w] * (1 - tx) + field[i1 + j1 * w] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Velocity at a point in cell units. */
export function velocityAt(f: Fluid, x: number, y: number): { x: number; y: number } {
  return {
    x: sample(f.u, f.cols + 1, f.rows, x, y - 0.5),
    y: sample(f.v, f.cols, f.rows + 1, x - 0.5, y),
  };
}

/** Flow out of each cell: (u_right - u_left) + (v_bottom - v_top). Returns the mean absolute value. */
export function divergence(f: Fluid, out: Float32Array): number {
  const { cols, rows, u, v } = f;
  let total = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const d =
        u[i + 1 + j * (cols + 1)] - u[i + j * (cols + 1)] + v[i + (j + 1) * cols] - v[i + j * cols];
      out[i + j * cols] = d;
      total += Math.abs(d);
    }
  }
  return total / (cols * rows);
}

function closeWalls(f: Fluid) {
  const { cols, rows, u, v } = f;
  for (let j = 0; j < rows; j++) {
    u[j * (cols + 1)] = 0;
    u[cols + j * (cols + 1)] = 0;
  }
  for (let i = 0; i < cols; i++) {
    v[i] = 0;
    v[i + rows * cols] = 0;
  }
}

/**
 * Makes the velocity divergence-free. Solves the Poisson equation
 * ∇²p = ∇·u by Gauss-Seidel passes (each cell is set to the average its
 * neighbours imply, using values already updated in this pass), then subtracts
 * the pressure gradient from the face velocities. `relaxation` above 1
 * over-shoots each update, which converges faster. The previous pressure is
 * the starting guess. Returns the mean absolute divergence left.
 */
export function project(f: Fluid, iterations: number, relaxation = 1): number {
  const { cols, rows, u, v, pressure: p, before } = f;
  closeWalls(f);
  const untouched = divergence(f, before);
  if (iterations <= 0) {
    // No solve at all: drop the old pressure too, or its gradient would keep pushing.
    p.fill(0);
    return untouched;
  }
  for (let pass = 0; pass < iterations; pass++) {
    for (let j = 0; j < rows; j++) {
      const edgeRow = j === 0 || j === rows - 1;
      for (let i = 0; i < cols; i++) {
        const k = i + j * cols;
        if (!edgeRow && i > 0 && i < cols - 1) {
          // Interior cell: four neighbours.
          const target = (p[k - 1] + p[k + 1] + p[k - cols] + p[k + cols] - before[k]) * 0.25;
          p[k] += relaxation * (target - p[k]);
          continue;
        }
        // A cell on a wall has no neighbour beyond it: no flow through the wall.
        let sum = 0;
        let count = 0;
        if (i > 0) {
          sum += p[k - 1];
          count++;
        }
        if (i < cols - 1) {
          sum += p[k + 1];
          count++;
        }
        if (j > 0) {
          sum += p[k - cols];
          count++;
        }
        if (j < rows - 1) {
          sum += p[k + cols];
          count++;
        }
        if (count === 0) continue;
        p[k] += relaxation * ((sum - before[k]) / count - p[k]);
      }
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 1; i < cols; i++) {
      u[i + j * (cols + 1)] -= p[i + j * cols] - p[i - 1 + j * cols];
    }
  }
  for (let j = 1; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      v[i + j * cols] -= p[i + j * cols] - p[i + (j - 1) * cols];
    }
  }
  return divergence(f, f.s0);
}

/**
 * Implicit diffusion of a w × h array: solves (1 + 4a) x = x0 + a (sum of the
 * four neighbours) by Gauss-Seidel. Implicit means any rate is stable.
 */
function diffuse(x: Float32Array, x0: Float32Array, w: number, h: number, a: number) {
  if (a <= 0) return;
  x0.set(x);
  for (let pass = 0; pass < 6; pass++) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = i + j * w;
        const left = i > 0 ? x[k - 1] : x[k];
        const right = i < w - 1 ? x[k + 1] : x[k];
        const up = j > 0 ? x[k - w] : x[k];
        const down = j < h - 1 ? x[k + w] : x[k];
        x[k] = (x0[k] + a * (left + right + up + down)) / (1 + 4 * a);
      }
    }
  }
}

/**
 * Semi-Lagrangian advection of the velocity: each face asks where the fluid
 * now at the face was one step ago, and takes the velocity found there. It
 * cannot blow up, since every new value is an average of old ones.
 */
function advectVelocity(f: Fluid, dt: number) {
  const { cols, rows, u, v, u0, v0 } = f;
  u0.set(u);
  v0.set(v);
  for (let j = 0; j < rows; j++) {
    for (let i = 1; i < cols; i++) {
      const x = i;
      const y = j + 0.5;
      const ux = u0[i + j * (cols + 1)];
      const vy = sample(v0, cols, rows + 1, x - 0.5, y);
      u[i + j * (cols + 1)] = sample(u0, cols + 1, rows, x - dt * ux, y - dt * vy - 0.5);
    }
  }
  for (let j = 1; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = i + 0.5;
      const y = j;
      const ux = sample(u0, cols + 1, rows, x, y - 0.5);
      const vy = v0[i + j * cols];
      v[i + j * cols] = sample(v0, cols, rows + 1, x - dt * ux - 0.5, y - dt * vy);
    }
  }
}

function advectDye(f: Fluid, dye: Float32Array, dt: number, keep: number) {
  const { cols, rows, u, v, s0 } = f;
  s0.set(dye);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const ux = (u[i + j * (cols + 1)] + u[i + 1 + j * (cols + 1)]) / 2;
      const vy = (v[i + j * cols] + v[i + (j + 1) * cols]) / 2;
      dye[i + j * cols] = keep * sample(s0, cols, rows, i - dt * ux, j - dt * vy);
    }
  }
}

/**
 * Adds dye and momentum in a soft blob round (cx, cy), in cell units.
 * `du`, `dv` are added to the velocity; `a` and `b` to the two dyes.
 */
export function splat(
  f: Fluid,
  cx: number,
  cy: number,
  radius: number,
  du: number,
  dv: number,
  a: number,
  b: number,
) {
  const { cols, rows } = f;
  const i0 = Math.max(0, Math.floor(cx - radius));
  const i1 = Math.min(cols - 1, Math.ceil(cx + radius));
  const j0 = Math.max(0, Math.floor(cy - radius));
  const j1 = Math.min(rows - 1, Math.ceil(cy + radius));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const d2 = ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2) / (radius * radius);
      if (d2 >= 1) continue;
      const w = (1 - d2) * (1 - d2);
      const k = i + j * cols;
      f.dyeA[k] = Math.min(1.5, f.dyeA[k] + a * w);
      f.dyeB[k] = Math.min(1.5, f.dyeB[k] + b * w);
      // Half to each of the cell's two faces in each direction.
      f.u[i + j * (cols + 1)] += du * w * 0.5;
      f.u[i + 1 + j * (cols + 1)] += du * w * 0.5;
      f.v[i + j * cols] += dv * w * 0.5;
      f.v[i + (j + 1) * cols] += dv * w * 0.5;
    }
  }
}

/**
 * One time step: move the velocity along itself, add buoyancy, diffuse it,
 * project out the divergence, then carry the dye along. Returns the mean
 * absolute divergence before and after the projection.
 */
export function stepFluid(
  f: Fluid,
  p: FluidParams,
  dt: number,
  relaxation = 1,
): { before: number; after: number } {
  const { cols, rows } = f;
  advectVelocity(f, dt);
  if (p.buoyancy !== 0) {
    for (let j = 1; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = i + j * cols;
        const dye = (f.dyeA[k] + f.dyeB[k] + f.dyeA[k - cols] + f.dyeB[k - cols]) / 2;
        f.v[k] -= p.buoyancy * dye * dt;
      }
    }
  }
  diffuse(f.u, f.u0, cols + 1, rows, p.viscosity * dt);
  diffuse(f.v, f.v0, cols, rows + 1, p.viscosity * dt);
  closeWalls(f);
  let before = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      before += Math.abs(
        f.u[i + 1 + j * (cols + 1)] -
          f.u[i + j * (cols + 1)] +
          f.v[i + (j + 1) * cols] -
          f.v[i + j * cols],
      );
    }
  }
  before /= cols * rows;
  const after = project(f, p.iterations, relaxation);

  const keep = Math.max(0, 1 - p.fade * dt);
  diffuse(f.dyeA, f.s0, cols, rows, p.diffusion * dt);
  diffuse(f.dyeB, f.s0, cols, rows, p.diffusion * dt);
  advectDye(f, f.dyeA, dt, keep);
  advectDye(f, f.dyeB, dt, keep);
  return { before, after };
}
