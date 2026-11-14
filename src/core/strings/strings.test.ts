import { describe, expect, it } from 'vitest';
import { randomInt, seeded } from '../random';
import { editCost, editDistance, knapsack, lcs, type Item } from './dp';
import { decode, encode, huffman } from './huffman';
import { failureTable, matchTrace, naiveComparisons, zArray } from './matching';

const isSubsequence = (s: string, of: string) => {
  let i = 0;
  for (const ch of of) if (i < s.length && ch === s[i]) i++;
  return i === s.length;
};

describe('edit distance', () => {
  it('finds known distances', () => {
    expect(editDistance('kitten', 'sitting').distance).toBe(3);
    expect(editDistance('flaw', 'lawn').distance).toBe(2);
    expect(editDistance('', 'abc').distance).toBe(3);
    expect(editDistance('kitten', 'sitting', 2).distance).toBe(5);
  });

  it('traces back operations that rebuild the target at the stated cost', () => {
    for (const cost of [1, 2]) {
      const { ops, distance } = editDistance('intention', 'execution', cost);
      expect(ops.map((op) => op.from).join('')).toBe('intention');
      expect(ops.map((op) => op.to).join('')).toBe('execution');
      expect(ops.reduce((sum, op) => sum + editCost(op, cost), 0)).toBe(distance);
    }
  });
});

describe('longest common subsequence', () => {
  it('returns a common subsequence of the right length', () => {
    const result = lcs('AGGTAB', 'GXTXAYB');
    expect(result.length).toBe(4);
    expect(result.subsequence).toHaveLength(4);
    expect(isSubsequence(result.subsequence, 'AGGTAB')).toBe(true);
    expect(isSubsequence(result.subsequence, 'GXTXAYB')).toBe(true);
    expect(lcs('abc', 'xyz').length).toBe(0);
  });
});

describe('knapsack', () => {
  const random = seeded(7);
  const items: Item[] = Array.from({ length: 8 }, () => ({
    weight: randomInt(random, 1, 7),
    value: randomInt(random, 1, 15),
  }));

  it('matches brute force over all subsets', () => {
    const capacity = 15;
    let best = 0;
    for (let mask = 0; mask < 1 << items.length; mask++) {
      const picked = items.filter((_, i) => mask & (1 << i));
      const weight = picked.reduce((sum, item) => sum + item.weight, 0);
      if (weight <= capacity)
        best = Math.max(
          best,
          picked.reduce((s, item) => s + item.value, 0),
        );
    }
    const result = knapsack(items, capacity);
    expect(result.best).toBe(best);
    expect(new Set(result.chosen).size).toBe(result.chosen.length);
    expect(result.chosen.reduce((s, i) => s + items[i].value, 0)).toBe(best);
    expect(result.chosen.reduce((s, i) => s + items[i].weight, 0)).toBeLessThanOrEqual(capacity);
  });

  it('unbounded traceback is consistent and no worse than 0/1', () => {
    const result = knapsack(items, 15, true);
    expect(result.best).toBeGreaterThanOrEqual(knapsack(items, 15).best);
    expect(result.chosen.reduce((s, i) => s + items[i].value, 0)).toBe(result.best);
    expect(result.chosen.reduce((s, i) => s + items[i].weight, 0)).toBeLessThanOrEqual(15);
    // Classic: weights 1,3,4 values 15,50,60 with capacity 8 gives 130 (two of 3, two of 1).
    const classic = [
      { weight: 1, value: 15 },
      { weight: 3, value: 50 },
      { weight: 4, value: 60 },
    ];
    expect(knapsack(classic, 8, true).best).toBe(130);
  });
});

describe('string matching', () => {
  it('computes known tables', () => {
    expect(failureTable('ABABACA')).toEqual([0, 0, 1, 2, 3, 0, 1]);
    expect(failureTable('aabaaab')).toEqual([0, 1, 0, 1, 2, 2, 3]);
    expect(zArray('aabxaab')).toEqual([7, 1, 0, 0, 3, 1, 0]);
  });

  it('finds the same matches as indexOf on random strings', () => {
    const random = seeded(11);
    for (let round = 0; round < 200; round++) {
      const word = (length: number) =>
        Array.from({ length }, () => 'ab#'[randomInt(random, 0, 2)]).join('');
      const text = word(randomInt(random, 0, 30));
      const pattern = word(randomInt(random, 1, 5));
      const expected: number[] = [];
      for (let at = text.indexOf(pattern); at >= 0; at = text.indexOf(pattern, at + 1)) {
        expected.push(at);
      }
      const naive = matchTrace('naive', text, pattern);
      const kmp = matchTrace('kmp', text, pattern);
      const z = matchTrace('z', text, pattern);
      expect(naive.matches).toEqual(expected);
      expect(kmp.matches).toEqual(expected);
      expect(z.matches).toEqual(expected);
      expect(z.table).toEqual(zArray(pattern));
      const count = (steps: typeof kmp.steps) =>
        steps.filter((s) => s.kind === 'compare' && s.phase === 'search').length;
      expect(count(naive.steps)).toBe(naiveComparisons(text, pattern));
      expect(count(kmp.steps)).toBeLessThanOrEqual(2 * text.length);
    }
  });
});

describe('huffman', () => {
  it('builds a prefix-free code that decodes back', () => {
    const text = 'abracadabra alakazam';
    const h = huffman(text);
    const codes = [...h.codes.values()];
    for (const x of codes) {
      for (const y of codes) if (x !== y) expect(y.startsWith(x)).toBe(false);
    }
    const bits = encode(text, h.codes);
    expect(bits).toHaveLength(h.encodedBits);
    expect(decode(bits, h.root)).toBe(text);
    expect(h.encodedBits / h.total).toBeGreaterThanOrEqual(h.entropy);
    expect(h.encodedBits / h.total).toBeLessThan(h.entropy + 1);
  });

  it('is optimal on a known example and handles one symbol', () => {
    // Frequencies 5, 9, 12, 13, 16, 45 (CLRS): optimal cost 224 bits.
    const text =
      'a'.repeat(45) +
      'b'.repeat(13) +
      'c'.repeat(12) +
      'd'.repeat(16) +
      'e'.repeat(9) +
      'f'.repeat(5);
    const h = huffman(text);
    expect(h.encodedBits).toBe(224);
    expect(h.codes.get('a')).toHaveLength(1);
    const one = huffman('aaaa');
    expect(one.encodedBits).toBe(4);
    expect(decode(encode('aaaa', one.codes), one.root)).toBe('aaaa');
    expect(one.entropy).toBe(0);
  });
});
