import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'sorting',
    title: 'Sorting',
    summary: 'Sorting algorithms one step at a time, with every comparison and move counted.',
    lede: 'A sorting method putting a row of bars in order from shortest to tallest, one comparison at a time. Press Play to watch it, or Step forward to go at your own pace.',
    keywords:
      'bubble comb insertion shell selection merge timsort quick heap counting radix bogo sort stable colour wheel sound',
    load: () => import('./sorting'),
  },
  {
    id: 'sorting-race',
    title: 'Sorting race',
    summary:
      'Two to six sorting algorithms on the same array, one operation each per step, to see which finishes first.',
    lede: 'Several sorting methods each sorting the same row of bars, all taking one step at a time, so you can see which finishes first. Press Play to start the race.',
    keywords: 'compare algorithms race side by side quicksort merge heap shell timsort radix',
    load: () => import('./sorting-race'),
  },
];
