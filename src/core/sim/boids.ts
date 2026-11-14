import type { Random } from '../random';
import { buildGrid, wrapDelta, type SpatialGrid } from './grid';

/** A flock on a torus: what leaves one edge comes back at the opposite one. */
export interface Flock {
  n: number;
  width: number;
  height: number;
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  ax: Float64Array;
  ay: Float64Array;
}

export interface BoidParams {
  separation: number;
  alignment: number;
  cohesion: number;
  /** Perception radius. */
  radius: number;
  /** Full field of view in radians; 2π sees all round. */
  fov: number;
  maxSpeed: number;
  maxForce: number;
  /** Test every other boid instead of using the grid. */
  brute: boolean;
  /** 0 off, 1 attract, -1 repel (predator). */
  pointerMode: number;
  pointerX: number;
  pointerY: number;
  /** Circles as x, y, radius triples. */
  obstacles: readonly number[];
}

/** Neighbours closer than this share of the perception radius push apart. */
export const SEPARATION_SHARE = 0.45;
const POINTER_REACH = 170;
const OBSTACLE_MARGIN = 34;

export function createFlock(n: number, width: number, height: number, random: Random): Flock {
  const flock: Flock = {
    n,
    width,
    height,
    x: new Float64Array(n),
    y: new Float64Array(n),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
    ax: new Float64Array(n),
    ay: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    flock.x[i] = random() * width;
    flock.y[i] = random() * height;
    const angle = random() * Math.PI * 2;
    const speed = 40 + random() * 60;
    flock.vx[i] = Math.cos(angle) * speed;
    flock.vy[i] = Math.sin(angle) * speed;
  }
  return flock;
}

// Sums for the boid being worked on. Module-level so both lookups share one inner test.
let sepX = 0;
let sepY = 0;
let aliX = 0;
let aliY = 0;
let cohX = 0;
let cohY = 0;
let seen = 0;

/** True when boid j is inside boid i's radius and field of view; adds it to the sums. */
function consider(f: Flock, i: number, j: number, r2: number, sep2: number, cosHalf: number) {
  const dx = wrapDelta(f.x[j] - f.x[i], f.width);
  const dy = wrapDelta(f.y[j] - f.y[i], f.height);
  const d2 = dx * dx + dy * dy;
  if (d2 > r2 || d2 === 0) return false;
  if (cosHalf > -1) {
    // Angle between the heading and the direction to j, without a square root for the heading.
    const dot = f.vx[i] * dx + f.vy[i] * dy;
    const speed2 = f.vx[i] * f.vx[i] + f.vy[i] * f.vy[i];
    const limit = cosHalf * Math.sqrt(speed2 * d2);
    if (dot < limit) return false;
  }
  seen++;
  aliX += f.vx[j];
  aliY += f.vy[j];
  cohX += dx;
  cohY += dy;
  if (d2 < sep2) {
    sepX -= dx / d2;
    sepY -= dy / d2;
  }
  return true;
}

/** Calls `visit` semantics inline: runs `consider` on every candidate for boid i. Returns the tests made. */
function scan(
  f: Flock,
  p: BoidParams,
  grid: SpatialGrid,
  i: number,
  found: number[] | undefined,
): number {
  const r2 = p.radius * p.radius;
  const sep2 = r2 * SEPARATION_SHARE * SEPARATION_SHARE;
  const cosHalf = p.fov >= Math.PI * 2 - 1e-6 ? -1 : Math.cos(p.fov / 2);
  sepX = sepY = aliX = aliY = cohX = cohY = 0;
  seen = 0;
  let tests = 0;
  if (p.brute) {
    for (let j = 0; j < f.n; j++) {
      if (j === i) continue;
      tests++;
      if (consider(f, i, j, r2, sep2, cosHalf)) found?.push(j);
    }
    return tests;
  }
  const { cols, rows, start, items } = grid;
  let c0 = Math.floor((f.x[i] - p.radius) / grid.cellWidth);
  let c1 = Math.floor((f.x[i] + p.radius) / grid.cellWidth);
  let r0 = Math.floor((f.y[i] - p.radius) / grid.cellHeight);
  let r1 = Math.floor((f.y[i] + p.radius) / grid.cellHeight);
  if (c1 - c0 + 1 >= cols) {
    c0 = 0;
    c1 = cols - 1;
  }
  if (r1 - r0 + 1 >= rows) {
    r0 = 0;
    r1 = rows - 1;
  }
  for (let rr = r0; rr <= r1; rr++) {
    const row = ((rr % rows) + rows) % rows;
    for (let cc = c0; cc <= c1; cc++) {
      const cell = row * cols + (((cc % cols) + cols) % cols);
      for (let k = start[cell]; k < start[cell + 1]; k++) {
        const j = items[k];
        if (j === i) continue;
        tests++;
        if (consider(f, i, j, r2, sep2, cosHalf)) found?.push(j);
      }
    }
  }
  return tests;
}

