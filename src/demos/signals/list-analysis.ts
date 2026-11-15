import type { DemoEntry } from '../layout';

export const analysisDemos: readonly DemoEntry[] = [
  {
    id: 'fft',
    title: 'Fast Fourier transform',
    summary:
      'Draw a signal, see its spectrum, filter it, and step through the butterflies that compute it.',
    lede: 'A signal (the wavy line) split into the pure waves it is made of, shown as bars. Draw on the signal to change it and watch the bars change.',
    keywords:
      'fft dft cooley-tukey radix-2 butterfly bit reversal spectrum frequency low-pass high-pass filter hann window leakage',
    load: () => import('./fft'),
  },
  {
    id: 'convolution',
    title: 'Convolution',
    summary: 'A flipped kernel slides over a signal or an image; each output is a sum of products.',
    lede: 'A small list of weights slides along a signal or image, and each output is the weighted sum under it. Press Play to watch it slide.',
    keywords:
      'convolve kernel filter blur sharpen sobel edge detection emboss moving average impulse response image',
    load: () => import('./convolution'),
  },
  {
    id: 'l-systems',
    title: 'L-systems',
    summary:
      'A string rewritten by simple rules, then drawn by a turtle, grows into curves and plants.',
    lede: 'A drawing made by rewriting a short string of letters by simple rules, then following the letters as pen moves. Press Play to watch the pen draw.',
    keywords:
      'lindenmayer turtle graphics koch snowflake sierpinski dragon hilbert gosper penrose plant rewriting grammar',
    load: () => import('./l-systems'),
  },
  {
    id: 'noise',
    title: 'Perlin and simplex noise',
    summary: 'Smooth random fields built from gradients on a lattice, layered into fractal detail.',
    lede: 'Smooth random patterns of the kind used for terrain and clouds, built from random slopes on a grid. Press Play to watch one value worked out, or drag the sample point.',
    keywords:
      'perlin simplex value noise gradient fbm fractal brownian motion octaves terrain procedural',
    load: () => import('./noise'),
  },
];
