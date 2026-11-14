/**
 * The fast Fourier transform (iterative radix-2 Cooley-Tukey), a direct DFT to
 * compare it with, and a recorded run of the FFT for small inputs.
 */

export function isPowerOfTwo(n: number): boolean {
  return n >= 1 && (n & (n - 1)) === 0;
}

/** Reverses the lowest `bits` bits of `i`. */
export function bitReverse(i: number, bits: number): number {
  let out = 0;
  for (let b = 0; b < bits; b++) {
    out = (out << 1) | ((i >> b) & 1);
  }
  return out;
}

/**
 * In-place FFT of the complex signal (re, im). The length must be a power of
 * two. The inverse divides by N, so inverse(forward(x)) = x.
 */
export function fft(re: Float64Array | number[], im: Float64Array | number[], inverse = false) {
  const n = re.length;
  if (!isPowerOfTwo(n) || im.length !== n) throw new Error('Length must be a power of two');
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    const j = bitReverse(i, bits);
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2;
    const step = (sign * 2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** The definition, in N² multiplications: X[k] = Σ x[n] e^(-2πi kn/N). Any length. */
export function dft(re: ArrayLike<number>, im: ArrayLike<number>) {
  const n = re.length;
  const outRe = new Float64Array(n);
  const outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * ((k * t) % n)) / n;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      outRe[k] += re[t] * c - im[t] * s;
      outIm[k] += re[t] * s + im[t] * c;
    }
  }
  return { re: outRe, im: outIm };
}

/** Hann window: a raised cosine that brings both ends of the frame to zero. */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

export type FftStep =
  | { type: 'swap'; i: number; j: number }
  | {
      type: 'butterfly';
      /** 1-based stage; blocks have size 2^stage. */
      stage: number;
      /** Rows combined: a is the upper one. */
      a: number;
      b: number;
      /** The twiddle factor is e^(-2πi k / size). */
      k: number;
      size: number;
    };

export interface FftTrace {
  steps: FftStep[];
  /** states[p] is the working array after p steps; states[0] is the input. */
  states: { re: number[]; im: number[] }[];
}

/** Runs the forward FFT on a real signal and records every swap and butterfly. */
export function fftTrace(signal: readonly number[]): FftTrace {
  const n = signal.length;
  if (!isPowerOfTwo(n)) throw new Error('Length must be a power of two');
  const re = [...signal];
  const im = new Array<number>(n).fill(0);
  const steps: FftStep[] = [];
  const states = [{ re: [...re], im: [...im] }];
  const record = (step: FftStep) => {
    steps.push(step);
    states.push({ re: [...re], im: [...im] });
  };
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    const j = bitReverse(i, bits);
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      record({ type: 'swap', i, j });
    }
  }
  for (let size = 2, stage = 1; size <= n; size *= 2, stage++) {
    const half = size / 2;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = (-2 * Math.PI * k) / size;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const a = start + k;
        const b = a + half;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        record({ type: 'butterfly', stage, a, b, k, size });
      }
    }
  }
  return { steps, states };
}
