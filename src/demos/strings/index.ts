import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'edit-distance',
    title: 'Edit distance',
    summary:
      'The Levenshtein table between two words, filled cell by cell and traced back into an alignment.',
    lede: 'The fewest single-letter changes (insert, delete or replace) that turn one word into another, worked out in a table. Press Play to watch the table fill.',
    keywords:
      'levenshtein dynamic programming dp alignment insert delete substitute wagner fischer',
    load: () => import('./edit-distance'),
  },
  {
    id: 'lcs',
    title: 'Longest common subsequence',
    summary:
      'The LCS table of two strings, with the traceback joining the letters they share in order.',
    lede: 'The longest list of letters two words share in the same order, worked out in a table. Press Play to watch the table fill.',
    keywords: 'lcs dynamic programming dp diff subsequence',
    load: () => import('./lcs'),
  },
  {
    id: 'knapsack',
    title: 'Knapsack',
    summary:
      'The 0/1 knapsack table: for each item and capacity, take it or skip it, then read back what was packed.',
    lede: 'Which items to pack into a bag of limited weight for the greatest value, worked out in a table. Press Play to watch the table fill.',
    keywords: 'knapsack 0/1 unbounded dynamic programming dp subset',
    load: () => import('./knapsack'),
  },
  {
    id: 'string-matching',
    title: 'String matching',
    summary:
      'KMP and the Z algorithm finding a pattern in a text, with the comparisons a naive scan would repeat counted.',
    lede: 'A search for a short pattern in a longer text that avoids re-checking letters it has already matched. Press Play to watch the pattern slide along.',
    keywords:
      'kmp knuth morris pratt z function z algorithm prefix function failure table naive search',
    load: () => import('./string-matching'),
  },
  {
    id: 'huffman',
    title: 'Huffman coding',
    summary:
      'Building a Huffman tree by merging the two lightest subtrees, and the codes that fall out of it.',
    lede: 'A code that gives frequent letters short codes and rare ones long codes, built as a tree from the two rarest groups up. Press Play to watch the tree built.',
    keywords: 'huffman prefix code compression entropy priority queue greedy tree',
    load: () => import('./huffman'),
  },
];
