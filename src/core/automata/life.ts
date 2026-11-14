import { packCells, unpackCells } from '../encode';

/**
 * Life-like cellular automata on a rectangular grid. A rule is two sets of
 * neighbour counts: the counts at which a dead cell is born and the counts at
 * which a live cell survives. Conway's Life is B3/S23.
 */

export interface LifeRule {
  /** Bit n set: a dead cell with n live neighbours is born. */
  birth: number;
  /** Bit n set: a live cell with n live neighbours survives. */
  survive: number;
}

/** Parses "B3/S23" notation. Digits outside 0-8 are ignored. */
export function parseRule(text: string): LifeRule {
  const mask = (digits: string) => {
    let bits = 0;
    for (const d of digits) if (d >= '0' && d <= '8') bits |= 1 << Number(d);
    return bits;
  };
  const match = /^B(\d*)\/S(\d*)$/i.exec(text.trim());
  return match ? { birth: mask(match[1]), survive: mask(match[2]) } : { birth: 8, survive: 12 };
}

/**
 * Computes one generation from `cells` into `next` (both width * height, 0 or 1)
 * and returns the new population. With `wrap` the grid is a torus; without it,
 * cells outside the grid are dead.
 */
export function stepLife(
  cells: Uint8Array,
  next: Uint8Array,
  width: number,
  height: number,
  rule: LifeRule,
  wrap: boolean,
): number {
  let population = 0;
  for (let y = 0; y < height; y++) {
    const up = y > 0 ? y - 1 : wrap ? height - 1 : -1;
    const down = y < height - 1 ? y + 1 : wrap ? 0 : -1;
    for (let x = 0; x < width; x++) {
      const left = x > 0 ? x - 1 : wrap ? width - 1 : -1;
      const right = x < width - 1 ? x + 1 : wrap ? 0 : -1;
      let n = 0;
      if (up >= 0) {
        const row = up * width;
        if (left >= 0) n += cells[row + left];
        n += cells[row + x];
        if (right >= 0) n += cells[row + right];
      }
      const row = y * width;
      if (left >= 0) n += cells[row + left];
      if (right >= 0) n += cells[row + right];
      if (down >= 0) {
        const below = down * width;
        if (left >= 0) n += cells[below + left];
        n += cells[below + x];
        if (right >= 0) n += cells[below + right];
      }
      const alive = ((cells[row + x] ? rule.survive : rule.birth) >> n) & 1;
      next[row + x] = alive;
      population += alive;
    }
  }
  return population;
}

/**
 * Decodes a run-length encoded pattern ("bob$2bo$3o!") into the [x, y] of its
 * live cells. `b` is dead, `o` alive, `$` ends a row, a number repeats the next item.
 */
export function parseRle(rle: string): [number, number][] {
  const cells: [number, number][] = [];
  let x = 0;
  let y = 0;
  let count = 0;
  for (const ch of rle) {
    if (ch >= '0' && ch <= '9') {
      count = Math.min(10_000, count * 10 + Number(ch));
      continue;
    }
    const run = Math.max(1, count);
    count = 0;
    if (ch === 'b') x += run;
    else if (ch === 'o') for (let k = 0; k < run; k++) cells.push([x++, y]);
    else if (ch === '$') {
      y += run;
      x = 0;
    } else if (ch === '!') break;
  }
  return cells;
}

/** Sets the given cells alive, with the pattern's bounding box centred at (cx, cy). Cells off the grid are dropped. */
export function placePattern(
  grid: Uint8Array,
  width: number,
  height: number,
  pattern: readonly (readonly [number, number])[],
  cx: number,
  cy: number,
): void {
  let w = 0;
  let h = 0;
  for (const [x, y] of pattern) {
    w = Math.max(w, x + 1);
    h = Math.max(h, y + 1);
  }
  const ox = Math.round(cx - w / 2);
  const oy = Math.round(cy - h / 2);
  for (const [x, y] of pattern) {
    const gx = ox + x;
    const gy = oy + y;
    if (gx >= 0 && gx < width && gy >= 0 && gy < height) grid[gy * width + gx] = 1;
  }
}

/** Packs 0/1 cells six to a symbol (then run-length coded) for the URL. */
export function packBits(cells: ArrayLike<number>): string {
  const groups = new Uint8Array(Math.ceil(cells.length / 6));
  for (let i = 0; i < cells.length; i++) if (cells[i]) groups[(i / 6) | 0] |= 1 << (i % 6);
  // Trailing empty groups carry nothing: unpacking fills with zeros.
  let end = groups.length;
  while (end > 0 && groups[end - 1] === 0) end--;
  return packCells(groups.subarray(0, end));
}

/** Inverse of packBits: always returns `length` cells. */
export function unpackBits(text: string, length: number): Uint8Array {
  const groups = unpackCells(text, Math.ceil(length / 6));
  const cells = new Uint8Array(length);
  for (let i = 0; i < length; i++) cells[i] = (groups[(i / 6) | 0] >> (i % 6)) & 1;
  return cells;
}
