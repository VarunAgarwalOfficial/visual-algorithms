import type { Random } from '../random';
import { buildGrid, createGrid, type SpatialGrid } from './grid';

/** Discs in a box with walls at 0..width and 0..height; y points down. */
export interface Discs {
  n: number;
  width: number;
  height: number;
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  r: Float64Array;
  m: Float64Array;
  maxRadius: number;
}

export interface CollisionParams {
  gravity: number;
  /** 1 is perfectly elastic, 0 is perfectly inelastic. */
  restitution: number;
  /** Test every pair instead of using the grid. */
  brute: boolean;
}

export interface CollisionCounts {
  /** Pairs handed to the narrow phase. */
  candidates: number;
  /** Pairs that really overlapped. */
  contacts: number;
}

/**
 * Seeds `n` discs on a jittered lattice so none overlap. `spread` in 0..1 is
 * how much the radii differ; mass is proportional to area.
 */
export function createDiscs(
  n: number,
  width: number,
  height: number,
  radius: number,
  spread: number,
  speed: number,
  random: Random,
): Discs {
  const d: Discs = {
    n,
    width,
    height,
    x: new Float64Array(n),
    y: new Float64Array(n),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
    r: new Float64Array(n),
    m: new Float64Array(n),
    maxRadius: 0,
  };
  const cols = Math.max(1, Math.ceil(Math.sqrt((n * width) / height)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = width / cols;
  const cellH = height / rows;
  // No disc may be wider than its lattice cell, or the start would overlap.
  const fit = Math.min(cellW, cellH) * 0.48;
  for (let i = 0; i < n; i++) {
    // Three size classes when spread is on: small, medium, large.
    const size = 1 + spread * (Math.floor(random() * 3) - 1) * 0.6;
    const r = Math.min(fit, Math.max(0.5, radius * size));
    d.r[i] = r;
    d.m[i] = (r * r) / 100;
    d.maxRadius = Math.max(d.maxRadius, r);
    const slackX = cellW / 2 - r;
    const slackY = cellH / 2 - r;
    d.x[i] = ((i % cols) + 0.5) * cellW + (random() * 2 - 1) * slackX * 0.9;
    d.y[i] = (Math.floor(i / cols) + 0.5) * cellH + (random() * 2 - 1) * slackY * 0.9;
    const angle = random() * Math.PI * 2;
    d.vx[i] = Math.cos(angle) * speed;
    d.vy[i] = Math.sin(angle) * speed;
  }
  return d;
}

/** A grid whose cells are at least one largest diameter wide, so touching discs are in adjacent cells. */
export function gridFor(d: Discs): SpatialGrid {
  return createGrid(d.width, d.height, Math.max(1e-6, d.maxRadius * 2));
}

/**
 * Narrow phase for one pair. If the discs overlap they are pushed apart along
 * the line of centres (in proportion to inverse mass), and if they are also
 * approaching, an impulse along that line reverses the closing speed:
 *
 *   j = -(1 + e) (v_rel · n) / (1/m_a + 1/m_b)
 *
 * Returns true when the pair overlapped.
 */
export function collide(d: Discs, a: number, b: number, restitution: number): boolean {
  const dx = d.x[b] - d.x[a];
  const dy = d.y[b] - d.y[a];
  const reach = d.r[a] + d.r[b];
  const dist2 = dx * dx + dy * dy;
  if (dist2 >= reach * reach) return false;
  const dist = Math.sqrt(dist2);
  // Exactly coincident centres have no normal; pick one.
  const nx = dist > 1e-12 ? dx / dist : 1;
  const ny = dist > 1e-12 ? dy / dist : 0;
  const wa = 1 / d.m[a];
  const wb = 1 / d.m[b];
  const overlap = reach - dist;
  d.x[a] -= nx * overlap * (wa / (wa + wb));
  d.y[a] -= ny * overlap * (wa / (wa + wb));
  d.x[b] += nx * overlap * (wb / (wa + wb));
  d.y[b] += ny * overlap * (wb / (wa + wb));

  const closing = (d.vx[b] - d.vx[a]) * nx + (d.vy[b] - d.vy[a]) * ny;
  if (closing < 0) {
    const j = (-(1 + restitution) * closing) / (wa + wb);
    d.vx[a] -= j * wa * nx;
    d.vy[a] -= j * wa * ny;
    d.vx[b] += j * wb * nx;
    d.vy[b] += j * wb * ny;
  }
  return true;
}

function walls(d: Discs, restitution: number) {
  for (let i = 0; i < d.n; i++) {
    const r = d.r[i];
    if (d.x[i] < r) {
      d.x[i] = r;
      if (d.vx[i] < 0) d.vx[i] *= -restitution;
    } else if (d.x[i] > d.width - r) {
      d.x[i] = d.width - r;
      if (d.vx[i] > 0) d.vx[i] *= -restitution;
    }
    if (d.y[i] < r) {
      d.y[i] = r;
      if (d.vy[i] < 0) d.vy[i] *= -restitution;
    } else if (d.y[i] > d.height - r) {
      d.y[i] = d.height - r;
      if (d.vy[i] > 0) d.vy[i] *= -restitution;
    }
  }
}

/**
 * Broad phase: calls the narrow phase on every pair of discs that share a cell
 * or sit in adjacent cells. Each cell looks at itself and at four of its eight
 * neighbours, so every pair comes up exactly once.
 */
export function resolveWithGrid(
  d: Discs,
  grid: SpatialGrid,
  restitution: number,
  counts: CollisionCounts,
) {
  buildGrid(grid, d.x, d.y, d.n);
  const { cols, rows, start, items } = grid;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col;
      const end = start[cell + 1];
      for (let k = start[cell]; k < end; k++) {
        const a = items[k];
        for (let l = k + 1; l < end; l++) {
          counts.candidates++;
          if (collide(d, a, items[l], restitution)) counts.contacts++;
        }
        // Right, below-left, below, below-right.
        for (let q = 0; q < 4; q++) {
          const c2 = col + (q === 0 ? 1 : q - 2);
          const r2 = row + (q === 0 ? 0 : 1);
          if (c2 < 0 || c2 >= cols || r2 >= rows) continue;
          const other = r2 * cols + c2;
          for (let l = start[other]; l < start[other + 1]; l++) {
            counts.candidates++;
            if (collide(d, a, items[l], restitution)) counts.contacts++;
          }
        }
      }
    }
  }
}

