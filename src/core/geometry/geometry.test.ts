import { describe, expect, it } from 'vitest';
import type { Point } from '../point';
import { seeded } from '../random';
import { bruteForceClosest, closestPair } from './closest';
import { bernstein, deBoor, deCasteljau, knotVector, splineDomain } from './curves';
import { circumcircle, delaunay, realTriangles, voronoiCells } from './delaunay';
import { cellShape } from './field';
import { HULL_ALGORITHMS, convexHull } from './hull';
import {
  WORLD_H,
  WORLD_W,
  dist2,
  inCircle,
  orient,
  randomPoints,
  type Distribution,
} from './plane';
import { buildQuadtree, nearestQuery, rangeQuery } from './quadtree';
import { bruteForcePairs, sweepIntersections, type Segment } from './sweep';

const KINDS: Distribution[] = ['uniform', 'cluster', 'circle', 'jitter', 'grid'];
/** A few seeded point sets of each distribution, including the degenerate exact grid. */
function pointSets(count: number): Point[][] {
  return KINDS.flatMap((kind, k) =>
    [1, 2, 3].map((seed) => randomPoints(kind, count + seed, seeded(seed * 10 + k))),
  );
}

describe('convex hull', () => {
  it('all four algorithms return the same hull, convex and containing every point', () => {
    for (const points of pointSets(40)) {
      const hulls = HULL_ALGORITHMS.map((a) => convexHull(a.id, points).hull);
      const reference = hulls[0];
      for (let i = 0; i < reference.length; i++) {
        const a = points[reference[i]];
        const b = points[reference[(i + 1) % reference.length]];
        const c = points[reference[(i + 2) % reference.length]];
        expect(orient(a, b, c)).toBeGreaterThan(0);
        for (const p of points) expect(orient(a, b, p)).toBeGreaterThanOrEqual(0);
      }
      const sorted = [...reference].sort((x, y) => x - y);
      for (const hull of hulls) expect([...hull].sort((x, y) => x - y)).toEqual(sorted);
    }
  });

  it('counts fewer orientation tests for quickhull than gift wrapping on a uniform set', () => {
    const points = randomPoints('uniform', 100, seeded(5));
    const tests = (id: 'quickhull' | 'wrap') => convexHull(id, points).steps.at(-1)?.tests ?? 0;
    expect(tests('quickhull')).toBeLessThan(tests('wrap'));
  });
});

describe('Delaunay', () => {
  it('has empty circumcircles and 2n - 2 - h triangles, also on grids and circles', () => {
    for (const points of pointSets(30)) {
      const triangles = realTriangles(delaunay(points));
      for (const [a, b, c] of triangles) {
        expect(orient(points[a], points[b], points[c])).toBeGreaterThan(0);
        for (const p of points)
          expect(inCircle(points[a], points[b], points[c], p)).toBeLessThanOrEqual(0);
      }
      // h counts every point on the hull boundary, collinear ones included.
      const hull = convexHull('monotone', points).hull;
      const onBoundary = points.filter((p) =>
        hull.some((v, i) => orient(points[v], points[hull[(i + 1) % hull.length]], p) === 0),
      ).length;
      expect(triangles.length).toBe(2 * points.length - 2 - onBoundary);
    }
  });

  it('gives Voronoi cells whose corners are equidistant from the nearest sites', () => {
    const points = randomPoints('uniform', 25, seeded(9));
    const sites = points.map((_, i) => i);
    const box = { x0: 0, y0: 0, x1: WORLD_W, y1: WORLD_H };
    const cells = voronoiCells(points, sites, delaunay(points), box);
    let area = 0;
    for (const [site, cell] of cells) {
      cell.forEach((corner, i) => {
        const nearest = Math.min(...points.map((p) => dist2(p, corner)));
        expect(dist2(points[site], corner)).toBeCloseTo(nearest, 3);
        const next = cell[(i + 1) % cell.length];
        area += (corner.x * next.y - next.x * corner.y) / 2;
      });
    }
    expect(Math.abs(area)).toBeCloseTo(WORLD_W * WORLD_H, 0);
    const [a, b, c] = realTriangles(delaunay(points))[0];
    const circle = circumcircle(points[a], points[b], points[c]);
    expect(Math.hypot(points[b].x - circle.x, points[b].y - circle.y)).toBeCloseTo(circle.r, 6);
  });
});

describe('segment intersection sweep', () => {
  const key = (pairs: [number, number][]) => pairs.map(([i, j]) => `${i}-${j}`).sort();
  const randomSegments = (seed: number, count: number, grid: number): Segment[] => {
    const random = seeded(seed);
    const coordinate = () => Math.floor(random() * grid) * (3000 / grid);
    const out: Segment[] = [];
    while (out.length < count) {
      const s = {
        a: { x: coordinate(), y: coordinate() },
        b: { x: coordinate(), y: coordinate() },
      };
      if (s.a.x !== s.b.x || s.a.y !== s.b.y) out.push(s);
    }
    return out;
  };

  it('finds exactly the brute-force pairs in general position', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const segments = randomSegments(seed, 4 + (seed % 20), 1000);
      expect(key(sweepIntersections(segments).pairs)).toEqual(key(bruteForcePairs(segments)));
    }
  });

  it('copes with shared endpoints, vertical segments and several segments through a point', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const segments = randomSegments(seed, 3 + (seed % 12), 6);
      expect(key(sweepIntersections(segments).pairs)).toEqual(key(bruteForcePairs(segments)));
    }
  });

  it('needs far fewer pair tests than brute force when few segments cross', () => {
    const segments: Segment[] = Array.from({ length: 40 }, (_, i) => ({
      a: { x: 50 * i, y: 100 + ((i * 37) % 11) },
      b: { x: 50 * i + 400, y: 120 + ((i * 53) % 13) + 60 * (i % 3) },
    }));
    const result = sweepIntersections(segments);
    expect(key(result.pairs)).toEqual(key(bruteForcePairs(segments)));
    expect(result.tests).toBeLessThan((40 * 39) / 2 / 2);
  });
});

