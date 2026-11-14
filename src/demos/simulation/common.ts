import type { Point } from '../../core/point';
import type { Stage } from '../../ui/canvas';

/** Helpers shared by the simulation demos. */

export const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
export const clampInt = (value: number, lo: number, hi: number) => clamp(Math.round(value), lo, hi);

/** Returns `value` if it is one of `options`, else the first option. */
export function oneOf<T extends string>(value: string, options: readonly T[]): T {
  return (options as readonly string[]).includes(value) ? (value as T) : options[0];
}

/** Times calls with performance.now and keeps a smoothed figure in milliseconds. */
export function meter() {
  let ms = 0;
  return {
    time<T>(work: () => T): T {
      const start = performance.now();
      const result = work();
      const took = performance.now() - start;
      ms = ms === 0 ? took : ms * 0.9 + took * 0.1;
      return result;
    },
    reset() {
      ms = 0;
    },
    get ms() {
      return ms;
    },
  };
}

/** True at most once per `interval` ms, or whenever `force` is set: for text that need not change every frame. */
export function every(interval: number) {
  let last = -Infinity;
  return (force: boolean) => {
    const now = performance.now();
    if (!force && now - last < interval) return false;
    last = now;
    return true;
  };
}

/** Maps a fixed world rectangle onto the canvas, centred, keeping its shape. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export function fit(stage: Stage, worldWidth: number, worldHeight: number): View {
  const scale = Math.min(stage.width / worldWidth, stage.height / worldHeight);
  return {
    scale,
    x: (stage.width - worldWidth * scale) / 2,
    y: (stage.height - worldHeight * scale) / 2,
  };
}

export function toWorld(view: View, point: Point): Point {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

/** Short number for a counter: thousands separators for integers, three significant figures otherwise. */
export function short(value: number): string {
  if (!Number.isFinite(value)) return '–';
  if (Number.isInteger(value)) return value.toLocaleString('en-GB');
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 0.001 || magnitude >= 1e6)) return value.toExponential(2);
  return value.toPrecision(3);
}
