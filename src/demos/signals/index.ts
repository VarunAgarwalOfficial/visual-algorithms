import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'fourier',
    title: 'Fourier epicycles',
    summary:
      'Any closed outline can be drawn by a chain of circles turning at whole-number speeds.',
    keywords: 'dft series circles drawing svg',
    load: () => import('./fourier'),
  },
];
