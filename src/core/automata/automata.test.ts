import { describe, expect, it } from 'vitest';
import { escapeTime, inMainBulbs } from '../fractals/escape';
import { NO_ROOT, newtonBasin, polyRoots } from '../fractals/newton';
import { neighbourhood, ruleTable, runElementary } from './elementary';
import { createGrayScott, paintB, stepGrayScott } from './grayscott';
import { packBits, parseRle, parseRule, placePattern, stepLife, unpackBits } from './life';

const LIFE = parseRule('B3/S23');

function generations(cells: Uint8Array, w: number, h: number, count: number): Uint8Array {
  let now = cells;
  for (let g = 0; g < count; g++) {
    const next = new Uint8Array(now.length);
    stepLife(now, next, w, h, LIFE, true);
    now = next;
  }
  return now;
}

describe('elementary automata', () => {
  it('reads rule bits by neighbourhood, left cell as the high bit', () => {
    // Rule 30 = 00011110: on for 100, 011, 010, 001.
    expect([...ruleTable(30)]).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
    expect(neighbourhood(1, 0, 0)).toBe(4);
  });

  it('rule 90 draws Pascal’s triangle mod 2', () => {
    const first = new Uint8Array(33);
    first[16] = 1;
    const grid = runElementary(first, 90, 16, false);
    const row = (r: number) => [...grid.subarray(r * 33, (r + 1) * 33)];
    expect(row(1).join('')).toBe('0'.repeat(15) + '101' + '0'.repeat(15));
    // Row 2^k - 1 is fully alternating, row 2^k has just two cells.
    expect(row(15).filter(Boolean).length).toBe(16);
    expect(row(8).filter(Boolean).length).toBe(2);
  });
});

describe('life', () => {
  it('a blinker has period 2', () => {
    const cells = new Uint8Array(25);
    placePattern(cells, 5, 5, parseRle('3o!'), 2.5, 2.5);
    const one = generations(cells, 5, 5, 1);
    expect(one).not.toEqual(cells);
    expect(one.reduce((s, v) => s + v, 0)).toBe(3);
    expect(generations(cells, 5, 5, 2)).toEqual(cells);
  });

  it('a glider moves one cell diagonally every 4 generations', () => {
    const w = 12;
    const cells = new Uint8Array(w * w);
    placePattern(cells, w, w, parseRle('bob$2bo$3o!'), 4, 4);
    const moved = new Uint8Array(w * w);
    for (let i = 0; i < cells.length; i++) if (cells[i]) moved[i + w + 1] = 1;
    expect(generations(cells, w, w, 4)).toEqual(moved);
  });

  it('a blinker across the seam survives on a torus and dies with bounded edges', () => {
    const cells = new Uint8Array(25);
    cells[2 * 5 + 4] = cells[2 * 5] = cells[2 * 5 + 1] = 1; // x = 4, 0, 1 on row 2
    expect(stepLife(cells, new Uint8Array(25), 5, 5, LIFE, true)).toBe(3);
    expect(stepLife(cells, new Uint8Array(25), 5, 5, LIFE, false)).toBe(0);
    expect(unpackBits(packBits(cells), 25)).toEqual(cells);
  });
});

describe('gray-scott', () => {
  it('leaves the uniform state A = 1, B = 0 unchanged', () => {
    const grid = createGrayScott(16, 12);
    for (let i = 0; i < 20; i++) stepGrayScott(grid, { feed: 0.037, kill: 0.06, da: 1, db: 0.5 });
    expect(Math.min(...grid.a)).toBeCloseTo(1, 6);
    expect(Math.max(...grid.b)).toBe(0);
  });

  it('a seed of B spreads and stays bounded', () => {
    const grid = createGrayScott(48, 48);
    paintB(grid, 24, 24, 4);
    for (let i = 0; i < 600; i++) stepGrayScott(grid, { feed: 0.037, kill: 0.06, da: 1, db: 0.5 });
    expect(grid.b[2 * 48 + 2]).toBeLessThan(0.01);
    expect(grid.b.filter((v) => v > 0.1).length).toBeGreaterThan(50);
    expect(Math.max(...grid.a, ...grid.b)).toBeLessThanOrEqual(1.0001);
  });
});

describe('fractals', () => {
  it('counts escape steps', () => {
    expect(escapeTime(0, 0, 0, 0, 500)).toBe(-1);
    expect(escapeTime(0, 0, -1, 0, 500)).toBe(-1);
    // c = 1: 1, 2, 5, 26, 677, so the fifth step passes radius 256.
    expect(Math.ceil(escapeTime(0, 0, 1, 0, 500))).toBe(5);
    expect(inMainBulbs(-0.1, 0.2)).toBe(true);
    expect(inMainBulbs(0.3, 0.5)).toBe(false);
  });

  it('Newton sends a start near a root to that root', () => {
    const roots = polyRoots([1, 0, 0, -1]);
    expect(roots).toHaveLength(3);
    roots.forEach((r, i) => {
      // r^3 = 1
      expect(r.x * r.x * r.x - 3 * r.x * r.y * r.y).toBeCloseTo(1, 9);
      const hit = newtonBasin(r.x + 0.05, r.y - 0.04, roots, 1, 40);
      expect(hit >> 8).toBe(i);
      expect(hit & 255).toBeLessThan(6);
    });
  });

  it('z^3 - 2z + 2 traps the origin in the cycle 0, 1, 0, 1', () => {
    const roots = polyRoots([1, 0, -2, 2]);
    const real = roots.find((r) => Math.abs(r.y) < 1e-9);
    expect(real?.x).toBeCloseTo(-1.769292, 5);
    expect(newtonBasin(0, 0, roots, 1, 200)).toBe(NO_ROOT);
    expect(newtonBasin(-2, 0, roots, 1, 200)).not.toBe(NO_ROOT);
  });
});
