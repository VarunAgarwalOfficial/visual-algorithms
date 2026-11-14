import { describe, expect, it } from 'vitest';
import type { Point } from '../point';
import { dft, evaluate, toEpicycles } from './dft';
import { joinOutlines, resample } from './path';

const TAU = 2 * Math.PI;
const outline: Point[] = Array.from({ length: 16 }, (_, n) => ({
  x: Math.cos((TAU * n) / 16) + 0.3 * Math.cos((TAU * 3 * n) / 16),
  y: Math.sin((TAU * n) / 16) - 0.2 * Math.sin((TAU * 5 * n) / 16),
}));

describe('Fourier epicycles', () => {
  it('puts a single rotating vector in a single bin', () => {
    const circle = Array.from({ length: 8 }, (_, n) => ({
      x: 2 * Math.cos((TAU * n) / 8),
      y: 2 * Math.sin((TAU * n) / 8),
    }));
    const magnitudes = dft(circle).map((c) => Math.hypot(c.x, c.y));
    expect(magnitudes[1]).toBeCloseTo(2);
    expect(magnitudes.reduce((a, b) => a + b, 0)).toBeCloseTo(2);
  });

  it('reproduces every sample when all circles are used', () => {
    const epicycles = toEpicycles(dft(outline));
    outline.forEach((p, n) => {
      const q = evaluate(epicycles, n / outline.length, outline.length);
      expect(q.x).toBeCloseTo(p.x);
      expect(q.y).toBeCloseTo(p.y);
    });
  });

  it('sorts circles by radius, so the error never grows as circles are added', () => {
    const epicycles = toEpicycles(dft(outline));
    let previous = Infinity;
    for (let count = 0; count < outline.length; count++) {
      let error = 0;
      outline.forEach((p, n) => {
        const q = evaluate(epicycles, n / outline.length, count);
        error += (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      });
      expect(error).toBeLessThanOrEqual(previous + 1e-9);
      previous = error;
    }
  });
});

describe('paths', () => {
  it('resamples a closed path to evenly spaced points', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const points = resample(square, 8);
    expect(points).toHaveLength(8);
    expect(points[1]).toEqual({ x: 0.5, y: 0 });
    expect(points[5]).toEqual({ x: 0.5, y: 1 });
  });

  it('joins outlines by entering each at its point nearest the pen', () => {
    const long = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];
    const open = [
      { x: 5, y: 5 },
      { x: 20, y: 1 },
    ];
    const closed = [
      { x: 0, y: 9 },
      { x: 5, y: 6 },
      { x: 0, y: 9 },
    ];
    const joined = joinOutlines([open, closed, long]);
    expect(joined.slice(0, 4)).toEqual([long[0], long[1], open[1], open[0]]);
    // The closed outline is rotated to start and end at its nearest point.
    expect(joined[4]).toEqual({ x: 5, y: 6 });
    expect(joined[joined.length - 1]).toEqual({ x: 5, y: 6 });
  });
});