/** The boids that boid i can see, by whichever lookup the parameters select. The grid must be built. */
export function visibleNeighbours(f: Flock, p: BoidParams, grid: SpatialGrid, i: number): number[] {
  const found: number[] = [];
  scan(f, p, grid, i, found);
  return found;
}

/** Adds to the acceleration a pull towards the given direction at full speed, capped at maxForce times weight. */
function steer(f: Flock, i: number, dx: number, dy: number, p: BoidParams, weight: number) {
  const length = Math.hypot(dx, dy);
  if (length < 1e-12 || weight === 0) return;
  let sx = (dx / length) * p.maxSpeed - f.vx[i];
  let sy = (dy / length) * p.maxSpeed - f.vy[i];
  const s = Math.hypot(sx, sy);
  if (s > p.maxForce) {
    sx *= p.maxForce / s;
    sy *= p.maxForce / s;
  }
  f.ax[i] += sx * weight;
  f.ay[i] += sy * weight;
}

/**
 * One time step. Every boid steers by three rules applied to the neighbours it
 * can see, then all move together. Returns the number of distance tests made.
 */
export function stepFlock(f: Flock, p: BoidParams, grid: SpatialGrid, dt: number): number {
  if (!p.brute) buildGrid(grid, f.x, f.y, f.n);
  let tests = 0;
  for (let i = 0; i < f.n; i++) {
    tests += scan(f, p, grid, i, undefined);
    f.ax[i] = 0;
    f.ay[i] = 0;
    if (seen > 0) {
      steer(f, i, sepX, sepY, p, p.separation);
      steer(f, i, aliX, aliY, p, p.alignment);
      steer(f, i, cohX, cohY, p, p.cohesion);
    }
    if (p.pointerMode !== 0) {
      const dx = wrapDelta(p.pointerX - f.x[i], f.width);
      const dy = wrapDelta(p.pointerY - f.y[i], f.height);
      const d = Math.hypot(dx, dy);
      if (d < POINTER_REACH && d > 1e-9) {
        const push = p.pointerMode < 0 ? -4 * (1 - d / POINTER_REACH) : 1.5;
        f.ax[i] += (dx / d) * p.maxForce * push;
        f.ay[i] += (dy / d) * p.maxForce * push;
      }
    }
    for (let k = 0; k < p.obstacles.length; k += 3) {
      const dx = f.x[i] - p.obstacles[k];
      const dy = f.y[i] - p.obstacles[k + 1];
      const d = Math.hypot(dx, dy);
      const gap = d - p.obstacles[k + 2];
      if (gap < OBSTACLE_MARGIN && d > 1e-9) {
        const push = 6 * p.maxForce * (1 - Math.max(0, gap) / OBSTACLE_MARGIN);
        f.ax[i] += (dx / d) * push;
        f.ay[i] += (dy / d) * push;
      }
    }
  }

  const minSpeed = p.maxSpeed * 0.35;
  for (let i = 0; i < f.n; i++) {
    let vx = f.vx[i] + f.ax[i] * dt;
    let vy = f.vy[i] + f.ay[i] * dt;
    const speed = Math.hypot(vx, vy);
    if (speed > p.maxSpeed) {
      vx *= p.maxSpeed / speed;
      vy *= p.maxSpeed / speed;
    } else if (speed < minSpeed && speed > 1e-9) {
      vx *= minSpeed / speed;
      vy *= minSpeed / speed;
    }
    let x = f.x[i] + vx * dt;
    let y = f.y[i] + vy * dt;
    // Nothing may end a step inside an obstacle.
    for (let k = 0; k < p.obstacles.length; k += 3) {
      const dx = x - p.obstacles[k];
      const dy = y - p.obstacles[k + 1];
      const d = Math.hypot(dx, dy);
      const r = p.obstacles[k + 2];
      if (d < r && d > 1e-9) {
        x = p.obstacles[k] + (dx / d) * r;
        y = p.obstacles[k + 1] + (dy / d) * r;
      }
    }
    f.vx[i] = vx;
    f.vy[i] = vy;
    f.x[i] = ((x % f.width) + f.width) % f.width;
    f.y[i] = ((y % f.height) + f.height) % f.height;
  }
  return tests;
}

/** The number of distance tests a step would make from the current state, without moving anything. */
export function countTests(f: Flock, p: BoidParams, grid: SpatialGrid): number {
  if (!p.brute) buildGrid(grid, f.x, f.y, f.n);
  let tests = 0;
  for (let i = 0; i < f.n; i++) tests += scan(f, p, grid, i, undefined);
  return tests;
}
