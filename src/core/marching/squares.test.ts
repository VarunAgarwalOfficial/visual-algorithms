import { describe, expect, it } from 'vitest';
import {
  BOTTOM,
  CASE_SEGMENTS,
  LEFT,
  RIGHT,
  TOP,
  caseIndex,
  cellSegments,
  crossing,
  marchingSquares,
  segmentsForCase,
  type Edge,
} from './squares';

/** Corner values for a case index: inside corners get 1, outside corners 0. */
function corners(index: number): [number, number, number, number] {
  return [index & 8 ? 1 : 0, index & 4 ? 1 : 0, index & 2 ? 1 : 0, index & 1 ? 1 : 0];
}

/** The corners at each end of an edge, as positions in [tl, tr, br, bl]. */
const EDGE_CORNERS: Record<Edge, [number, number]> = {
  [TOP]: [0, 1],
  [RIGHT]: [1, 2],
  [BOTTOM]: [2, 3],
  [LEFT]: [3, 0],
};
const EDGES: Edge[] = [TOP, RIGHT, BOTTOM, LEFT];

describe('caseIndex', () => {
  it('packs corners clockwise from the top-left, most significant first', () => {
    expect(caseIndex(1, 0, 0, 0, 0.5)).toBe(8);
    expect(caseIndex(0, 1, 0, 0, 0.5)).toBe(4);
    expect(caseIndex(0, 0, 1, 0, 0.5)).toBe(2);
    expect(caseIndex(0, 0, 0, 1, 0.5)).toBe(1);
    for (let i = 0; i < 16; i++) expect(caseIndex(...corners(i), 0.5)).toBe(i);
  });

  it('treats a value equal to the threshold as inside', () => {
    expect(caseIndex(0.5, 0.5, 0.5, 0.5, 0.5)).toBe(15);
  });
});

describe('case table', () => {
  it('matches the reference table', () => {
    expect(CASE_SEGMENTS).toEqual([
      [],
      [[LEFT, BOTTOM]],
      [[BOTTOM, RIGHT]],
      [[LEFT, RIGHT]],
      [[TOP, RIGHT]],
      [
        [TOP, RIGHT],
        [LEFT, BOTTOM],
      ],
      [[TOP, BOTTOM]],
      [[TOP, LEFT]],
      [[TOP, LEFT]],
      [[TOP, BOTTOM]],
      [
        [TOP, LEFT],
        [BOTTOM, RIGHT],
      ],
      [[TOP, RIGHT]],
      [[LEFT, RIGHT]],
      [[BOTTOM, RIGHT]],
      [[LEFT, BOTTOM]],
      [],
    ]);
  });

  it.each(Array.from({ length: 16 }, (_, i) => i))(
    'case %i crosses exactly the edges whose corners differ, once each',
    (index) => {
      const inside = corners(index);
      const expected = EDGES.filter((e) => {
        const [a, b] = EDGE_CORNERS[e];
        return inside[a] !== inside[b];
      });
      for (const centreInside of [false, true]) {
        const used = segmentsForCase(index, centreInside).flat();
        expect([...used].sort()).toEqual([...expected].sort());
      }
    },
  );

  it('gives a case and its complement the same segments', () => {
    for (let i = 0; i < 16; i++) {
      if (i === 5 || i === 10) continue;
      expect(CASE_SEGMENTS[i]).toEqual(CASE_SEGMENTS[15 - i]);
    }
  });

  it('separates the inside corners of a saddle unless the centre is inside', () => {
    // Case 5: TR and BL inside. Apart: each is cut off with its own segment.
    expect(segmentsForCase(5, false)).toEqual([
      [TOP, RIGHT],
      [LEFT, BOTTOM],
    ]);
    // Joined: the outside corners TL and BR are cut off instead.
    expect(segmentsForCase(5, true)).toEqual([
      [TOP, LEFT],
      [BOTTOM, RIGHT],
    ]);
    expect(segmentsForCase(10, true)).toEqual(segmentsForCase(5, false));
    expect(segmentsForCase(10, false)).toEqual(segmentsForCase(5, true));
  });
});

describe('crossing', () => {
  it('solves the linear interpolation for the threshold', () => {
    expect(crossing(0, 2, 0.5)).toBeCloseTo(0.25, 12);
    expect(crossing(3, 1, 1.5)).toBeCloseTo(0.75, 12);
  });

  it('falls back to the midpoint when the values are equal or not finite', () => {
    expect(crossing(1, 1, 1)).toBe(0.5);
    expect(crossing(Infinity, Infinity, 1)).toBe(0.5);
  });
});