describe('closest pair', () => {
  it('matches brute force with fewer distance computations', () => {
    for (const points of pointSets(60)) {
      const result = closestPair(points);
      expect(result.distance).toBe(bruteForceClosest(points));
      const [i, j] = result.pair as [number, number];
      expect(Math.sqrt(dist2(points[i], points[j]))).toBe(result.distance);
      const last = result.steps[result.steps.length - 1];
      expect(last.distances).toBeLessThan((points.length * (points.length - 1)) / 2);
      expect(last.neighbours).toBeLessThanOrEqual(7);
    }
  });
});

describe('curves', () => {
  const control = [
    { x: 0, y: 0 },
    { x: 10, y: 40 },
    { x: 50, y: -20 },
    { x: 80, y: 30 },
    { x: 100, y: 0 },
  ];

  it('de Casteljau hits the end points and agrees with the Bernstein form', () => {
    expect(deCasteljau(control, 0).at(-1)).toEqual([control[0]]);
    expect(deCasteljau(control, 1).at(-1)).toEqual([control[4]]);
    for (const t of [0.25, 0.5, 0.9]) {
      const [p] = deCasteljau(control, t).at(-1) as Point[];
      const q = bernstein(control, t);
      expect(p.x).toBeCloseTo(q.x, 9);
      expect(p.y).toBeCloseTo(q.y, 9);
    }
  });

  it('de Boor with clamped knots and no interior knots is the Bezier curve', () => {
    const knots = knotVector(5, 4, true);
    expect(splineDomain(knots, 5, 4)).toEqual([0, 1]);
    const { levels } = deBoor(control, 4, knots, 0.3);
    const q = bernstein(control, 0.3);
    expect(levels.at(-1)?.[0].x).toBeCloseTo(q.x, 9);
    expect(levels.at(-1)?.[0].y).toBeCloseTo(q.y, 9);
  });

  it('a uniform cubic B-spline is continuous across a knot and uses four control points', () => {
    const knots = knotVector(5, 3, false);
    const before = deBoor(control, 3, knots, 4 - 1e-9);
    const after = deBoor(control, 3, knots, 4);
    expect(after.span).toBe(before.span + 1);
    expect(after.levels[0]).toEqual(control.slice(1, 5));
    expect(after.levels[3][0].x).toBeCloseTo(before.levels[3][0].x, 6);
    // At a knot the uniform cubic weights are 1/6, 4/6, 1/6.
    expect(after.levels[3][0].y).toBeCloseTo((40 + 4 * -20 + 30) / 6, 9);
  });
});

describe('quadtree', () => {
  it('answers range and nearest queries like a linear scan, visiting fewer points', () => {
    const points = randomPoints('uniform', 150, seeded(4));
    const box = { x: 0, y: 0, w: WORLD_W, h: WORLD_H };
    const { root } = buildQuadtree(points, points.length, 4, box);
    const random = seeded(8);
    for (let k = 0; k < 40; k++) {
      const rect = { x: random() * 3000, y: random() * 2000, w: random() * 900, h: random() * 900 };
      const expected = points
        .map((_, i) => i)
        .filter((i) => {
          const p = points[i];
          return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
        });
      expect(rangeQuery(root, points, rect).sort((a, b) => a - b)).toEqual(expected);

      const probe = { x: random() * WORLD_W, y: random() * WORLD_H };
      const events: Parameters<typeof nearestQuery>[3] = [];
      const nearest = nearestQuery(root, points, probe, events);
      expect(dist2(points[nearest], probe)).toBe(Math.min(...points.map((p) => dist2(p, probe))));
      expect(events.filter((e) => e.kind === 'check').length).toBeLessThan(points.length / 2);
    }
  });
});

describe('marching squares cell', () => {
  it('resolves a saddle by the cell average, and its inside area follows the corners', () => {
    const area = (polygons: number[][]) =>
      polygons.reduce((sum, p) => {
        let a = 0;
        for (let i = 0; i < p.length; i += 2) {
          const j = (i + 2) % p.length;
          a += p[i] * p[j + 1] - p[j] * p[i + 1];
        }
        return sum + Math.abs(a) / 2;
      }, 0);
    // TR and BL high: a saddle (case 5). The average 5 is above the threshold 4.5.
    const apart = cellShape(0, 10, 0, 10, 4.5, false, false);
    const joined = cellShape(0, 10, 0, 10, 4.5, false, true);
    expect(apart.index).toBe(5);
    expect(apart.inside.length).toBe(2);
    expect(area(apart.inside)).toBeCloseTo(0.25, 9);
    expect(joined.joined).toBe(true);
    expect(area(joined.inside)).toBeCloseTo(0.75, 9);
    // Left half inside, interpolated: the contour sits where the threshold falls.
    const half = cellShape(10, 0, 0, 10, 2.5, true, true);
    expect(half.segments).toEqual([0.75, 0, 0.75, 1]);
    expect(area(half.inside)).toBeCloseTo(0.75, 9);
  });
});
