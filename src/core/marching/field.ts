import type { Grid } from './squares';

export interface Ball {
  x: number;
  y: number;
  radius: number;
  /** Velocity in units per second. */
  vx: number;
  vy: number;
}

/** Keeps the field finite at a ball's exact centre. */
const FIELD_MAX = 1e6;

/**
 * The metaball field: f(x, y) = sum of r_i^2 / d_i^2, where d_i is the distance
 * to ball i. A lone ball has f = 1 exactly on its circle, so the contour f = 1
 * is the ball itself; nearby balls add up and the contour bulges and merges.
 */
export function fieldAt(balls: readonly Ball[], x: number, y: number): number {
  let sum = 0;
  for (const b of balls) {
    const dx = x - b.x;
    const dy = y - b.y;
    sum += (b.radius * b.radius) / (dx * dx + dy * dy);
  }
  return Math.min(sum, FIELD_MAX);
}

/** Samples the field at every grid corner. Cells are `cellSize` wide, starting at the origin. */
export function sampleField(
  balls: readonly Ball[],
  cols: number,
  rows: number,
  cellSize: number,
): Grid {
  const values = new Float32Array((cols + 1) * (rows + 1));
  let i = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      values[i++] = fieldAt(balls, c * cellSize, r * cellSize);
    }
  }
  return { cols, rows, values };
}

/** Moves the balls by dt seconds, bouncing them off the walls of a width x height box. */
export function stepBalls(balls: Ball[], dt: number, width: number, height: number): void {
  for (const b of balls) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const maxX = Math.max(b.radius, width - b.radius);
    const maxY = Math.max(b.radius, height - b.radius);
    if (b.x < b.radius) {
      b.x = b.radius;
      b.vx = Math.abs(b.vx);
    } else if (b.x > maxX) {
      b.x = maxX;
      b.vx = -Math.abs(b.vx);
    }
    if (b.y < b.radius) {
      b.y = b.radius;
      b.vy = Math.abs(b.vy);
    } else if (b.y > maxY) {
      b.y = maxY;
      b.vy = -Math.abs(b.vy);
    }
  }
}

/** Creates `count` balls with random size, position and direction. `random` returns [0, 1). */
export function createBalls(
  count: number,
  width: number,
  height: number,
  random: () => number,
): Ball[] {
  const scale = Math.min(width, height);
  return Array.from({ length: count }, () => {
    const radius = scale * (0.07 + 0.06 * random());
    const angle = random() * 2 * Math.PI;
    const speed = scale * (0.1 + 0.15 * random());
    return {
      radius,
      x: radius + random() * Math.max(0, width - 2 * radius),
      y: radius + random() * Math.max(0, height - 2 * radius),
      vx: speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
    };
  });
}
