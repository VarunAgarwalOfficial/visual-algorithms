/**
 * A uniform spatial grid: the plane is cut into equal cells and every point is
 * filed under the cell it falls in. A query then only looks at the few cells
 * its radius touches instead of at every point.
 *
 * The points are stored by counting sort: `start[c]..start[c + 1]` is the range
 * of `items` that lie in cell `c`. Rebuilding is O(n) with no allocation.
 */
export interface SpatialGrid {
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** Cell size. Cells tile the area exactly, so they may be slightly larger than asked for. */
  cellWidth: number;
  cellHeight: number;
  start: Int32Array;
  items: Int32Array;
  /** Scratch: the cell of each point from the last build, and a write position per cell. */
  cellOf: Int32Array;
  cursor: Int32Array;
}

const MAX_CELLS = 1 << 16;

export function createGrid(width: number, height: number, minCell: number): SpatialGrid {
  let cell = Math.max(minCell, 1e-9);
  // Keep the table small whatever the caller asks for.
  while ((width / cell) * (height / cell) > MAX_CELLS) cell *= 2;
  const cols = Math.max(1, Math.floor(width / cell));
  const rows = Math.max(1, Math.floor(height / cell));
  return {
    width,
    height,
    cols,
    rows,
    cellWidth: width / cols,
    cellHeight: height / rows,
    start: new Int32Array(cols * rows + 1),
    items: new Int32Array(0),
    cellOf: new Int32Array(0),
    cursor: new Int32Array(cols * rows + 1),
  };
}

/** Files the first `n` points. Points outside the area go to the nearest edge cell. */
export function buildGrid(
  grid: SpatialGrid,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  n: number,
) {
  const { cols, rows, start } = grid;
  if (grid.items.length < n) {
    grid.items = new Int32Array(n);
    grid.cellOf = new Int32Array(n);
  }
  const { items, cellOf } = grid;
  start.fill(0);
  for (let i = 0; i < n; i++) {
    let c = Math.floor(x[i] / grid.cellWidth);
    let r = Math.floor(y[i] / grid.cellHeight);
    c = c < 0 ? 0 : c >= cols ? cols - 1 : c;
    r = r < 0 ? 0 : r >= rows ? rows - 1 : r;
    const cell = r * cols + c;
    cellOf[i] = cell;
    start[cell + 1]++;
  }
  for (let c = 0; c < cols * rows; c++) start[c + 1] += start[c];
  const cursor = grid.cursor;
  cursor.set(start);
  for (let i = 0; i < n; i++) items[cursor[cellOf[i]]++] = i;
}

/** Shortest signed difference b - a on a ring of the given length. */
export function wrapDelta(d: number, length: number): number {
  if (d > length / 2) return d - length;
  if (d < -length / 2) return d + length;
  return d;
}

/**
 * Collects the points within `radius` of (px, py) into `out` and returns how
 * many distance tests it took. With `wrap` the area is a torus.
 */
export function queryRadius(
  grid: SpatialGrid,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  px: number,
  py: number,
  radius: number,
  wrap: boolean,
  out: number[],
): number {
  const { cols, rows, start, items } = grid;
  let c0 = Math.floor((px - radius) / grid.cellWidth);
  let c1 = Math.floor((px + radius) / grid.cellWidth);
  let r0 = Math.floor((py - radius) / grid.cellHeight);
  let r1 = Math.floor((py + radius) / grid.cellHeight);
  if (!wrap || c1 - c0 + 1 >= cols) {
    c0 = wrap ? 0 : Math.max(0, c0);
    c1 = wrap ? cols - 1 : Math.min(cols - 1, c1);
  }
  if (!wrap || r1 - r0 + 1 >= rows) {
    r0 = wrap ? 0 : Math.max(0, r0);
    r1 = wrap ? rows - 1 : Math.min(rows - 1, r1);
  }
  const r2 = radius * radius;
  let tests = 0;
  out.length = 0;
  for (let rr = r0; rr <= r1; rr++) {
    const row = ((rr % rows) + rows) % rows;
    for (let cc = c0; cc <= c1; cc++) {
      const cell = row * cols + (((cc % cols) + cols) % cols);
      for (let k = start[cell]; k < start[cell + 1]; k++) {
        const j = items[k];
        let dx = x[j] - px;
        let dy = y[j] - py;
        if (wrap) {
          dx = wrapDelta(dx, grid.width);
          dy = wrapDelta(dy, grid.height);
        }
        tests++;
        if (dx * dx + dy * dy <= r2) out.push(j);
      }
    }
  }
  return tests;
}
