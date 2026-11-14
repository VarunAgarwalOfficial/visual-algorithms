import { describe, expect, it } from 'vitest';
import { seeded } from '../random';
import { ALGORITHMS, getAlgorithm } from './algorithms';
import { makeInput } from './inputs';
import { replay } from './trace';

const input = makeInput('random', 40, seeded(3));
const sorted = [...input].sort((a, b) => a - b);

describe('sorting', () => {
  it('every algorithm sorts, and its trace replays to the same result', () => {
    for (const algorithm of ALGORITHMS) {
      const trace = algorithm.sort(input);
      expect(trace.result, algorithm.name).toEqual(sorted);
      const replayed = replay(input, trace.steps);
      expect(replayed.array, algorithm.name).toEqual(sorted);
      expect(replayed.counts, algorithm.name).toEqual(trace.counts);
    }
  });

  it('handles empty, single and repeated values', () => {
    for (const algorithm of ALGORITHMS) {
      expect(algorithm.sort([]).result).toEqual([]);
      expect(algorithm.sort([4]).result).toEqual([4]);
      expect(algorithm.sort([2, 1, 2, 1, 2]).result).toEqual([1, 1, 2, 2, 2]);
    }
  });

  it('insertion sort swaps once per inversion and is linear on sorted input', () => {
    expect(getAlgorithm('insertion').sort([3, 1, 2]).counts.swaps).toBe(2);
    expect(getAlgorithm('insertion').sort(sorted).counts).toMatchObject({
      comparisons: sorted.length - 1,
      swaps: 0,
    });
  });

  it('merge sort only writes, and stays within n log2 n comparisons', () => {
    const { counts } = getAlgorithm('merge').sort(input);
    expect(counts.swaps).toBe(0);
    expect(counts.comparisons).toBeLessThanOrEqual(input.length * Math.log2(input.length));
  });

  it('replay stops at the requested step', () => {
    const { steps } = getAlgorithm('bubble').sort([2, 1, 3]);
    expect(replay([2, 1, 3], steps, 1).array).toEqual([2, 1, 3]);
    expect(replay([2, 1, 3], steps, 2).array).toEqual([1, 2, 3]);
  });
});
