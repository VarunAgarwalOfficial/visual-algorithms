import { describe, expect, it } from 'vitest';
import { adaptiveContour } from './adaptive';
import { fieldAt, sampleField, type Ball } from './field';
import { CASE_SEGMENTS, cellSegments, marchingSquares, segmentsForCase } from './squares';

const ball = (x: number, y: number, radius: number): Ball => ({ x, y, radius, vx: 0, vy: 0 });

describe('metaball field', () => {
  it('is exactly 1 on the circle of a lone ball, and adds up for several', () => {
    expect(fieldAt([ball(10, 10, 5)], 15, 10)).toBeCloseTo(1);
    expect(fieldAt([ball(0, 0, 2), ball(8, 0, 2)], 4, 0)).toBeCloseTo(0.5);
  });
});

describe('marching squares', () => {
  it('joins the inside corners of a saddle only when the centre is inside', () => {
    expect(segmentsForCase(5, true)).toBe(CASE_SEGMENTS[10]);
    expect(segmentsForCase(5, false)).toBe(CASE_SEGMENTS[5]);
  });

  it('interpolates the crossing, or uses the midpoint when told not to', () => {
    // Top-left inside with value 3, others 0, threshold 1: crossing one third of the way out.
    expect(cellSegments(3, 0, 0, 0, 1, true)).toEqual([2 / 3, 0, 0, 2 / 3]);
    expect(cellSegments(3, 0, 0, 0, 1, false)).toEqual([0.5, 0, 0, 0.5]);
  });

  it('traces a closed loop around a ball: every endpoint is shared by two segments', () => {
    const grid = sampleField([ball(50, 50, 22)], 10, 10, 10);
    const segments = marchingSquares(grid, 1, true);
    const seen = new Map<string, number>();
    for (let k = 0; k < segments.length; k += 2) {
      const key = `${segments[k].toFixed(6)},${segments[k + 1].toFixed(6)}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    expect(segments.length).toBeGreaterThan(0);
    expect([...seen.values()].every((count) => count === 2)).toBe(true);
  });

  it('gives the same outline adaptively as on the full grid, with far fewer samples', () => {
    const balls = [ball(90, 100, 40), ball(210, 150, 55)];
    const cell = 5;
    const grid = sampleField(balls, 64, 48, cell);
    const uniform = marchingSquares(grid, 1, true).map((v) => v * cell);
    const adaptive = adaptiveContour((x, y) => fieldAt(balls, x, y), 320, 240, cell, 3, 1, true);
    const sorted = (segments: number[]) => {
      const out: string[] = [];
      for (let k = 0; k < segments.length; k += 4) {
        out.push(
          segments
            .slice(k, k + 4)
            .map((v) => v.toFixed(3))
            .join(),
        );
      }
      return out.sort();
    };
    expect(sorted(adaptive.segments)).toEqual(sorted(uniform));
    expect(adaptive.samples.length / 3).toBeLessThan((65 * 49) / 3);
  });
});
