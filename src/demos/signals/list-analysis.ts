import type { DemoEntry } from '../layout';

export const analysisDemos: readonly DemoEntry[] = [
  {
    id: 'fft',
    title: 'Fast Fourier transform',
    summary:
      'Draw a signal, see its spectrum, filter it, and step through the butterflies that compute it.',
    keywords:
      'fft dft cooley-tukey radix-2 butterfly bit reversal spectrum frequency low-pass high-pass filter hann window leakage',
    load: () => import('./fft'),
  },
  {
    id: 'convolution',
    title: 'Convolution',
    summary: 'A flipped kernel slides over a signal or an image; each output is a sum of products.',
    keywords:
      'convolve kernel filter blur sharpen sobel edge detection emboss moving average impulse response image',
    load: () => import('./convolution'),
  },
  {
    id: 'l-systems',
    title: 'L-systems',
    summary:
      'A string rewritten by simple rules, then drawn by a turtle, grows into curves and plants.',
    keywords:
      'lindenmayer turtle graphics koch snowflake sierpinski dragon hilbert gosper penrose plant rewriting grammar',
    load: () => import('./l-systems'),
  },
  {
    id: 'noise',
    title: 'Perlin and simplex noise',
    summary: 'Smooth random fields built from gradients on a lattice, layered into fractal detail.',
    keywords:
      'perlin simplex value noise gradient fbm fractal brownian motion octaves terrain procedural',
    load: () => import('./noise'),
  },
];
