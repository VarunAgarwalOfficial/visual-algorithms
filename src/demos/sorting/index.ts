import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'sorting',
    title: 'Sorting',
    summary: 'Sorting algorithms one step at a time, with every comparison and move counted.',
    keywords: 'bubble insertion selection merge quick heap sort',
    load: () => import('./sorting'),
  },
];
