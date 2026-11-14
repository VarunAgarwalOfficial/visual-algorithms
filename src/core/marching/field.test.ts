import { describe, expect, it } from 'vitest';
import { createBalls, fieldAt, sampleField, stepBalls, type Ball } from './field';

const ball = (over: Partial<Ball> = {}): Ball => ({ x: 0, y: 0, radius: 2, vx: 0, vy: 0, ...over });

describe('fieldAt', () => {
  it('is exactly 1 on the circle of a lone ball', () => {
    const balls = [ball({ x: 3, y: 4 })];
    expect(fieldAt(balls, 5, 4)).toBeCloseTo(1, 12);
    expect(fieldAt(balls, 3, 2)).toBeCloseTo(1, 12);
    expect(fieldAt(balls, 3, 5)).toBeGreaterThan(1);
    expect(fieldAt(balls, 3, 8)).toBeLessThan(1);
  });

  it('adds the contributions of several balls', () => {
    const a = ball({ x: -3 });
    const b = ball({ x: 3, radius: 1 });
    expect(fieldAt([a, b], 0, 1)).toBeCloseTo(fieldAt([a], 0, 1) + fieldAt([b], 0, 1), 12);
  });

  it('stays finite at a centre and is zero with no balls', () => {
    expect(Number.isFinite(fieldAt([ball()], 0, 0))).toBe(true);
    expect(fieldAt([], 1, 1)).toBe(0);
  });
});

describe('sampleField', () => {
  it('samples every corner in row order', () => {
    const balls = [ball({ x: 10, y: 5 })];
    const grid = sampleField(balls, 3, 2, 5);
    expect(grid.values).toHaveLength(4 * 3);
    expect(grid.values[1 * 4 + 3]).toBeCloseTo(fieldAt(balls, 15, 5), 5);
    expect(grid.values[2 * 4 + 0]).toBeCloseTo(fieldAt(balls, 0, 10), 5);
  });
});

describe('stepBalls', () => {
  it('moves balls by velocity times dt', () => {
    const balls = [ball({ x: 50, y: 50, vx: 10, vy: -20 })];
    stepBalls(balls, 0.5, 100, 100);
    expect(balls[0]).toMatchObject({ x: 55, y: 40, vx: 10, vy: -20 });
  });

  it('bounces off each wall and stays inside the box', () => {
    const balls = [
      ball({ x: 97, y: 50, vx: 10 }),
      ball({ x: 3, y: 50, vx: -10 }),
      ball({ x: 50, y: 97, vy: 10 }),
      ball({ x: 50, y: 3, vy: -10 }),
    ];
    stepBalls(balls, 1, 100, 100);
    expect(balls.map((b) => [b.x, b.y, b.vx, b.vy])).toEqual([
      [98, 50, -10, 0],
      [2, 50, 10, 0],
      [50, 98, 0, -10],
      [50, 2, 0, 10],
    ]);
  });

  it('keeps balls in bounds over a long run', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const balls = createBalls(8, 300, 200, random);
    for (let i = 0; i < 2000; i++) stepBalls(balls, 1 / 60, 300, 200);
    for (const b of balls) {
      expect(b.x).toBeGreaterThanOrEqual(b.radius);
      expect(b.x).toBeLessThanOrEqual(300 - b.radius);
      expect(b.y).toBeGreaterThanOrEqual(b.radius);
      expect(b.y).toBeLessThanOrEqual(200 - b.radius);
    }
  });
});
