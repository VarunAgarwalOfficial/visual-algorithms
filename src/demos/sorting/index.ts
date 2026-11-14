import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'sorting',
    title: 'Sorting',
    summary: 'Sorting algorithms one step at a time, with every comparison and move counted.',
    keywords:
      'bubble comb insertion shell selection merge timsort quick heap counting radix bogo sort stable colour wheel sound',
    load: () => import('./sorting'),
  },
  {
    id: 'sorting-race',
    title: 'Sorting race',
    summary:
      'Two to six sorting algorithms on the same array, one operation each per step, to see which finishes first.',
    keywords: 'compare algorithms race side by side quicksort merge heap shell timsort radix',
    load: () => import('./sorting-race'),
  },
];
