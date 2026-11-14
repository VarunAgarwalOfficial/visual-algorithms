import { Recorder, type SortTrace } from './trace';

export type AlgorithmId = 'bubble' | 'insertion' | 'selection' | 'merge' | 'quick' | 'heap';

export interface Algorithm {
  id: AlgorithmId;
  name: string;
  /** Typical and worst-case comparisons, for the caption. */
  complexity: string;
  summary: string;
  sort: (input: readonly number[]) => SortTrace;
}

/** Repeatedly swaps adjacent out-of-order pairs; stops after a pass with no swaps. */
function bubble(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  for (let end = r.length - 1; end > 0; end--) {
    let swapped = false;
    for (let i = 0; i < end; i++) {
      if (r.compare(i, i + 1) > 0) {
        r.swap(i, i + 1);
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return r.finish();
}

/** Grows a sorted prefix, sinking each new value leftwards into place. */
function insertion(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  for (let i = 1; i < r.length; i++) {
    for (let j = i; j > 0 && r.compare(j - 1, j) > 0; j--) {
      r.swap(j - 1, j);
    }
  }
  return r.finish();
}

/** Finds the smallest remaining value and swaps it to the front of the unsorted part. */
function selection(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  for (let i = 0; i < r.length - 1; i++) {
    let min = i;
    for (let j = i + 1; j < r.length; j++) {
      if (r.compare(j, min) < 0) min = j;
    }
    r.swap(i, min);
  }
  return r.finish();
}

/**
 * Top-down merge sort. Each merge copies the two sorted halves out and writes
 * them back in order, so it records writes instead of swaps. Comparison steps
 * point at where the two values sat when the merge began.
 */
function merge(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  const sort = (lo: number, hi: number) => {
    if (hi - lo < 2) return;
    const mid = (lo + hi) >>> 1;
    sort(lo, mid);
    sort(mid, hi);
    const left = r.array.slice(lo, mid);
    const right = r.array.slice(mid, hi);
    let i = 0;
    let j = 0;
    let k = lo;
    while (i < left.length && j < right.length) {
      r.mark(lo + i, mid + j);
      // <= keeps equal values in their original order (stable).
      r.write(k++, left[i] <= right[j] ? left[i++] : right[j++]);
    }
    while (i < left.length) r.write(k++, left[i++]);
    while (j < right.length) r.write(k++, right[j++]);
  };
  sort(0, r.length);
  return r.finish();
}

/**
 * Quicksort with Lomuto partitioning. The pivot is the median of the first,
 * middle and last values, which avoids the quadratic case on sorted input.
 */
function quick(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  const sort = (lo: number, hi: number) => {
    if (lo >= hi) return;
    if (hi - lo === 1) {
      if (r.compare(hi, lo) < 0) r.swap(hi, lo);
      return;
    }
    const mid = (lo + hi) >>> 1;
    if (r.compare(mid, lo) < 0) r.swap(mid, lo);
    if (r.compare(hi, lo) < 0) r.swap(hi, lo);
    if (r.compare(mid, hi) < 0) r.swap(mid, hi); // median now at hi
    let boundary = lo;
    for (let j = lo; j < hi; j++) {
      if (r.compare(j, hi) < 0) r.swap(boundary++, j);
    }
    r.swap(boundary, hi);
    sort(lo, boundary - 1);
    sort(boundary + 1, hi);
  };
  sort(0, r.length - 1);
  return r.finish();
}

/** Builds a max-heap in place, then repeatedly moves the root to the end. */
function heap(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  const siftDown = (root: number, size: number) => {
    for (;;) {
      let largest = root;
      const left = 2 * root + 1;
      const right = left + 1;
      if (left < size && r.compare(left, largest) > 0) largest = left;
      if (right < size && r.compare(right, largest) > 0) largest = right;
      if (largest === root) return;
      r.swap(root, largest);
      root = largest;
    }
  };
  for (let i = (r.length >> 1) - 1; i >= 0; i--) siftDown(i, r.length);
  for (let end = r.length - 1; end > 0; end--) {
    r.swap(0, end);
    siftDown(0, end);
  }
  return r.finish();
}

export const ALGORITHMS: readonly Algorithm[] = [
  {
    id: 'bubble',
    name: 'Bubble sort',
    complexity: 'O(n²)',
    summary: 'Swaps adjacent pairs that are out of order until a pass makes no swaps.',
    sort: bubble,
  },
  {
    id: 'insertion',
    name: 'Insertion sort',
    complexity: 'O(n²), O(n) when nearly sorted',
    summary: 'Grows a sorted prefix by sinking each new value into place.',
    sort: insertion,
  },
  {
    id: 'selection',
    name: 'Selection sort',
    complexity: 'O(n²) comparisons, at most n − 1 swaps',
    summary: 'Picks the smallest remaining value and swaps it to the front.',
    sort: selection,
  },
  {
    id: 'merge',
    name: 'Merge sort',
    complexity: 'O(n log n)',
    summary: 'Sorts each half, then merges them. It copies values, so it counts writes, not swaps.',
    sort: merge,
  },
  {
    id: 'quick',
    name: 'Quicksort',
    complexity: 'O(n log n) typical, O(n²) worst case',
    summary: 'Partitions around a median-of-three pivot, then sorts each side.',
    sort: quick,
  },
  {
    id: 'heap',
    name: 'Heapsort',
    complexity: 'O(n log n)',
    summary: 'Builds a max-heap, then repeatedly moves the largest value to the end.',
    sort: heap,
  },
];

export function getAlgorithm(id: string): Algorithm {
  return ALGORITHMS.find((a) => a.id === id) ?? ALGORITHMS[0];
}
