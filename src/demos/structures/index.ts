import type { DemoEntry } from '../layout';

export const demos: readonly DemoEntry[] = [
  {
    id: 'binary-heap',
    title: 'Binary heap',
    summary:
      'A priority queue shown as a tree and as the array that stores it, with sift-up, sift-down and heap building.',
    lede: 'A heap: a tree where every parent is smaller than its children, stored row by row in the numbered boxes underneath. Press Insert to add a number and watch it rise to its place.',
    keywords: 'priority queue min-heap max-heap heapify floyd sift up sift down extract-min array',
    load: () => import('./binary-heap'),
  },
  {
    id: 'bst',
    title: 'Binary search trees',
    summary:
      'Plain, AVL and red-black trees on the same keys, with every rotation and recolouring shown.',
    lede: 'A binary search tree of numbers: at every node, smaller numbers go down the left and larger ones down the right. Press Insert to add a number and watch it find its place.',
    keywords: 'bst avl red-black rotation balance factor self-balancing tree insert delete',
    load: () => import('./bst'),
  },
  {
    id: 'b-tree',
    title: 'B-tree',
    summary: 'Wide nodes that split when they overflow and borrow or merge when they run low.',
    lede: 'A B-tree: a search tree whose boxes hold several sorted numbers each and split in two when they get too full. Press Insert to add a number and watch where it goes.',
    keywords: 'btree 2-3-4 tree split merge borrow minimum degree database index',
    load: () => import('./b-tree'),
  },
  {
    id: 'trie',
    title: 'Trie',
    summary:
      'Words stored letter by letter, so a shared prefix is stored once and completions are a subtree.',
    lede: 'A trie: words stored one letter per circle, so words that start the same share the same path. Press Insert to add a word and watch it follow the letters it shares.',
    keywords: 'prefix tree radix tree autocomplete dictionary words completion',
    load: () => import('./trie'),
  },
  {
    id: 'union-find',
    title: 'Union-find',
    summary:
      'Disjoint sets as a forest of parent pointers, with union by rank and path compression.',
    lede: 'Numbered items grouped into sets, each set drawn as a tree whose top item names the set. Press Union to join the sets of two items.',
    keywords:
      'disjoint set union dsu forest path compression union by rank size find connected components',
    load: () => import('./union-find'),
  },
  {
    id: 'hash-table',
    title: 'Hash table',
    summary:
      'Collisions resolved by linear, quadratic or double-hash probing, or by chaining, one probe at a time.',
    lede: 'A hash table: each number is stored in a numbered slot worked out from the number itself, and moves along when that slot is taken. Press Insert to add a number and watch where it lands.',
    keywords:
      'hashing open addressing linear probing quadratic double hashing chaining tombstone load factor rehash clustering',
    load: () => import('./hash-table'),
  },
  {
    id: 'skip-list',
    title: 'Skip list',
    summary:
      'A sorted list with express lanes: tower heights come from coin flips, and searches drop down the levels.',
    lede: 'A sorted list with extra rows above it that skip ahead, so a search can jump over many entries at once. Press Insert to add a number and watch the search drop down the rows.',
    keywords: 'skiplist probabilistic towers levels coin flip sorted linked list',
    load: () => import('./skip-list'),
  },
];
