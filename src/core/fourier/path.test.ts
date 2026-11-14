import { describe, expect, it } from 'vitest';
import { normalise, parsePoints, pathLength, resample } from './path';
import { heart, smiley, square, star, trefoil } from './shapes';

const unitSquare = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe('parsePoints', () => {
  it('reads space and comma separated pairs', () => {
    expect(parsePoints('1 2 3.5,-4 .5 1e1')).toEqual([
      { x: 1, y: 2 },
      { x: 3.5, y: -4 },
      { x: 0.5, y: 10 },
    ]);
  });

  it('ignores a trailing unpaired number and empty input', () => {
    expect(parsePoints('1 2 3')).toEqual([{ x: 1, y: 2 }]);
    expect(parsePoints('')).toEqual([]);
  });
});

describe('pathLength', () => {
  it('counts the closing edge only for closed paths', () => {
    expect(pathLength(unitSquare, true)).toBe(4);
    expect(pathLength(unitSquare, false)).toBe(3);
  });
});

describe('resample', () => {
  it('spaces points evenly along a closed path', () => {
    const points = resample(unitSquare, 8);
    expect(points).toHaveLength(8);
    const expected = [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 0.5],
      [1, 1],
      [0.5, 1],
      [0, 1],
      [0, 0.5],
    ];
    points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i][0], 12);
      expect(p.y).toBeCloseTo(expected[i][1], 12);
    });
  });

  it('includes both ends of an open path', () => {
    const points = resample(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      5,
      false,
    );
    expect(points.map((p) => p.x)).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  it('keeps neighbouring points the same distance apart on an uneven input', () => {
    const points = resample(smiley(), 256);
    const total = pathLength(smiley(), true);
    const gaps = points.map((p, i) => {
      const q = points[(i + 1) % points.length];
      return Math.hypot(q.x - p.x, q.y - p.y);
    });
    // Chords cut corners, so a gap can be shorter than the arc step but never longer.
    for (const gap of gaps) expect(gap).toBeLessThanOrEqual(total / 256 + 1e-9);
  });

  it('handles degenerate input', () => {
    expect(resample([], 4)).toEqual([]);
    expect(resample(unitSquare, 0)).toEqual([]);
    expect(resample([{ x: 2, y: 3 }], 3)).toEqual(Array(3).fill({ x: 2, y: 3 }));
    const repeated = resample(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      4,
    );
    for (const p of repeated) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});

describe('normalise', () => {
  it('centres the bounding box and fits the longer side to [-1, 1]', () => {
    const out = normalise([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 20 },
    ]);
    expect(out).toEqual([
      { x: -1, y: -0.5 },
      { x: 1, y: -0.5 },
      { x: 1, y: 0.5 },
    ]);
  });

  it('does not divide by zero for a single point', () => {
    expect(normalise([{ x: 5, y: 5 }])).toEqual([{ x: 0, y: 0 }]);
  });
});

describe('preset shapes', () => {
  it.each([
    ['heart', heart()],
    ['star', star()],
    ['square', square()],
    ['trefoil', trefoil()],
    ['smiley', smiley()],
  ])('%s is a usable outline', (_name, points) => {
    expect(points.length).toBeGreaterThanOrEqual(4);
    expect(pathLength(points, true)).toBeGreaterThan(0);
    for (const p of points) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});
