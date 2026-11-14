import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'edit-distance',
    title: 'Edit distance',
    summary:
      'The Levenshtein table between two words, filled cell by cell and traced back into an alignment.',
    keywords:
      'levenshtein dynamic programming dp alignment insert delete substitute wagner fischer',
    load: () => import('./edit-distance'),
  },
  {
    id: 'lcs',
    title: 'Longest common subsequence',
    summary:
      'The LCS table of two strings, with the traceback joining the letters they share in order.',
    keywords: 'lcs dynamic programming dp diff subsequence',
    load: () => import('./lcs'),
  },
  {
    id: 'knapsack',
    title: 'Knapsack',
    summary:
      'The 0/1 knapsack table: for each item and capacity, take it or skip it, then read back what was packed.',
    keywords: 'knapsack 0/1 unbounded dynamic programming dp subset',
    load: () => import('./knapsack'),
  },
  {
    id: 'string-matching',
    title: 'String matching',
    summary:
      'KMP and the Z algorithm finding a pattern in a text, with the comparisons a naive scan would repeat counted.',
    keywords:
      'kmp knuth morris pratt z function z algorithm prefix function failure table naive search',
    load: () => import('./string-matching'),
  },
  {
    id: 'huffman',
    title: 'Huffman coding',
    summary:
      'Building a Huffman tree by merging the two lightest subtrees, and the codes that fall out of it.',
    keywords: 'huffman prefix code compression entropy priority queue greedy tree',
    load: () => import('./huffman'),
  },
];
