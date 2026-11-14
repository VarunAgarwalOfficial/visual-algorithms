import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'binary-heap',
    title: 'Binary heap',
    summary:
      'A priority queue shown as a tree and as the array that stores it, with sift-up, sift-down and heap building.',
    keywords: 'priority queue min-heap max-heap heapify floyd sift up sift down extract-min array',
    load: () => import('./binary-heap'),
  },
  {
    id: 'bst',
    title: 'Binary search trees',
    summary:
      'Plain, AVL and red-black trees on the same keys, with every rotation and recolouring shown.',
    keywords: 'bst avl red-black rotation balance factor self-balancing tree insert delete',
    load: () => import('./bst'),
  },
  {
    id: 'b-tree',
    title: 'B-tree',
    summary: 'Wide nodes that split when they overflow and borrow or merge when they run low.',
    keywords: 'btree 2-3-4 tree split merge borrow minimum degree database index',
    load: () => import('./b-tree'),
  },
  {
    id: 'trie',
    title: 'Trie',
    summary:
      'Words stored letter by letter, so a shared prefix is stored once and completions are a subtree.',
    keywords: 'prefix tree radix tree autocomplete dictionary words completion',
    load: () => import('./trie'),
  },
  {
    id: 'union-find',
    title: 'Union-find',
    summary:
      'Disjoint sets as a forest of parent pointers, with union by rank and path compression.',
    keywords:
      'disjoint set union dsu forest path compression union by rank size find connected components',
    load: () => import('./union-find'),
  },
  {
    id: 'hash-table',
    title: 'Hash table',
    summary:
      'Collisions resolved by linear, quadratic or double-hash probing, or by chaining, one probe at a time.',
    keywords:
      'hashing open addressing linear probing quadratic double hashing chaining tombstone load factor rehash clustering',
    load: () => import('./hash-table'),
  },
  {
    id: 'skip-list',
    title: 'Skip list',
    summary:
      'A sorted list with express lanes: tower heights come from coin flips, and searches drop down the levels.',
    keywords: 'skiplist probabilistic towers levels coin flip sorted linked list',
    load: () => import('./skip-list'),
  },
];
