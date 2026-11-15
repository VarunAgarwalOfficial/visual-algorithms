import type { DemoEntry } from '../layout';

export const fractalDemos: readonly DemoEntry[] = [
  {
    id: 'mandelbrot',
    title: 'Mandelbrot and Julia sets',
    summary:
      'Repeat z → z² + c and colour each point by how long it takes to escape; zoom in as far as the numbers allow.',
    lede: 'A picture made by repeating one simple sum at every point and shading the point by how quickly the result grows; the points where it never grows form the Mandelbrot set. Drag the picture to move around, and scroll to zoom in.',
    keywords: 'fractal escape time julia orbit zoom complex plane smooth colouring',
    load: () => import('./mandelbrot'),
  },
  {
    id: 'newton-fractal',
    title: 'Newton fractal',
    summary:
      'Colour each starting point by the root that Newton’s method takes it to; the borders between basins are fractal.',
    lede: 'Each point is coloured by which answer of an equation a guessing method reaches from there. Click the picture to see the guesses made from that point.',
    keywords: 'newton raphson basins of attraction roots polynomial complex relaxation',
    load: () => import('./newton-fractal'),
  },
  {
    id: 'reaction-diffusion',
    title: 'Reaction-diffusion',
    summary:
      'Two chemicals that spread and react make spots, stripes and dividing cells from almost nothing.',
    lede: 'Two simulated chemicals that spread and react, growing spots and stripes from a small seed. Press Play to let them grow.',
    keywords: 'gray scott turing patterns feed kill laplacian simulation',
    load: () => import('./reaction-diffusion'),
  },
  {
    id: 'life',
    title: 'Game of Life',
    summary:
      'Cells live or die by counting their eight neighbours; gliders, guns and chaos follow from that one rule.',
    lede: 'A grid of cells that live or die each turn by counting their living neighbours. Press Play to watch the generations.',
    keywords: 'conway cellular automaton highlife seeds day and night glider gosper gun life-like',
    load: () => import('./life'),
  },
  {
    id: 'cellular-automata',
    title: 'Elementary cellular automata',
    summary:
      'All 256 one-dimensional rules: each cell looks at itself and its two neighbours, row after row.',
    lede: 'A row of cells, each turned on or off by a rule that looks at it and its two neighbours, drawn row after row downwards. Press Play to grow the rows.',
    keywords: 'wolfram rule 30 90 110 184 sierpinski one-dimensional',
    load: () => import('./cellular-automata'),
  },
];
