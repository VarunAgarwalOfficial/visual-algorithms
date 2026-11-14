import type { DemoEntry } from '../layout';
import { analysisDemos } from './list-analysis';
import { fractalDemos } from './list-fractals';

export const demos: readonly DemoEntry[] = [
  {
    id: 'fourier',
    title: 'Fourier epicycles',
    summary:
      'Any closed outline can be drawn by a chain of circles turning at whole-number speeds.',
    keywords: 'dft series circles drawing svg',
    load: () => import('./fourier'),
  },
  ...analysisDemos,
  ...fractalDemos,
];
