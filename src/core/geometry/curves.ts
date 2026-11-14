import type { Point } from '../point';

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/**
 * De Casteljau's construction. levels[0] is the control polygon; each later
 * level interpolates neighbouring points of the one before at t. The last
 * level is the single point on the curve.
 */
export function deCasteljau(control: readonly Point[], t: number): Point[][] {
  const levels: Point[][] = [[...control]];
  while (levels[levels.length - 1].length > 1) {
    const previous = levels[levels.length - 1];
    levels.push(previous.slice(1).map((p, i) => lerp(previous[i], p, t)));
  }
  return levels;
}

/** The same point from the Bernstein polynomial: sum of C(n, i) t^i (1 - t)^(n - i) P_i. */
export function bernstein(control: readonly Point[], t: number): Point {
  const n = control.length - 1;
  let x = 0;
  let y = 0;
  let binomial = 1;
  for (let i = 0; i <= n; i++) {
    const weight = binomial * t ** i * (1 - t) ** (n - i);
    x += weight * control[i].x;
    y += weight * control[i].y;
    binomial = (binomial * (n - i)) / (i + 1);
  }
  return { x, y };
}

/**
 * Knots for `count` control points of the given degree: count + degree + 1
 * values. Uniform knots are 0, 1, 2, ...; clamped knots repeat the first and
 * last value degree + 1 times so the curve reaches the end control points.
 */
export function knotVector(count: number, degree: number, clamped: boolean): number[] {
  const total = count + degree + 1;
  if (!clamped) return Array.from({ length: total }, (_, i) => i);
  const last = count - degree;
  return Array.from({ length: total }, (_, i) => Math.max(0, Math.min(last, i - degree)));
}

/** The parameter range on which the spline is defined. */
export function splineDomain(knots: readonly number[], count: number, degree: number) {
  return [knots[degree], knots[count]] as const;
}

export interface DeBoor {
  /** Knot span index k: knots[k] <= t < knots[k + 1]. Control points k - degree .. k are in play. */
  span: number;
  /** levels[0] are those control points; the last level is the point on the curve. */
  levels: Point[][];
}

/** De Boor's algorithm: the B-spline analogue of de Casteljau, on degree + 1 control points. */
export function deBoor(
  control: readonly Point[],
  degree: number,
  knots: readonly number[],
  t: number,
): DeBoor {
  let span = degree;
  while (span < control.length - 1 && t >= knots[span + 1]) span++;
  let level = control.slice(span - degree, span + 1);
  const levels = [level];
  for (let r = 1; r <= degree; r++) {
    const next: Point[] = [];
    for (let j = r; j <= degree; j++) {
      const lo = knots[span - degree + j];
      const hi = knots[span + 1 + j - r];
      const alpha = hi === lo ? 0 : (t - lo) / (hi - lo);
      next.push(lerp(level[j - r], level[j - r + 1], alpha));
    }
    level = next;
    levels.push(level);
  }
  return { span, levels };
}
