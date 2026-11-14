/**
 * Discrete convolution in one and two dimensions.
 */

/**
 * Full convolution: y[n] = Σ_k f[k] g[n − k], for n = 0 .. len(f) + len(g) − 2.
 * Samples outside either sequence count as zero.
 */
export function convolve(f: ArrayLike<number>, g: ArrayLike<number>): number[] {
  if (f.length === 0 || g.length === 0) return [];
  const out = new Array<number>(f.length + g.length - 1).fill(0);
  for (let n = 0; n < out.length; n++) {
    const from = Math.max(0, n - g.length + 1);
    const to = Math.min(f.length - 1, n);
    let sum = 0;
    for (let k = from; k <= to; k++) sum += f[k] * g[n - k];
    out[n] = sum;
  }
  return out;
}

/**
 * One output pixel of a 3×3 convolution: Σ image[y − j][x − i] · kernel[j][i]
 * with i, j in −1..1, so the kernel is flipped in both directions. Pixels past
 * the border repeat the nearest edge pixel. The kernel is nine numbers, row by row.
 */
export function convolveAt(
  image: ArrayLike<number>,
  width: number,
  height: number,
  kernel: ArrayLike<number>,
  x: number,
  y: number,
): number {
  let sum = 0;
  for (let j = -1; j <= 1; j++) {
    const sy = Math.max(0, Math.min(height - 1, y - j));
    for (let i = -1; i <= 1; i++) {
      const sx = Math.max(0, Math.min(width - 1, x - i));
      sum += image[sy * width + sx] * kernel[(j + 1) * 3 + (i + 1)];
    }
  }
  return sum;
}

/** Convolves a whole greyscale image with a 3×3 kernel. The output has the same size. */
export function convolve2d(
  image: ArrayLike<number>,
  width: number,
  height: number,
  kernel: ArrayLike<number>,
): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = convolveAt(image, width, height, kernel, x, y);
    }
  }
  return out;
}

/** A sampled bell curve of the given odd width, scaled to sum to one. */
export function gaussianKernel(width: number): number[] {
  const mid = (width - 1) / 2;
  const sigma = Math.max(0.5, width / 5);
  const raw = Array.from({ length: width }, (_, i) =>
    Math.exp(-((i - mid) ** 2) / (2 * sigma ** 2)),
  );
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((v) => v / total);
}
