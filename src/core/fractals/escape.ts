/**
 * Escape-time iteration for the Mandelbrot and Julia sets: repeat
 * z -> z^2 + c and count the steps until |z| leaves a large circle.
 */

/** Bail-out radius. Larger than the minimum of 2 so the smooth colouring has no visible seams. */
export const BAILOUT = 256;
const BAILOUT_SQUARED = BAILOUT * BAILOUT;
const LOG_BAILOUT = Math.log(BAILOUT);

/**
 * Iterates z -> z^2 + c from z = (zx, zy). Returns -1 if |z| stays within the
 * bail-out radius for `maxIter` steps. Otherwise returns a real number in
 * (n - 1, n], where n is the step at which z escaped: the fraction says how far
 * past the radius it landed, which removes the colour bands.
 */
export function escapeTime(
  zx: number,
  zy: number,
  cx: number,
  cy: number,
  maxIter: number,
): number {
  let x = zx;
  let y = zy;
  for (let n = 1; n <= maxIter; n++) {
    const xx = x * x;
    const yy = y * y;
    y = 2 * x * y + cy;
    x = xx - yy + cx;
    const m = x * x + y * y;
    if (m > BAILOUT_SQUARED) {
      // |z| squares each step, so log2 of (log|z| / log R) runs from 0 to 1 across one band.
      const frac = Math.log2((0.5 * Math.log(m)) / LOG_BAILOUT);
      return n - Math.min(0.999, Math.max(0, frac));
    }
  }
  return -1;
}

/** True for c in the main cardioid or the period-2 disc, where the orbit of 0 never escapes. */
export function inMainBulbs(cx: number, cy: number): boolean {
  const q = (cx - 0.25) * (cx - 0.25) + cy * cy;
  if (q * (q + (cx - 0.25)) <= 0.25 * cy * cy) return true;
  return (cx + 1) * (cx + 1) + cy * cy <= 0.0625;
}

export interface EscapeView {
  /** Image size in pixels. */
  width: number;
  height: number;
  /** The point of the plane at the centre of the image. */
  centreX: number;
  centreY: number;
  /** Width of one pixel in the plane. */
  pixel: number;
  maxIter: number;
  /** Julia set for the constant (cx, cy) instead of the Mandelbrot set. */
  julia: boolean;
  cx: number;
  cy: number;
}

/** Fills `out` (width * (y1 - y0) values) with the escape times of rows y0..y1-1. The imaginary axis points up. */
export function renderRows(view: EscapeView, y0: number, y1: number, out: Float32Array): void {
  const { width, height, centreX, centreY, pixel, maxIter } = view;
  let i = 0;
  for (let py = y0; py < y1; py++) {
    const y = centreY - (py + 0.5 - height / 2) * pixel;
    for (let px = 0; px < width; px++) {
      const x = centreX + (px + 0.5 - width / 2) * pixel;
      if (view.julia) out[i++] = escapeTime(x, y, view.cx, view.cy, maxIter);
      else out[i++] = inMainBulbs(x, y) ? -1 : escapeTime(0, 0, x, y, maxIter);
    }
  }
}

/** The first points of the orbit of z under z -> z^2 + c, as flat x, y pairs. Stops once z is far away. */
export function orbit(zx: number, zy: number, cx: number, cy: number, count: number): number[] {
  const points = [zx, zy];
  let x = zx;
  let y = zy;
  for (let n = 0; n < count && x * x + y * y < 1e6; n++) {
    const next = x * x - y * y + cx;
    y = 2 * x * y + cy;
    x = next;
    points.push(x, y);
  }
  return points;
}
