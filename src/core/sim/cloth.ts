/**
 * Particles joined by distance constraints, moved by position Verlet. There is
 * no stored velocity: it is implied by the current and the previous position.
 *
 *   x' = 2x - x_prev + a dt²
 *
 * After the move, each constraint in turn nudges its two ends back to its rest
 * length. One pass does not satisfy them all, as fixing one stretches its
 * neighbours; repeating the pass converges, and more passes make stiffer cloth.
 */
export interface Cloth {
  n: number;
  x: Float64Array;
  y: Float64Array;
  px: Float64Array;
  py: Float64Array;
  pinned: Uint8Array;
  /** Constraint c joins particles a[c] and b[c] at distance rest[c] while alive[c] is 1. */
  constraints: number;
  a: Int32Array;
  b: Int32Array;
  rest: Float64Array;
  alive: Uint8Array;
  /** Stretch of each constraint after the last solve: length / rest. */
  strain: Float32Array;
  width: number;
  height: number;
  /** Seconds simulated, for the wind gusts. */
  time: number;
}

export interface ClothParams {
  gravity: number;
  wind: number;
  /** Relaxation passes per step. */
  iterations: number;
  /** Share of the implied velocity lost per step. */
  damping: number;
  tear: boolean;
  /** A constraint stretched past this many rest lengths breaks. */
  tearAt: number;
}

export type ClothPreset = 'cloth' | 'rope' | 'soft-body';

function allocate(n: number, constraints: number, width: number, height: number): Cloth {
  return {
    n,
    x: new Float64Array(n),
    y: new Float64Array(n),
    px: new Float64Array(n),
    py: new Float64Array(n),
    pinned: new Uint8Array(n),
    constraints: 0,
    a: new Int32Array(constraints),
    b: new Int32Array(constraints),
    rest: new Float64Array(constraints),
    alive: new Uint8Array(constraints),
    strain: new Float32Array(constraints).fill(1),
    width,
    height,
    time: 0,
  };
}

function link(c: Cloth, a: number, b: number) {
  const k = c.constraints++;
  c.a[k] = a;
  c.b[k] = b;
  c.rest[k] = Math.hypot(c.x[b] - c.x[a], c.y[b] - c.y[a]);
  c.alive[k] = 1;
}

/**
 * A cols × rows lattice starting at (left, top) with the given spacing.
 * `diagonals` adds the two cross links per square, which resist shear.
 */
function lattice(
  cols: number,
  rows: number,
  left: number,
  top: number,
  spacing: number,
  diagonals: boolean,
  width: number,
  height: number,
): Cloth {
  const squares = (cols - 1) * (rows - 1);
  const c = allocate(
    cols * rows,
    (cols - 1) * rows + cols * (rows - 1) + (diagonals ? 2 * squares : 0),
    width,
    height,
  );
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const i = r * cols + col;
      c.x[i] = c.px[i] = left + col * spacing;
      c.y[i] = c.py[i] = top + r * spacing;
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const i = r * cols + col;
      if (col + 1 < cols) link(c, i, i + 1);
      if (r + 1 < rows) link(c, i, i + cols);
      if (diagonals && col + 1 < cols && r + 1 < rows) {
        link(c, i, i + cols + 1);
        link(c, i + 1, i + cols);
      }
    }
  }
  return c;
}

/** Builds a starting shape in a width × height area (y down). `cols` sets the resolution. */
export function createCloth(
  preset: ClothPreset,
  cols: number,
  width: number,
  height: number,
): Cloth {
  if (preset === 'rope') {
    const links = Math.max(2, cols);
    const spacing = (height * 0.72) / (links - 1);
    // Laid out sideways from the pin, so it swings down when released.
    const c = lattice(links, 1, width * 0.42, height * 0.12, spacing, false, width, height);
    c.pinned[0] = 1;
    return c;
  }
  if (preset === 'soft-body') {
    const side = Math.max(3, Math.min(cols, 16));
    const spacing = (height * 0.36) / (side - 1);
    const c = lattice(side, side, width * 0.34, height * 0.08, spacing, true, width, height);
    // Thrown sideways with some spin, so it lands on a corner, squashes and tumbles.
    const middle = (side * side - 1) / 2;
    for (let i = 0; i < c.n; i++) {
      c.px[i] = c.x[i] - spacing * 0.1 + 0.035 * (c.y[i] - c.y[Math.floor(middle)]);
      c.py[i] = c.y[i] - 0.035 * (c.x[i] - c.x[Math.floor(middle)]);
    }
    return c;
  }
  const rows = Math.max(2, Math.round(cols * 0.62));
  const spacing = Math.min((width * 0.78) / (cols - 1), (height * 0.7) / (rows - 1));
  const left = (width - spacing * (cols - 1)) / 2;
  const c = lattice(cols, rows, left, height * 0.08, spacing, false, width, height);
  // Pin every fourth particle of the top row, and both corners.
  for (let col = 0; col < cols; col++) {
    if (col % 4 === 0 || col === cols - 1) c.pinned[col] = 1;
  }
  return c;
}

