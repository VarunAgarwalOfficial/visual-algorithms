/**
 * Marching squares: extracts the contour f(x, y) = threshold from a scalar
 * field sampled on a regular grid, one cell at a time.
 *
 * Corners are read clockwise from the top-left and packed into a 4-bit case
 * index. Edges are named after the side of the cell they sit on.
 *
 *     TL(8) --top--- TR(4)
 *       |              |
 *      left          right
 *       |              |
 *     BL(1) -bottom- BR(2)
 */

export const TOP = 0;
export const RIGHT = 1;
export const BOTTOM = 2;
export const LEFT = 3;
export type Edge = typeof TOP | typeof RIGHT | typeof BOTTOM | typeof LEFT;
export type EdgePair = readonly [Edge, Edge];

/**
 * The lookup table: which pairs of edges a contour segment joins, per case.
 * The two saddle cases (5 and 10) are listed with their corners cut off
 * separately; see {@link segmentsForCase} for the other reading.
 */
export const CASE_SEGMENTS: readonly (readonly EdgePair[])[] = [
  /*  0 ....          */ [],
  /*  1 BL            */ [[LEFT, BOTTOM]],
  /*  2 BR            */ [[BOTTOM, RIGHT]],
  /*  3 BL BR         */ [[LEFT, RIGHT]],
  /*  4 TR            */ [[TOP, RIGHT]],
  /*  5 TR BL  saddle */ [
    [TOP, RIGHT],
    [LEFT, BOTTOM],
  ],
  /*  6 TR BR         */ [[TOP, BOTTOM]],
  /*  7 TR BR BL      */ [[TOP, LEFT]],
  /*  8 TL            */ [[TOP, LEFT]],
  /*  9 TL BL         */ [[TOP, BOTTOM]],
  /* 10 TL BR  saddle */ [
    [TOP, LEFT],
    [BOTTOM, RIGHT],
  ],
  /* 11 TL BR BL      */ [[TOP, RIGHT]],
  /* 12 TL TR         */ [[LEFT, RIGHT]],
  /* 13 TL TR BL      */ [[BOTTOM, RIGHT]],
  /* 14 TL TR BR      */ [[LEFT, BOTTOM]],
  /* 15 all           */ [],
];

/** Packs the four corners into a case index. A corner is inside when its value >= threshold. */
export function caseIndex(
  tl: number,
  tr: number,
  br: number,
  bl: number,
  threshold: number,
): number {
  return (
    (tl >= threshold ? 8 : 0) |
    (tr >= threshold ? 4 : 0) |
    (br >= threshold ? 2 : 0) |
    (bl >= threshold ? 1 : 0)
  );
}

/**
 * Segments for a case. In a saddle the two inside corners are diagonal, and the
 * corners alone cannot say whether they are joined through the middle. If the
 * centre of the cell is inside they are, and the segments are those of the
 * opposite saddle.
 */
export function segmentsForCase(index: number, centreInside = false): readonly EdgePair[] {
  if (centreInside && (index === 5 || index === 10)) return CASE_SEGMENTS[15 - index];
  return CASE_SEGMENTS[index];
}

/**
 * Where the contour crosses the edge between corner values a and b, as a
 * fraction from a to b. Linear interpolation: solve a + t * (b - a) = threshold.
 */
export function crossing(a: number, b: number, threshold: number): number {
  const t = (threshold - a) / (b - a);
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.5;
}

/**
 * Contour segments of one cell, in cell coordinates (top-left corner at 0,0,
 * bottom-right at 1,1), packed [x1, y1, x2, y2, ...]. Without interpolation
 * every crossing sits at the middle of its edge.
 */
export function cellSegments(
  tl: number,
  tr: number,
  br: number,
  bl: number,
  threshold: number,
  interpolate: boolean,
): number[] {
  const index = caseIndex(tl, tr, br, bl, threshold);
  if (index === 0 || index === 15) return [];
  const centreInside = (tl + tr + br + bl) / 4 >= threshold;
  const at = (a: number, b: number) => (interpolate ? crossing(a, b, threshold) : 0.5);
  const out: number[] = [];
  const push = (edge: Edge) => {
    if (edge === TOP) out.push(at(tl, tr), 0);
    else if (edge === RIGHT) out.push(1, at(tr, br));
    else if (edge === BOTTOM) out.push(at(bl, br), 1);
    else out.push(0, at(tl, bl));
  };
  for (const [from, to] of segmentsForCase(index, centreInside)) {
    push(from);
    push(to);
  }
  return out;
}

/** A scalar field sampled at the corners of a cols x rows grid of cells, row by row. */
export interface Grid {
  cols: number;
  rows: number;
  /** (cols + 1) * (rows + 1) values; the sample at column c, row r is values[r * (cols + 1) + c]. */
  values: ArrayLike<number>;
}

/** All contour segments of a grid, in grid coordinates (one cell = one unit). */
export function marchingSquares(grid: Grid, threshold: number, interpolate: boolean): number[] {
  const { cols, rows, values } = grid;
  const stride = cols + 1;
  const out: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * stride + c;
      const segments = cellSegments(
        values[i],
        values[i + 1],
        values[i + stride + 1],
        values[i + stride],
        threshold,
        interpolate,
      );
      for (let k = 0; k < segments.length; k += 2) {
        out.push(segments[k] + c, segments[k + 1] + r);
      }
    }
  }
  return out;
}
