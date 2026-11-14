import { describe, expect, it } from 'vitest';
import { seeded } from '../random';
import { ALGORITHMS, getAlgorithm } from './algorithms';
import { INPUT_KINDS, makeInput, parseValues } from './inputs';
import { Playback, replay } from './trace';

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
      // The cursor agrees with a plain replay, forwards and after going back.
      const playback = new Playback(input, trace);
      playback.seek(trace.steps.length);
      playback.seek(trace.steps.length >> 1);
      expect(playback.array, algorithm.name).toEqual(
        replay(input, trace.steps, playback.position).array,
      );
      expect(
        playback.buckets.every((count) => count >= 0),
        algorithm.name,
      ).toBe(true);
    }
  });

  it('every starting order is a full-length input that the sorts agree on', () => {
    for (const { id } of INPUT_KINDS) {
      const values = makeInput(id, 37, seeded(5));
      const expected = [...values].sort((a, b) => a - b);
      expect(values.length, id).toBe(37);
      for (const name of ['tim', 'shell', 'radix', 'counting', 'comb'] as const) {
        expect(getAlgorithm(name).sort(values).result, `${name} on ${id}`).toEqual(expected);
      }
    }
    expect(parseValues('3, 1 2000,0')).toEqual([3, 1, 999, 1]);
    expect(parseValues('3, x')).toBeUndefined();
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

  it('merge sort compares values that are still in place, and stays within n log2 n', () => {
    const trace = getAlgorithm('merge').sort(input);
    expect(trace.counts.swaps).toBe(0);
    expect(trace.counts.comparisons).toBeLessThanOrEqual(input.length * Math.log2(input.length));
    // After each block of comparisons, the first value written is the smaller of the first pair compared.
    const playback = new Playback(input, trace);
    let first: number | undefined;
    trace.steps.forEach((step, k) => {
      playback.seek(k);
      if (step.type === 'compare') {
        first ??= Math.min(playback.array[step.i], playback.array[step.j]);
      } else if (step.type === 'write' && first !== undefined) {
        expect(step.value).toBe(first);
        first = undefined;
      }
    });
  });

  it('counting and radix sort never compare; timsort is linear on runs; bogo sort is bounded', () => {
    const n = input.length;
    expect(getAlgorithm('counting').sort(input).counts).toEqual({
      comparisons: 0,
      swaps: 0,
      writes: n,
      reads: n,
    });
    // 40 values in 1..40 have two digits, so two passes.
    expect(getAlgorithm('radix').sort(input).counts).toMatchObject({
      comparisons: 0,
      reads: 2 * n,
    });
    expect(getAlgorithm('tim').sort(sorted).counts).toMatchObject({
      comparisons: n - 1,
      writes: 0,
    });
    expect(getAlgorithm('tim').sort([...sorted].reverse()).counts).toMatchObject({
      comparisons: n - 1,
      swaps: n / 2,
      writes: 0,
    });
    expect(getAlgorithm('bogo').sort([5, 3, 6, 1, 4, 2]).steps.length).toBeLessThan(2000);
  });

  it('replay stops at the requested step', () => {
    const { steps } = getAlgorithm('bubble').sort([2, 1, 3]);
    expect(replay([2, 1, 3], steps, 1).array).toEqual([2, 1, 3]);
    expect(replay([2, 1, 3], steps, 2).array).toEqual([1, 2, 3]);
  });
});
