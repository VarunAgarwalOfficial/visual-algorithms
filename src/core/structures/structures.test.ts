import { describe, expect, it } from 'vitest';
import { randomInt, seeded } from '../random';
import { BinaryHeap } from './heap';
import { SearchTree, type TreeVariant } from './bst';
import { BTree } from './btree';
import { compress, Trie } from './trie';
import { UnionFind, type UnionRule } from './unionfind';
import { HashTable, type HashScheme } from './hashtable';
import { SkipList } from './skiplist';
import { layoutTree } from './layout';

const sorted = (values: Iterable<number>) => [...values].sort((a, b) => a - b);

describe('binary heap', () => {
  it('extracts in sorted order, min and max, however it was built', () => {
    const random = seeded(3);
    const values = Array.from({ length: 25 }, () => randomInt(random, 0, 99));
    for (const max of [false, true]) {
      for (const method of ['floyd', 'inserts', 'one by one'] as const) {
        const heap = new BinaryHeap(max);
        if (method === 'one by one') values.forEach((v) => heap.insert(v));
        else heap.build(values, method);
        expect(heap.valid()).toBe(true);
        const out: number[] = [];
        while (heap.size > 0) out.push(heap.extract() as number);
        expect(out).toEqual(max ? sorted(values).reverse() : sorted(values));
      }
    }
  });

  it('bottom-up build uses fewer comparisons than n inserts on sorted-descending input', () => {
    const values = Array.from({ length: 31 }, (_, i) => 31 - i);
    const cost = (method: 'floyd' | 'inserts') => {
      const heap = new BinaryHeap();
      heap.build(values, method);
      return heap.frames[heap.frames.length - 1].comparisons;
    };
    expect(cost('floyd')).toBeLessThan(cost('inserts'));
    expect(cost('floyd')).toBeLessThanOrEqual(2 * values.length);
  });
});

describe('search trees', () => {
  it('stay sorted and keep their invariants through random inserts and deletes', () => {
    for (const variant of ['bst', 'avl', 'rb'] as TreeVariant[]) {
      for (let seed = 1; seed <= 20; seed++) {
        const random = seeded(seed);
        const tree = new SearchTree(variant);
        const model = new Set<number>();
        for (let i = 0; i < 300; i++) {
          const key = randomInt(random, 0, 60);
          if (random() < 0.55) {
            expect(tree.insert(key)).toBe(!model.has(key));
            model.add(key);
          } else {
            expect(tree.delete(key)).toBe(model.delete(key));
          }
          expect(tree.check()).toBeNull();
        }
        expect(tree.inorder()).toEqual(sorted(model));
        expect(tree.size).toBe(model.size);
        for (const key of model) expect(tree.find(key)).toBe(true);
        for (const key of model) tree.delete(key);
        expect(tree.check()).toBeNull();
        expect(tree.size).toBe(0);
      }
    }
  });

  it('sorted input makes a list of the plain tree but not of the balanced ones', () => {
    const height = (variant: TreeVariant) => {
      const tree = new SearchTree(variant);
      for (let key = 1; key <= 31; key++) tree.insert(key);
      return tree.height;
    };
    expect(height('bst')).toBe(31);
    expect(height('avl')).toBe(5);
    expect(height('rb')).toBeLessThanOrEqual(10); // 2 log2(n + 1)
  });
});

describe('B-tree', () => {
  it('keeps its invariants and sorted order for every degree', () => {
    for (const t of [2, 3, 4]) {
      for (let seed = 1; seed <= 10; seed++) {
        const random = seeded(seed * 7 + t);
        const tree = new BTree(t);
        const model = new Set<number>();
        for (let i = 0; i < 400; i++) {
          const key = randomInt(random, 0, 90);
          if (random() < 0.55) {
            expect(tree.insert(key)).toBe(!model.has(key));
            model.add(key);
          } else {
            expect(tree.delete(key)).toBe(model.delete(key));
          }
          expect(tree.check()).toBeNull();
        }
        expect(tree.inorder()).toEqual(sorted(model));
        for (const key of model) expect(tree.find(key)).toBe(true);
        for (const key of model) tree.delete(key);
        expect(tree.check()).toBeNull();
        expect(tree.size).toBe(0);
      }
    }
  });
});

