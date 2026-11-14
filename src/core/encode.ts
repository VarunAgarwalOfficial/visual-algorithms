import type { Point } from './point';

/**
 * Compact text encodings for state that goes in the URL. Only characters that
 * survive in a URL fragment unescaped are used.
 */

const GRID = 1000;

/** Packs points in the unit square as base-36 pairs, three decimals of precision each. */
export function packPoints(points: readonly Point[]): string {
  const q = (v: number) => Math.max(0, Math.min(GRID - 1, Math.round(v * (GRID - 1))));
  return points.map((p) => (q(p.x) * GRID + q(p.y)).toString(36)).join('.');
}

export function unpackPoints(text: string): Point[] {
  if (!text) return [];
  const points: Point[] = [];
  for (const part of text.split('.')) {
    const n = /^[0-9a-z]+$/.test(part) ? Number.parseInt(part, 36) : NaN;
    if (!Number.isFinite(n) || n < 0 || n >= GRID * GRID) continue;
    points.push({ x: Math.floor(n / GRID) / (GRID - 1), y: (n % GRID) / (GRID - 1) });
  }
  return points;
}

const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Packs small integers (0..maxValue, maxValue < 64) with run-length coding: "value" or "value~count.". */
export function packCells(cells: ArrayLike<number>): string {
  let out = '';
  for (let i = 0; i < cells.length;) {
    let run = 1;
    while (i + run < cells.length && cells[i + run] === cells[i]) run++;
    out += DIGITS[cells[i] & 63];
    if (run > 3) out += `~${run.toString(36)}.`;
    else out += DIGITS[cells[i] & 63].repeat(run - 1);
    i += run;
  }
  return out;
}

/** Inverse of packCells. Returns `length` values; missing ones are 0, extra ones are dropped. */
export function unpackCells(text: string, length: number): Uint8Array {
  const cells = new Uint8Array(length);
  let at = 0;
  for (let i = 0; i < text.length && at < length; i++) {
    const value = DIGITS.indexOf(text[i]);
    if (value < 0) continue;
    let run = 1;
    if (text[i + 1] === '~') {
      const end = text.indexOf('.', i);
      if (end < 0) break;
      run = Number.parseInt(text.slice(i + 2, end), 36) || 1;
      i = end;
    }
    for (let k = 0; k < run && at < length; k++) cells[at++] = value;
  }
  return cells;
}
