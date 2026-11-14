import { describe, expect, it } from 'vitest';
import { ALGORITHMS, getAlgorithm } from './algorithms';
import { INPUT_KINDS, makeInput, shuffle } from './inputs';
import { applyStep, replay, tally, type Counts } from './trace';

function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const byNumber = (a: number, b: number) => a - b;

const CASES: [string, number[]][] = [
  ['empty', []],
  ['single', [7]],
  ['pair in order', [1, 2]],
  ['pair reversed', [2, 1]],
  ['already sorted', [1, 2, 3, 4, 5, 6, 7, 8]],
  ['reversed', [9, 8, 7, 6, 5, 4, 3, 2, 1]],
  ['all equal', [4, 4, 4, 4, 4]],
  ['duplicates', [3, 1, 3, 2, 1, 2, 3, 1]],
  ['negatives and fractions', [0.5, -3, 2.25, -3, 0, 10, -0.5]],
  ['random 64', makeInput('random', 64, rng(1))],
  ['random 201', makeInput('random', 201, rng(2))],
  ['nearly sorted 100', makeInput('nearly', 100, rng(3))],
  ['few distinct 100', makeInput('few', 100, rng(4))],
];

describe.each(ALGORITHMS.map((a) => [a.name, a] as const))('%s', (_name, algorithm) => {
  describe.each(CASES)('on %s input', (_label, input) => {
    const snapshot = [...input];
    const trace = algorithm.sort(input);
    const expected = [...input].sort(byNumber);

    it('returns a sorted permutation of the input', () => {
      expect(trace.result).toEqual(expected);
    });

    it('does not modify the input', () => {
      expect(input).toEqual(snapshot);
    });

    it('records a trace that replays to the sorted result', () => {
      expect(replay(input, trace.steps).array).toEqual(expected);
    });

    it('keeps every step in bounds and every intermediate state a permutation where expected', () => {
      const array = [...input];
      for (const step of trace.steps) {
        expect(Number.isInteger(step.i) && step.i >= 0 && step.i < input.length).toBe(true);
        if (step.type !== 'write') {
          expect(Number.isInteger(step.j) && step.j >= 0 && step.j < input.length).toBe(true);
          expect(step.j).not.toBe(step.i);
        } else {
          // A written value always comes from the input.
          expect(input).toContain(step.value);
        }
        applyStep(array, step);
        if (step.type === 'swap') {
          // Swaps never create or destroy values. Checked cheaply via the sum.
          expect(array.reduce((s, v) => s + v, 0)).toBeCloseTo(
            input.reduce((s, v) => s + v, 0),
            9,
          );
        }
      }
    });

    it('reports counts that match the trace', () => {
      const counts: Counts = { comparisons: 0, swaps: 0, writes: 0 };
      for (const step of trace.steps) tally(counts, step, 1);
      expect(trace.counts).toEqual(counts);
      expect(counts.comparisons + counts.swaps + counts.writes).toBe(trace.steps.length);
    });
  });
});

describe('algorithm behaviour', () => {
  const sorted = Array.from({ length: 50 }, (_, i) => i + 1);
  const reversed = [...sorted].reverse();
  const random = makeInput('random', 128, rng(11));

  it('bubble sort stops after one pass on sorted input', () => {
    expect(getAlgorithm('bubble').sort(sorted).counts).toEqual({
      comparisons: 49,
      swaps: 0,
      writes: 0,
    });
  });

  it('bubble and insertion sort swap once per inversion', () => {
    const inversions = (50 * 49) / 2;
    expect(getAlgorithm('bubble').sort(reversed).counts.swaps).toBe(inversions);
    expect(getAlgorithm('insertion').sort(reversed).counts.swaps).toBe(inversions);
  });

  it('insertion sort is linear on sorted input', () => {
    expect(getAlgorithm('insertion').sort(sorted).counts.comparisons).toBe(49);
  });

  it('selection sort always makes n(n-1)/2 comparisons and at most n-1 swaps', () => {
    for (const input of [sorted, reversed, random]) {
      const n = input.length;
      const { counts } = getAlgorithm('selection').sort(input);
      expect(counts.comparisons).toBe((n * (n - 1)) / 2);
      expect(counts.swaps).toBeLessThanOrEqual(n - 1);
    }
  });

  it('merge sort only writes, and stays within n log2 n comparisons', () => {
    const { counts } = getAlgorithm('merge').sort(random);
    expect(counts.swaps).toBe(0);
    expect(counts.writes).toBe(128 * 7);
    expect(counts.comparisons).toBeLessThanOrEqual(128 * 7);
  });

  it('quicksort and heapsort stay near n log n on sorted and reversed input', () => {
    const bound = 4 * 50 * Math.log2(50);
    for (const id of ['quick', 'heap']) {
      for (const input of [sorted, reversed]) {
        expect(getAlgorithm(id).sort(input).counts.comparisons).toBeLessThan(bound);
      }
    }
  });

  it('falls back to the first algorithm for an unknown id', () => {
    expect(getAlgorithm('nope')).toBe(ALGORITHMS[0]);
  });
});

describe('replay', () => {
  it('stops at the requested step and counts what it applied', () => {
    const input = [3, 2, 1];
    const { steps } = getAlgorithm('bubble').sort(input);
    expect(replay(input, steps, 0)).toEqual({
      array: [3, 2, 1],
      counts: { comparisons: 0, swaps: 0, writes: 0 },
    });
    const two = replay(input, steps, 2);
    expect(two.array).toEqual([2, 3, 1]);
    expect(two.counts).toEqual({ comparisons: 1, swaps: 1, writes: 0 });
  });
});

describe('inputs', () => {
  it.each(INPUT_KINDS.map((k) => k.id))('%s has the requested size and range', (kind) => {
    for (const size of [0, 1, 2, 5, 60]) {
      const input = makeInput(kind, size, rng(size + 1));
      expect(input).toHaveLength(size);
      for (const v of input) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(size);
      }
    }
  });

  it('random and reversed inputs are permutations of 1..n', () => {
    const expected = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(makeInput('random', 40, rng(5)).sort(byNumber)).toEqual(expected);
    expect(makeInput('reversed', 40, rng(5))).toEqual([...expected].reverse());
  });

  it('few-distinct inputs have at most five values', () => {
    expect(new Set(makeInput('few', 80, rng(6))).size).toBeLessThanOrEqual(5);
  });

  it('shuffle keeps the same elements', () => {
    expect(shuffle([1, 2, 3, 4, 5, 6], rng(8)).sort(byNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
