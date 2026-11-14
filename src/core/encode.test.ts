import { expect, it } from 'vitest';
import { packCells, packPoints, unpackCells, unpackPoints } from './encode';
import { seeded } from './random';

it('round-trips points and cells through their URL encodings', () => {
  const points = [
    { x: 0, y: 1 },
    { x: 0.25, y: 0.5 },
  ];
  const back = unpackPoints(packPoints(points));
  back.forEach((p, i) => {
    expect(p.x).toBeCloseTo(points[i].x, 2);
    expect(p.y).toBeCloseTo(points[i].y, 2);
  });
  const cells = [0, 0, 0, 0, 0, 0, 1, 2, 2, 63, 0, 0, 0, 0, 0];
  expect([...unpackCells(packCells(cells), cells.length)]).toEqual(cells);
  expect(unpackPoints('not-valid!')).toEqual([]);
});

it('gives the same random sequence for the same seed', () => {
  const a = seeded(42);
  const b = seeded(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  expect(seeded(43)()).not.toBe(seeded(42)());
});
