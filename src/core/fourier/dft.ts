import type { Point } from '../geometry';

const TAU = 2 * Math.PI;

/**
 * Discrete Fourier transform of a closed curve sampled as complex numbers.
 *
 *   c_k = (1/N) * sum_n z_n * e^(-2*pi*i*k*n/N)
 *
 * The 1/N factor is applied here, so the inverse is a plain sum. The direct
 * O(N^2) form is used on purpose: N is a few hundred and any N is accepted.
 */
export function dft(samples: readonly Point[]): Point[] {
  const n = samples.length;
  const out: Point[] = [];
  for (let k = 0; k < n; k++) {
    let re = 0;
    let im = 0;
    for (let j = 0; j < n; j++) {
      // Reduce k*j modulo n first to keep the angle small and precise.
      const angle = (-TAU * ((k * j) % n)) / n;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const z = samples[j];
      re += z.x * c - z.y * s;
      im += z.x * s + z.y * c;
    }
    out.push({ x: re / n, y: im / n });
  }
  return out;
}

/** Inverse of {@link dft}: z_n = sum_k c_k * e^(2*pi*i*k*n/N). */
export function idft(coefficients: readonly Point[]): Point[] {
  const n = coefficients.length;
  const out: Point[] = [];
  for (let j = 0; j < n; j++) {
    let re = 0;
    let im = 0;
    for (let k = 0; k < n; k++) {
      const angle = (TAU * ((k * j) % n)) / n;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const z = coefficients[k];
      re += z.x * c - z.y * s;
      im += z.x * s + z.y * c;
    }
    out.push({ x: re, y: im });
  }
  return out;
}

/**
 * Bin k and bin k - N are the same frequency at the sample points, but not
 * between them. Mapping the upper half to negative frequencies picks the
 * slowest rotation for every bin, which keeps the curve smooth between samples.
 */
export function signedFrequency(k: number, n: number): number {
  return k <= n / 2 ? k : k - n;
}

/** One rotating vector: radius `amplitude`, `frequency` turns per lap, starting at `phase`. */
export interface Epicycle {
  frequency: number;
  amplitude: number;
  phase: number;
}

/**
 * Turns DFT coefficients into epicycles. The constant term (frequency 0) comes
 * first; the rest are ordered largest first, so the first m circles are the
 * best m-circle approximation in the least-squares sense.
 */
export function toEpicycles(coefficients: readonly Point[]): Epicycle[] {
  const n = coefficients.length;
  const all = coefficients.map((c, k) => ({
    frequency: signedFrequency(k, n),
    amplitude: Math.hypot(c.x, c.y),
    phase: Math.atan2(c.y, c.x),
  }));
  const constant = all.filter((e) => e.frequency === 0);
  const rotating = all
    .filter((e) => e.frequency !== 0)
    .sort((a, b) => b.amplitude - a.amplitude || Math.abs(a.frequency) - Math.abs(b.frequency));
  return [...constant, ...rotating];
}

/**
 * Tip-to-tail positions of the constant term plus the first `circles` rotating
 * vectors at time t in [0, 1). Returns circles + 2 points: the origin, the
 * centre of the first circle, and the tip of each circle in turn.
 */
export function epicycleChain(epicycles: readonly Epicycle[], t: number, circles: number): Point[] {
  const count = Math.min(epicycles.length, circles + 1);
  const chain: Point[] = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;
  for (let i = 0; i < count; i++) {
    const e = epicycles[i];
    const angle = TAU * e.frequency * t + e.phase;
    x += e.amplitude * Math.cos(angle);
    y += e.amplitude * Math.sin(angle);
    chain.push({ x, y });
  }
  return chain;
}

/** The pen position: the end of the chain. */
export function evaluate(epicycles: readonly Epicycle[], t: number, circles: number): Point {
  const chain = epicycleChain(epicycles, t, circles);
  return chain[chain.length - 1];
}

/** One full lap of the pen, as `count` evenly timed points packed [x0, y0, x1, y1, ...]. */
export function traceCurve(
  epicycles: readonly Epicycle[],
  circles: number,
  count: number,
): Float64Array {
  const used = Math.min(epicycles.length, circles + 1);
  const out = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    const t = i / count;
    let x = 0;
    let y = 0;
    for (let j = 0; j < used; j++) {
      const e = epicycles[j];
      const angle = TAU * e.frequency * t + e.phase;
      x += e.amplitude * Math.cos(angle);
      y += e.amplitude * Math.sin(angle);
    }
    out[i * 2] = x;
    out[i * 2 + 1] = y;
  }
  return out;
}
