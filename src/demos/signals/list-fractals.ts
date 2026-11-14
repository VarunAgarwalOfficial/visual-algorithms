import type { DemoEntry } from '../layout';

export const fractalDemos: readonly DemoEntry[] = [
  {
    id: 'mandelbrot',
    title: 'Mandelbrot and Julia sets',
    summary:
      'Repeat z → z² + c and colour each point by how long it takes to escape; zoom in as far as the numbers allow.',
    keywords: 'fractal escape time julia orbit zoom complex plane smooth colouring',
    load: () => import('./mandelbrot'),
  },
  {
    id: 'newton-fractal',
    title: 'Newton fractal',
    summary:
      'Colour each starting point by the root that Newton’s method takes it to; the borders between basins are fractal.',
    keywords: 'newton raphson basins of attraction roots polynomial complex relaxation',
    load: () => import('./newton-fractal'),
  },
  {
    id: 'reaction-diffusion',
    title: 'Reaction-diffusion',
    summary:
      'Two chemicals that spread and react make spots, stripes and dividing cells from almost nothing.',
    keywords: 'gray scott turing patterns feed kill laplacian simulation',
    load: () => import('./reaction-diffusion'),
  },
  {
    id: 'life',
    title: 'Game of Life',
    summary:
      'Cells live or die by counting their eight neighbours; gliders, guns and chaos follow from that one rule.',
    keywords: 'conway cellular automaton highlife seeds day and night glider gosper gun life-like',
    load: () => import('./life'),
  },
  {
    id: 'cellular-automata',
    title: 'Elementary cellular automata',
    summary:
      'All 256 one-dimensional rules: each cell looks at itself and its two neighbours, row after row.',
    keywords: 'wolfram rule 30 90 110 184 sierpinski one-dimensional',
    load: () => import('./cellular-automata'),
  },
];
