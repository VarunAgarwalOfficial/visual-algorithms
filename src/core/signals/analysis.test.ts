import { describe, expect, it } from 'vitest';
import { convolve, convolve2d } from './convolution';
import { dft, fft, fftTrace } from './fft';
import { expand, parseRules, turtle } from './lsystem';
import { createNoise, fbm } from './noise';

describe('fft', () => {
  const signal = Array.from({ length: 16 }, (_, i) => Math.sin(i * 0.9) + 0.3 * ((i * 7) % 5));

  it('matches the direct DFT', () => {
    const re = [...signal];
    const im = signal.map((_, i) => 0.1 * i);
    const want = dft(re, im);
    fft(re, im);
    for (let k = 0; k < 16; k++) {
      expect(re[k]).toBeCloseTo(want.re[k], 9);
      expect(im[k]).toBeCloseTo(want.im[k], 9);
    }
  });

  it('round-trips through the inverse', () => {
    const re = [...signal];
    const im = new Array<number>(16).fill(0);
    fft(re, im);
    fft(re, im, true);
    re.forEach((v, i) => expect(v).toBeCloseTo(signal[i], 9));
    im.forEach((v) => expect(v).toBeCloseTo(0, 9));
  });

  it('records a trace that ends at the spectrum', () => {
    const { steps, states } = fftTrace(signal.slice(0, 8));
    expect(steps.filter((s) => s.type === 'butterfly')).toHaveLength(12); // N/2 · log2 N
    expect(steps.filter((s) => s.type === 'swap')).toHaveLength(2);
    const want = dft(signal.slice(0, 8), new Array<number>(8).fill(0));
    const last = states[states.length - 1];
    last.re.forEach((v, k) => expect(v).toBeCloseTo(want.re[k], 9));
    last.im.forEach((v, k) => expect(v).toBeCloseTo(want.im[k], 9));
  });
});

describe('convolution', () => {
  it('leaves a signal unchanged when convolved with a delta', () => {
    expect(convolve([3, -1, 4, 1, 5], [1])).toEqual([3, -1, 4, 1, 5]);
    expect(convolve([3, -1, 4], [0, 1])).toEqual([0, 3, -1, 4]);
  });

  it('flips the kernel: a known asymmetric case', () => {
    // (1 + 2x + 3x²)(1 − x) = 1 + x + x² − 3x³
    expect(convolve([1, 2, 3], [1, -1])).toEqual([1, 1, 1, -3]);
    expect(convolve([1, -1], [1, 2, 3])).toEqual([1, 1, 1, -3]);
  });

  it('convolves images: identity, and an off-centre kernel shifts the picture', () => {
    const image = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    expect([...convolve2d(image, 4, 3, [0, 0, 0, 0, 1, 0, 0, 0, 0])]).toEqual(image);
    // A one in the kernel's right-hand column moves the dot one pixel right.
    const shifted = convolve2d(image, 4, 3, [0, 0, 0, 0, 0, 1, 0, 0, 0]);
    expect([...shifted]).toEqual([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  });
});

describe('l-systems', () => {
  it('expands the algae system into Fibonacci lengths', () => {
    const { rules } = parseRules('A=AB; B=A');
    const result = expand('A', rules, 5);
    expect(result.text).toBe('ABAABABAABAAB');
    expect(result.lengths).toEqual([1, 2, 3, 5, 8, 13]);
  });

  it('draws 3·4ⁿ segments for the Koch snowflake and closes the curve', () => {
    const { rules } = parseRules('F=F-F++F-F');
    const path = turtle(expand('F++F++F', rules, 3).text, 60);
    expect(path.count).toBe(3 * 4 ** 3);
    const end = path.segments.subarray(path.segments.length - 2);
    expect(end[0]).toBeCloseTo(0, 3);
    expect(end[1]).toBeCloseTo(0, 3);
  });

  it('stops at the length cap and rejects bad rules', () => {
    const { rules } = parseRules('F=FFFF');
    const result = expand('F', rules, 50, 1000);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1000);
    expect(parseRules('F+F').error).toBeDefined();
    expect(parseRules('F=F*F').error).toBeDefined();
  });

  it('restores the turtle on a closing bracket', () => {
    const path = turtle('F[+F]F]', 90);
    expect([...path.segments]).toEqual([0, 0, 1, 0, 1, 0, 1, 1, 1, 0, 2, 0].map(Math.fround));
  });
});

describe('noise', () => {
  it('is fixed by the seed', () => {
    const a = createNoise(42);
    const b = createNoise(42);
    const c = createNoise(43);
    expect(a.perlin(1.3, 2.7)).toBe(b.perlin(1.3, 2.7));
    expect(a.simplex(1.3, 2.7)).toBe(b.simplex(1.3, 2.7));
    expect(a.perlin(1.3, 2.7)).not.toBe(c.perlin(1.3, 2.7));
  });

  it('stays in [-1, 1] and actually varies', () => {
    const n = createNoise(7);
    for (const kind of ['perlin', 'simplex', 'value'] as const) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 4000; i++) {
        const v = fbm((x, y) => n[kind](x, y), i * 0.173, i * 0.071 - 20, 3, 0.5, 2);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      expect(lo).toBeGreaterThanOrEqual(-1);
      expect(hi).toBeLessThanOrEqual(1);
      expect(hi - lo).toBeGreaterThan(0.5);
    }
  });

  it('Perlin noise is zero at lattice points', () => {
    const n = createNoise(3);
    for (let i = -3; i < 6; i++) {
      for (let j = -3; j < 6; j++) expect(Math.abs(n.perlin(i, j))).toBe(0);
    }
  });

  it('corner contributions add up to the noise value', () => {
    const n = createNoise(11);
    for (const kind of ['perlin', 'simplex', 'value'] as const) {
      const sum = n.corners(kind, 2.37, -1.82).reduce((a, c) => a + c.contribution, 0);
      expect(sum).toBeCloseTo(n[kind](2.37, -1.82), 9);
    }
  });
});
