import type { Point } from '../point';

/**
 * Newton's method in the complex plane. The polynomial is given by its roots,
 * p(z) = (z - r1)(z - r2)...; then p'(z) / p(z) is the sum of 1 / (z - ri), so a
 * step needs no coefficients.
 */

/** Result for a start point that never came close to a root. */
export const NO_ROOT = 0xffff;
/** A start counts as converged when it is this close to a root. */
export const TOLERANCE = 1e-3;

/**
 * All complex roots of a polynomial with real coefficients (highest power
 * first), by the Durand-Kerner iteration.
 */
export function polyRoots(coefficients: readonly number[]): Point[] {
  const lead = coefficients[0];
  const c = coefficients.map((v) => v / lead);
  const degree = c.length - 1;
  // Start from points on a spiral: not symmetric, so the iteration cannot stall.
  const roots: Point[] = Array.from({ length: degree }, (_, k) => ({
    x: Math.cos(0.4 + 2.1 * k) * (0.6 + 0.3 * k),
    y: Math.sin(0.4 + 2.1 * k) * (0.6 + 0.3 * k),
  }));
  for (let pass = 0; pass < 400; pass++) {
    let moved = 0;
    for (let i = 0; i < degree; i++) {
      const z = roots[i];
      // Horner evaluation of p(z).
      let px = 1;
      let py = 0;
      for (let k = 1; k <= degree; k++) {
        const nx = px * z.x - py * z.y + c[k];
        py = px * z.y + py * z.x;
        px = nx;
      }
      // Product of (z - other roots).
      let qx = 1;
      let qy = 0;
      for (let j = 0; j < degree; j++) {
        if (j === i) continue;
        const dx = z.x - roots[j].x;
        const dy = z.y - roots[j].y;
        const nx = qx * dx - qy * dy;
        qy = qx * dy + qy * dx;
        qx = nx;
      }
      const d = qx * qx + qy * qy || 1e-300;
      const sx = (px * qx + py * qy) / d;
      const sy = (py * qx - px * qy) / d;
      roots[i] = { x: z.x - sx, y: z.y - sy };
      moved = Math.max(moved, Math.abs(sx), Math.abs(sy));
    }
    if (moved < 1e-14) break;
  }
  return roots;
}

/**
 * Runs z <- z - relax * p(z) / p'(z) from (x, y). Returns root * 256 + steps
 * when z comes within TOLERANCE of a root (steps <= maxIter <= 255), else NO_ROOT.
 */
export function newtonBasin(
  x: number,
  y: number,
  roots: readonly Point[],
  relax: number,
  maxIter: number,
): number {
  const tol = TOLERANCE * TOLERANCE;
  const count = roots.length;
  for (let n = 0; n <= maxIter; n++) {
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < count; i++) {
      const dx = x - roots[i].x;
      const dy = y - roots[i].y;
      const d = dx * dx + dy * dy;
      if (d < tol) return i * 256 + n;
      sx += dx / d;
      sy -= dy / d;
    }
    // p / p' = 1 / s.
    const m = sx * sx + sy * sy;
    if (m === 0) return NO_ROOT; // a critical point: the tangent is flat
    x -= (relax * sx) / m;
    y += (relax * sy) / m;
  }
  return NO_ROOT;
}

export interface NewtonView {
  width: number;
  height: number;
  centreX: number;
  centreY: number;
  /** Width of one pixel in the plane. */
  pixel: number;
}

/** Fills rows y0..y1-1 of `out` (width * height) with newtonBasin results. The imaginary axis points up. */
export function renderNewtonRows(
  view: NewtonView,
  roots: readonly Point[],
  relax: number,
  maxIter: number,
  y0: number,
  y1: number,
  out: Uint16Array,
): void {
  const { width, height, centreX, centreY, pixel } = view;
  for (let py = y0; py < y1; py++) {
    const y = centreY - (py + 0.5 - height / 2) * pixel;
    let i = py * width;
    for (let px = 0; px < width; px++) {
      out[i++] = newtonBasin(centreX + (px + 0.5 - width / 2) * pixel, y, roots, relax, maxIter);
    }
  }
}

/** The successive points of the iteration from (x, y), stopping at a root or after `maxIter` steps. */
export function newtonPath(
  x: number,
  y: number,
  roots: readonly Point[],
  relax: number,
  maxIter: number,
): Point[] {
  const path: Point[] = [{ x, y }];
  for (let n = 0; n < maxIter; n++) {
    if (newtonBasin(x, y, roots, relax, 0) !== NO_ROOT) break;
    let sx = 0;
    let sy = 0;
    for (const r of roots) {
      const dx = x - r.x;
      const dy = y - r.y;
      const d = dx * dx + dy * dy;
      sx += dx / d;
      sy -= dy / d;
    }
    const m = sx * sx + sy * sy;
    if (m === 0 || !Number.isFinite(m)) break;
    x -= (relax * sx) / m;
    y += (relax * sy) / m;
    path.push({ x, y });
  }
  return path;
}