describe('cellSegments', () => {
  it('returns nothing for empty and full cells', () => {
    expect(cellSegments(0, 0, 0, 0, 1, true)).toEqual([]);
    expect(cellSegments(2, 2, 2, 2, 1, true)).toEqual([]);
  });

  it('uses edge midpoints without interpolation', () => {
    // Case 1: only the bottom-left corner is inside.
    expect(cellSegments(0, 0, 0, 4, 1, false)).toEqual([0, 0.5, 0.5, 1]);
  });

  it('moves the crossings towards the outside corner as the inside value grows', () => {
    // Left edge TL=0 -> BL=4 crosses 1 a quarter of the way down; bottom edge likewise from BR.
    expect(cellSegments(0, 0, 0, 4, 1, true)).toEqual([0, 0.25, 0.75, 1]);
  });

  it('emits two segments for both readings of a saddle', () => {
    const apart = cellSegments(0, 1.2, 0, 1.2, 1, false); // centre mean 0.6: outside
    const joined = cellSegments(0.9, 3, 0.9, 3, 1, false); // centre mean 1.95: inside
    expect(apart).toEqual([0.5, 0, 1, 0.5, 0, 0.5, 0.5, 1]);
    expect(joined).toEqual([0.5, 0, 0, 0.5, 0.5, 1, 1, 0.5]);
  });

  it('keeps every endpoint on the cell boundary', () => {
    for (let i = 0; i < 16; i++) {
      const [tl, tr, br, bl] = corners(i).map((v) => v * 1.7 + 0.2);
      const s = cellSegments(tl, tr, br, bl, 1, true);
      for (let k = 0; k < s.length; k += 2) {
        const [x, y] = [s[k], s[k + 1]];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
        expect(x === 0 || x === 1 || y === 0 || y === 1).toBe(true);
      }
    }
  });
});

describe('marchingSquares', () => {
  function grid(cols: number, rows: number, f: (x: number, y: number) => number) {
    const values: number[] = [];
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) values.push(f(c, r));
    return { cols, rows, values };
  }

  it('finds the exact contour of a linear field when interpolating', () => {
    // f = x, threshold 1.3: a vertical line at x = 1.3 through every row.
    const segments = marchingSquares(
      grid(4, 3, (x) => x),
      1.3,
      true,
    );
    expect(segments).toHaveLength(3 * 4);
    for (let k = 0; k < segments.length; k += 2) expect(segments[k]).toBeCloseTo(1.3, 12);
  });

  it('snaps the same contour to cell midpoints without interpolation', () => {
    const segments = marchingSquares(
      grid(4, 3, (x) => x),
      1.3,
      false,
    );
    for (let k = 0; k < segments.length; k += 2) expect(segments[k]).toBe(1.5);
  });

  it('traces a closed loop around a bump: every endpoint is shared by two segments', () => {
    const bump = (x: number, y: number) => 10 / (1 + (x - 4.3) ** 2 + (y - 3.6) ** 2);
    const segments = marchingSquares(grid(9, 8, bump), 1, true);
    expect(segments.length).toBeGreaterThan(0);
    const seen = new Map<string, number>();
    for (let k = 0; k < segments.length; k += 2) {
      const key = `${segments[k].toFixed(6)},${segments[k + 1].toFixed(6)}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const count of seen.values()) expect(count).toBe(2);
  });

  it('places interpolated points closer to the true contour than midpoints', () => {
    // Circle of radius 3 around (5, 5): f = 9 / d^2, contour f = 1.
    const circle = (x: number, y: number) => 9 / ((x - 5) ** 2 + (y - 5) ** 2 + 1e-9);
    const worst = (interpolate: boolean) => {
      const s = marchingSquares(grid(10, 10, circle), 1, interpolate);
      let max = 0;
      for (let k = 0; k < s.length; k += 2) {
        max = Math.max(max, Math.abs(Math.hypot(s[k] - 5, s[k + 1] - 5) - 3));
      }
      return max;
    };
    expect(worst(true)).toBeLessThan(worst(false));
    expect(worst(true)).toBeLessThan(0.2);
  });
});