export function resolveBrute(d: Discs, restitution: number, counts: CollisionCounts) {
  for (let a = 0; a < d.n; a++) {
    for (let b = a + 1; b < d.n; b++) {
      counts.candidates++;
      if (collide(d, a, b, restitution)) counts.contacts++;
    }
  }
}

/** One time step: move, then find and resolve the overlaps, then the walls. */
export function stepDiscs(
  d: Discs,
  p: CollisionParams,
  grid: SpatialGrid,
  dt: number,
  counts: CollisionCounts,
) {
  for (let i = 0; i < d.n; i++) {
    d.vy[i] += p.gravity * dt;
    d.x[i] += d.vx[i] * dt;
    d.y[i] += d.vy[i] * dt;
  }
  walls(d, p.restitution);
  if (p.brute) resolveBrute(d, p.restitution, counts);
  else resolveWithGrid(d, grid, p.restitution, counts);
  walls(d, p.restitution);
}

export function discKinetic(d: Discs): number {
  let sum = 0;
  for (let i = 0; i < d.n; i++) sum += 0.5 * d.m[i] * (d.vx[i] * d.vx[i] + d.vy[i] * d.vy[i]);
  return sum;
}

/** Height energy m g h, measured up from the floor. */
export function discPotential(d: Discs, gravity: number): number {
  let sum = 0;
  for (let i = 0; i < d.n; i++) sum += d.m[i] * gravity * (d.height - d.r[i] - d.y[i]);
  return sum;
}

export function discMomentum(d: Discs): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let i = 0; i < d.n; i++) {
    x += d.m[i] * d.vx[i];
    y += d.m[i] * d.vy[i];
  }
  return { x, y };
}