describe('trie', () => {
  it('completes prefixes, deletes words and prunes unused nodes', () => {
    const trie = new Trie();
    for (const word of ['car', 'card', 'care', 'cat', 'dog', 'do']) trie.insert(word);
    expect(trie.insert('car')).toBe(false);
    expect(trie.complete('car')).toEqual(['car', 'card', 'care']);
    expect(trie.complete('d')).toEqual(['do', 'dog']);
    expect(trie.complete('x')).toEqual([]);
    expect(trie.nodes).toBe(1 + 6 + 3); // root, c-a-r-d/e and t, d-o-g
    expect(trie.delete('card')).toBe(true);
    expect(trie.delete('ca')).toBe(false);
    expect(trie.delete('dog')).toBe(true);
    expect(trie.complete('')).toEqual(['car', 'care', 'cat', 'do']);
    expect(trie.nodes).toBe(1 + 5 + 2);
  });

  it('compressed view joins single-child chains without losing words', () => {
    const trie = new Trie();
    for (const word of ['team', 'tea', 'ten', 'inn']) trie.insert(word);
    const { root } = compress(trie.frames[trie.frames.length - 1].root, new Map());
    const words: string[] = [];
    const walk = (node: typeof root, text: string) => {
      if (node.end) words.push(text + node.label);
      node.kids.forEach((kid) => walk(kid, text + node.label));
    };
    walk(root, '');
    expect(words.sort()).toEqual(['inn', 'tea', 'team', 'ten']);
    expect(root.kids.map((kid) => kid.label)).toEqual(['inn', 'te']);
  });
});

describe('union-find', () => {
  it('agrees with a naive labelling under every rule', () => {
    for (const rule of ['rank', 'size', 'none'] as UnionRule[]) {
      for (const compression of [true, false]) {
        const random = seeded(11);
        const n = 24;
        const sets = new UnionFind(n, rule, compression);
        const label = Array.from({ length: n }, (_, i) => i);
        for (let i = 0; i < 60; i++) {
          const a = randomInt(random, 0, n - 1);
          const b = randomInt(random, 0, n - 1);
          if (random() < 0.6) {
            const joined = sets.union(a, b);
            expect(joined).toBe(label[a] !== label[b]);
            const from = label[a];
            for (let k = 0; k < n; k++) if (label[k] === from) label[k] = label[b];
          } else {
            expect(sets.find(a) === sets.find(b)).toBe(label[a] === label[b]);
          }
        }
        if (rule !== 'none') expect(sets.tallest()).toBeLessThanOrEqual(Math.log2(n));
      }
    }
  });
});

describe('hash table', () => {
  it('finds exactly the keys that were inserted and not deleted, for each scheme', () => {
    for (const scheme of ['linear', 'quadratic', 'double', 'chain'] as HashScheme[]) {
      for (const threshold of [0.5, 0.7, 0.9]) {
        const random = seeded(5);
        const table = new HashTable(scheme, threshold);
        const model = new Set<number>();
        for (let i = 0; i < 300; i++) {
          const key = randomInt(random, 0, 199);
          if (random() < 0.5 && model.size < 30) {
            if (table.insert(key)) model.add(key);
            else if (scheme !== 'quadratic') expect(model.has(key)).toBe(true);
          } else {
            expect(table.delete(key)).toBe(model.delete(key));
          }
          expect(table.size).toBe(model.size);
        }
        expect(table.keys()).toEqual(sorted(model));
        for (let key = 0; key < 200; key++) expect(table.find(key)).toBe(model.has(key));
      }
    }
  });
});

describe('skip list', () => {
  it('stays ordered and searchable through random inserts and deletes', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const random = seeded(seed);
      const list = new SkipList(seeded(seed + 100));
      const model = new Set<number>();
      for (let i = 0; i < 200; i++) {
        const key = randomInt(random, 0, 50);
        if (random() < 0.6) {
          expect(list.insert(key)).toBe(!model.has(key));
          model.add(key);
        } else {
          expect(list.delete(key)).toBe(model.delete(key));
        }
        expect(list.valid()).toBe(true);
      }
      expect(list.keys()).toEqual(sorted(model));
      for (let key = 0; key <= 50; key++) expect(list.find(key)).toBe(model.has(key));
    }
  });
});

describe('tree layout', () => {
  it('never overlaps nodes on the same level', () => {
    const tree = new SearchTree('bst');
    const random = seeded(9);
    for (let i = 0; i < 40; i++) tree.insert(randomInt(random, 0, 99));
    const root = tree.frames[tree.frames.length - 1].root;
    type Snap = NonNullable<typeof root>;
    const layout = layoutTree<Snap, number>(root, {
      id: (node) => node.id,
      children: (node) => [node.left, node.right],
    });
    const rows = new Map<number, number[]>();
    for (const { x, depth } of layout.at.values()) rows.set(depth, [...(rows.get(depth) ?? []), x]);
    for (const xs of rows.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(1);
    }
    expect(layout.at.size).toBe(tree.size);
  });
});
