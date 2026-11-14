import { describe, expect, it } from 'vitest';
import type { Point } from '../geometry';
import {
  dft,
  epicycleChain,
  evaluate,
  idft,
  signedFrequency,
  toEpicycles,
  traceCurve,
} from './dft';

const TAU = 2 * Math.PI;

function randomSamples(n: number, seed = 1): Point[] {
  let s = seed;
  const next = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296 - 0.5;
  };
  return Array.from({ length: n }, () => ({ x: next(), y: next() }));
}

function expectClose(actual: Point, expected: Point, digits = 9) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
}

describe('dft', () => {
  it('returns an empty spectrum for no samples', () => {
    expect(dft([])).toEqual([]);
  });

  it('puts a constant signal entirely in bin 0', () => {
    const c = dft(Array.from({ length: 8 }, () => ({ x: 2, y: -3 })));
    expectClose(c[0], { x: 2, y: -3 });
    for (const z of c.slice(1)) expectClose(z, { x: 0, y: 0 });
  });

  it('puts a single complex exponential in a single bin', () => {
    const n = 16;
    const k0 = 3;
    const samples = Array.from({ length: n }, (_, j) => ({
      x: 0.5 * Math.cos((TAU * k0 * j) / n + 0.7),
      y: 0.5 * Math.sin((TAU * k0 * j) / n + 0.7),
    }));
    const c = dft(samples);
    c.forEach((z, k) => {
      const magnitude = Math.hypot(z.x, z.y);
      expect(magnitude).toBeCloseTo(k === k0 ? 0.5 : 0, 9);
    });
    expect(Math.atan2(c[k0].y, c[k0].x)).toBeCloseTo(0.7, 9);
  });

  it('matches a hand-computed transform', () => {
    // z = [1, i, -1, -i] is e^(2*pi*i*n/4): everything in bin 1.
    const c = dft([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ]);
    expectClose(c[0], { x: 0, y: 0 });
    expectClose(c[1], { x: 1, y: 0 });
    expectClose(c[2], { x: 0, y: 0 });
    expectClose(c[3], { x: 0, y: 0 });
  });

  it('is linear', () => {
    const a = randomSamples(12, 1);
    const b = randomSamples(12, 2);
    const sum = a.map((p, i) => ({ x: 2 * p.x + b[i].x, y: 2 * p.y + b[i].y }));
    const ca = dft(a);
    const cb = dft(b);
    dft(sum).forEach((z, k) =>
      expectClose(z, { x: 2 * ca[k].x + cb[k].x, y: 2 * ca[k].y + cb[k].y }),
    );
  });

  it('round-trips through the inverse, for even and odd lengths', () => {
    for (const n of [1, 2, 7, 64, 101]) {
      const samples = randomSamples(n, n);
      idft(dft(samples)).forEach((z, i) => expectClose(z, samples[i]));
    }
  });

  it('satisfies Parseval: mean power equals the sum of squared coefficients', () => {
    const samples = randomSamples(50, 9);
    const power = samples.reduce((s, z) => s + z.x * z.x + z.y * z.y, 0) / samples.length;
    const spectral = dft(samples).reduce((s, z) => s + z.x * z.x + z.y * z.y, 0);
    expect(spectral).toBeCloseTo(power, 9);
  });
});

describe('signedFrequency', () => {
  it('maps the upper half of the bins to negative frequencies', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((k) => signedFrequency(k, 8))).toEqual([
      0, 1, 2, 3, 4, -3, -2, -1,
    ]);
    expect([0, 1, 2, 3, 4].map((k) => signedFrequency(k, 5))).toEqual([0, 1, 2, -2, -1]);
  });
});

describe('epicycles', () => {
  const samples = randomSamples(32, 5);
  const epicycles = toEpicycles(dft(samples));

  it('puts the constant term first and sorts the rest by amplitude', () => {
    expect(epicycles).toHaveLength(32);
    expect(epicycles[0].frequency).toBe(0);
    for (let i = 2; i < epicycles.length; i++) {
      expect(epicycles[i].amplitude).toBeLessThanOrEqual(epicycles[i - 1].amplitude);
    }
    expect(new Set(epicycles.map((e) => e.frequency)).size).toBe(32);
  });

  it('reproduces every sample when all terms are used', () => {
    samples.forEach((z, j) => expectClose(evaluate(epicycles, j / samples.length, 31), z));
  });

  it('gives the centroid when no circles are used', () => {
    const mean = {
      x: samples.reduce((s, z) => s + z.x, 0) / samples.length,
      y: samples.reduce((s, z) => s + z.y, 0) / samples.length,
    };
    expectClose(evaluate(epicycles, 0.3, 0), mean);
  });

  it('never gets worse, in mean squared error, as circles are added', () => {
    const error = (circles: number) =>
      samples.reduce((s, z, j) => {
        const p = evaluate(epicycles, j / samples.length, circles);
        return s + (p.x - z.x) ** 2 + (p.y - z.y) ** 2;
      }, 0);
    for (let m = 1; m < 32; m++) expect(error(m)).toBeLessThanOrEqual(error(m - 1) + 1e-12);
    expect(error(31)).toBeCloseTo(0, 12);
  });

  it('builds a chain whose links have the epicycle radii', () => {
    const chain = epicycleChain(epicycles, 0.42, 5);
    expect(chain).toHaveLength(7);
    expect(chain[0]).toEqual({ x: 0, y: 0 });
    for (let i = 0; i < 6; i++) {
      const length = Math.hypot(chain[i + 1].x - chain[i].x, chain[i + 1].y - chain[i].y);
      expect(length).toBeCloseTo(epicycles[i].amplitude, 12);
    }
  });

  it('traces a curve that agrees with evaluate and is periodic', () => {
    const curve = traceCurve(epicycles, 10, 64);
    expect(curve).toHaveLength(128);
    for (const i of [0, 13, 63]) {
      expectClose({ x: curve[i * 2], y: curve[i * 2 + 1] }, evaluate(epicycles, i / 64, 10));
    }
    expectClose(evaluate(epicycles, 1, 10), evaluate(epicycles, 0, 10));
  });

  it('stays smooth between samples for a band-limited curve', () => {
    // A circle traversed once, sampled coarsely. With unsigned frequencies the
    // reconstruction would be exact at samples but wrong in between.
    const n = 8;
    const circle = Array.from({ length: n }, (_, j) => ({
      x: Math.cos((-TAU * j) / n),
      y: Math.sin((-TAU * j) / n),
    }));
    const e = toEpicycles(dft(circle));
    const p = evaluate(e, 0.5 / n, n - 1);
    expectClose(p, { x: Math.cos(-TAU * (0.5 / n)), y: Math.sin(-TAU * (0.5 / n)) });
  });
});