/** One relaxation pass over all constraints. Returns the largest strain seen. */
export function relax(c: Cloth, tear: boolean, tearAt: number): number {
  let worst = 1;
  for (let k = 0; k < c.constraints; k++) {
    if (!c.alive[k]) continue;
    const a = c.a[k];
    const b = c.b[k];
    const dx = c.x[b] - c.x[a];
    const dy = c.y[b] - c.y[a];
    const length = Math.hypot(dx, dy);
    const strain = length / c.rest[k];
    c.strain[k] = strain;
    if (strain > worst) worst = strain;
    if (tear && strain > tearAt) {
      c.alive[k] = 0;
      continue;
    }
    if (length < 1e-12) continue;
    // Each end takes half the correction; a pinned end takes none and the free end all of it.
    const wa = c.pinned[a] ? 0 : 1;
    const wb = c.pinned[b] ? 0 : 1;
    if (wa + wb === 0) continue;
    const correction = (length - c.rest[k]) / length / (wa + wb);
    c.x[a] += dx * correction * wa;
    c.y[a] += dy * correction * wa;
    c.x[b] -= dx * correction * wb;
    c.y[b] -= dy * correction * wb;
  }
  return worst;
}

/** Keeps free particles inside the area. The floor also rubs away sideways motion. */
function contain(c: Cloth) {
  for (let i = 0; i < c.n; i++) {
    if (c.pinned[i]) continue;
    if (c.x[i] < 0) c.x[i] = 0;
    else if (c.x[i] > c.width) c.x[i] = c.width;
    if (c.y[i] > c.height) {
      c.y[i] = c.height;
      c.px[i] += (c.x[i] - c.px[i]) * 0.3;
    } else if (c.y[i] < 0) c.y[i] = 0;
  }
}

/**
 * One time step. `grab` holds a particle at a point through the solve, which
 * is how the pointer drags the cloth. Returns the largest strain left.
 */
export function stepCloth(
  c: Cloth,
  p: ClothParams,
  dt: number,
  grab?: { index: number; x: number; y: number },
): number {
  c.time += dt;
  const keep = 1 - p.damping;
  const dt2 = dt * dt;
  for (let i = 0; i < c.n; i++) {
    if (c.pinned[i]) continue;
    // Wind blows in gusts that travel across the cloth.
    const gust = 0.55 + 0.45 * Math.sin(c.time * 1.7 + c.y[i] * 0.012 + c.x[i] * 0.004);
    const ax = p.wind * gust;
    const nx = c.x[i] + (c.x[i] - c.px[i]) * keep + ax * dt2;
    const ny = c.y[i] + (c.y[i] - c.py[i]) * keep + p.gravity * dt2;
    c.px[i] = c.x[i];
    c.py[i] = c.y[i];
    c.x[i] = nx;
    c.y[i] = ny;
  }
  let worst = 1;
  for (let pass = 0; pass < p.iterations; pass++) {
    if (grab && grab.index < c.n) {
      c.x[grab.index] = grab.x;
      c.y[grab.index] = grab.y;
    }
    worst = relax(c, p.tear, p.tearAt);
    contain(c);
  }
  if (grab && grab.index < c.n) {
    c.x[grab.index] = c.px[grab.index] = grab.x;
    c.y[grab.index] = c.py[grab.index] = grab.y;
  }
  return worst;
}

/** Removes every constraint crossed by the segment from (x0, y0) to (x1, y1). Returns how many. */
export function cutCloth(c: Cloth, x0: number, y0: number, x1: number, y1: number): number {
  let cut = 0;
  const side = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
    (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  for (let k = 0; k < c.constraints; k++) {
    if (!c.alive[k]) continue;
    const ax = c.x[c.a[k]];
    const ay = c.y[c.a[k]];
    const bx = c.x[c.b[k]];
    const by = c.y[c.b[k]];
    const d1 = side(x0, y0, x1, y1, ax, ay);
    const d2 = side(x0, y0, x1, y1, bx, by);
    const d3 = side(ax, ay, bx, by, x0, y0);
    const d4 = side(ax, ay, bx, by, x1, y1);
    if (d1 * d2 < 0 && d3 * d4 < 0) {
      c.alive[k] = 0;
      cut++;
    }
  }
  return cut;
}

/** The particle nearest to a point, or -1 if none is within `reach`. */
export function nearestParticle(c: Cloth, x: number, y: number, reach: number): number {
  let best = -1;
  let bestD = reach * reach;
  for (let i = 0; i < c.n; i++) {
    const d = (c.x[i] - x) ** 2 + (c.y[i] - y) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
