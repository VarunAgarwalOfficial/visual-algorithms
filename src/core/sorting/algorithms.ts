import { seeded } from '../random';
import { Recorder, type SortTrace } from './trace';

export type AlgorithmId =
  | 'bubble'
  | 'comb'
  | 'insertion'
  | 'shell'
  | 'selection'
  | 'merge'
  | 'tim'
  | 'quick'
  | 'heap'
  | 'counting'
  | 'radix'
  | 'bogo';

export interface Algorithm {
  id: AlgorithmId;
  name: string;
  /** Typical and worst-case comparisons, for the caption. */
  complexity: string;
  /** Whether equal values keep their original order. */
  stable: boolean;
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
 * Merges the sorted ranges [lo, mid) and [mid, hi). All the comparisons are
 * made first, while both ranges are still intact in the array, so a compare
 * step always points at the two values really being compared. The outcomes are
 * remembered, the ranges are copied out, and one sweep writes them back in
 * order. The counts are those of an ordinary merge.
 */
function mergeRanges(r: Recorder, lo: number, mid: number, hi: number): void {
  const takeLeft: boolean[] = [];
  let i = lo;
  let j = mid;
  while (i < mid && j < hi) {
    // <= keeps equal values in their original order (stable).
    const left = r.compare(i, j) <= 0;
    takeLeft.push(left);
    if (left) i++;
    else j++;
  }
  const buffer = r.array.slice(lo, hi);
  i = 0;
  j = mid - lo;
  let k = lo;
  for (const left of takeLeft) r.write(k++, buffer[left ? i++ : j++]);
  while (i < mid - lo) r.write(k++, buffer[i++]);
  while (j < hi - lo) r.write(k++, buffer[j++]);
}

/** Top-down merge sort: sort each half, then merge them. */
function merge(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  const sort = (lo: number, hi: number) => {
    if (hi - lo < 2) return;
    const mid = (lo + hi) >>> 1;
    sort(lo, mid);
    sort(mid, hi);
    r.mark(`Merge the sorted halves at positions ${lo + 1}–${mid} and ${mid + 1}–${hi}`, {
      ranges: [
        [lo, mid],
        [mid, hi],
      ],
    });
    mergeRanges(r, lo, mid, hi);
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
    r.mark(`Positions ${lo + 1}–${hi + 1}: pick a middle value, move smaller ones to its left`, {
      ranges: [[lo, hi + 1]],
    });
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

/** Ciura's gap sequence, found by experiment; the best known for small arrays. */
const CIURA = [701, 301, 132, 57, 23, 10, 4, 1];

/** Insertion sort on every gap-th value, for a shrinking sequence of gaps. */
function shell(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  for (const gap of CIURA) {
    if (gap >= r.length) continue;
    r.mark(gap === 1 ? 'Gap 1: plain insertion sort' : `Gap ${gap}`);
    for (let i = gap; i < r.length; i++) {
      for (let j = i; j >= gap && r.compare(j - gap, j) > 0; j -= gap) {
        r.swap(j - gap, j);
      }
    }
  }
  return r.finish();
}

/** Bubble sort with a gap that shrinks by 1.3 each pass, then plain passes until no swaps. */
function comb(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  let gap = r.length;
  let swapped = true;
  while (gap > 1 || swapped) {
    gap = Math.max(1, Math.floor(gap / 1.3));
    r.mark(`Gap ${gap}`);
    swapped = false;
    for (let i = 0; i + gap < r.length; i++) {
      if (r.compare(i, i + gap) > 0) {
        r.swap(i, i + gap);
        swapped = true;
      }
    }
  }
  return r.finish();
}

/**
 * Counting sort over the range of values present. One pass tallies how many
 * times each value occurs; a second pass writes the values back, bucket by
 * bucket. No two values are ever compared.
 */
function counting(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  if (r.length === 0) return r.finish();
  const min = Math.min(...input);
  const max = Math.max(...input);
  const count = new Array<number>(max - min + 1).fill(0);
  r.mark(`Count how often each value from ${min} to ${max} occurs`, {
    buckets: { count: count.length, base: min },
  });
  for (let i = 0; i < r.length; i++) count[r.read(i, r.array[i] - min) - min]++;
  r.mark('Write the values back, smallest bucket first');
  let k = 0;
  for (let bucket = 0; bucket < count.length; bucket++) {
    for (let c = 0; c < count[bucket]; c++) r.write(k++, bucket + min, bucket);
  }
  return r.finish();
}

const DIGIT_NAMES = ['ones', 'tens', 'hundreds', 'thousands'];

/**
 * Least-significant-digit radix sort in base 10. Each pass is a stable
 * counting sort on one digit: read every value into its digit's bucket, turn
 * the tallies into start positions, then write each value to the next free
 * place of its bucket, in the order the values were read.
 */
function radix(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  if (r.length === 0) return r.finish();
  const max = Math.max(...input);
  for (let place = 1, pass = 0; place <= max; place *= 10, pass++) {
    const name = DIGIT_NAMES[pass] ?? `10^${pass}`;
    r.mark(`Pass ${pass + 1}: count the ${name} digits`, { buckets: { count: 10, base: 0 } });
    const digit = (value: number) => Math.floor(value / place) % 10;
    const next = new Array<number>(10).fill(0);
    for (let i = 0; i < r.length; i++) next[digit(r.read(i, digit(r.array[i])))]++;
    // Tallies become the first position of each bucket.
    for (let d = 0, start = 0; d < 10; d++) {
      const size = next[d];
      next[d] = start;
      start += size;
    }
    r.mark(`Pass ${pass + 1}: write back in order of the ${name} digit`);
    const buffer = [...r.array];
    for (const value of buffer) r.write(next[digit(value)]++, value, digit(value));
  }
  return r.finish();
}

/** Timsort's run length: n shrunk to between 4 and 8. (The real one uses 32 to 64.) */
function minRun(n: number): number {
  let odd = 0;
  while (n >= 8) {
    odd |= n & 1;
    n >>= 1;
  }
  return n + odd;
}

/**
 * A timsort-style sort: find runs that are already in order, lengthen short
 * ones to `minRun` with insertion sort, and merge runs from a stack while
 * keeping their lengths balanced. Galloping is left out.
 */
function tim(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  const n = r.length;
  const target = minRun(n);
  const runs: [number, number][] = [];
  const size = (k: number) => runs[k][1] - runs[k][0];

  const mergeAt = (k: number) => {
    const [lo, mid] = runs[k];
    const hi = runs[k + 1][1];
    r.mark(`Merge the runs at ${lo + 1}–${mid} and ${mid + 1}–${hi}`, { ranges: [...runs] });
    mergeRanges(r, lo, mid, hi);
    runs.splice(k, 2, [lo, hi]);
  };

  let lo = 0;
  while (lo < n) {
    let hi = lo + 1;
    r.mark(`Look for a run starting at position ${lo + 1}`, { ranges: [...runs, [lo, hi]] });
    if (hi < n) {
      if (r.compare(lo, hi) > 0) {
        // Strictly descending, so reversing it cannot reorder equal values.
        hi++;
        while (hi < n && r.compare(hi - 1, hi) > 0) hi++;
        r.mark(`Reverse the descending run at ${lo + 1}–${hi}`, { ranges: [...runs, [lo, hi]] });
        for (let a = lo, b = hi - 1; a < b; a++, b--) r.swap(a, b);
      } else {
        hi++;
        while (hi < n && r.compare(hi - 1, hi) <= 0) hi++;
      }
    }
    const end = Math.min(n, Math.max(hi, lo + target));
    if (hi < end) {
      r.mark(`Run of ${hi - lo} is short: insertion sort it up to ${end - lo}`, {
        ranges: [...runs, [lo, end]],
      });
      for (let k = hi; k < end; k++) {
        for (let j = k; j > lo && r.compare(j - 1, j) > 0; j--) r.swap(j - 1, j);
      }
    }
    runs.push([lo, end]);
    lo = end;
    // Keep the stack balanced: each run longer than the two above it together.
    while (runs.length > 1) {
      let k = runs.length - 2;
      if (
        (k > 0 && size(k - 1) <= size(k) + size(k + 1)) ||
        (k > 1 && size(k - 2) <= size(k - 1) + size(k))
      ) {
        if (size(k - 1) < size(k + 1)) k--;
      } else if (size(k) > size(k + 1)) {
        break;
      }
      mergeAt(k);
    }
  }
  while (runs.length > 1) {
    let k = runs.length - 2;
    if (k > 0 && size(k - 1) < size(k + 1)) k--;
    mergeAt(k);
  }
  return r.finish();
}

/** Bogo sort gives up above this many values, or after this many shuffles. */
export const BOGO_MAX_SIZE = 6;
export const BOGO_MAX_SHUFFLES = 150;

/**
 * Bogo sort: shuffle, check, repeat. Not a real algorithm. It only tries on
 * tiny arrays and for a bounded number of shuffles, then admits defeat and
 * hands over to insertion sort. The shuffles are seeded from the input, so the
 * same input always replays the same way.
 */
function bogo(input: readonly number[]): SortTrace {
  const r = new Recorder(input);
  const n = r.length;
  const isSorted = () => {
    for (let i = 0; i + 1 < n; i++) if (r.compare(i, i + 1) > 0) return false;
    return true;
  };
  const giveUp = (why: string) => {
    r.mark(`${why}: finish with insertion sort`);
    for (let i = 1; i < n; i++) {
      for (let j = i; j > 0 && r.compare(j - 1, j) > 0; j--) r.swap(j - 1, j);
    }
    return r.finish();
  };
  if (n > BOGO_MAX_SIZE) return giveUp(`More than ${BOGO_MAX_SIZE} values is hopeless`);
  const random = seeded(input.reduce((hash, value) => (hash * 31 + value) | 0, n));
  for (let round = 0; ; round++) {
    r.mark(round === 0 ? 'Is it sorted?' : `Shuffle ${round}: is it sorted now?`);
    if (isSorted()) return r.finish();
    if (round === BOGO_MAX_SHUFFLES) return giveUp(`Still unsorted after ${round} shuffles`);
    r.mark(`Shuffle ${round + 1}`);
    for (let i = n - 1; i > 0; i--) r.swap(i, Math.floor(random() * (i + 1)));
  }
}

export const ALGORITHMS: readonly Algorithm[] = [
  {
    id: 'bubble',
    name: 'Bubble sort',
    complexity: 'O(n²)',
    stable: true,
    summary: 'Swaps adjacent pairs that are out of order until a pass makes no swaps.',
    sort: bubble,
  },
  {
    id: 'comb',
    name: 'Comb sort',
    complexity: 'about O(n log n) in practice, O(n²) worst case',
    stable: false,
    summary:
      'Bubble sort with a gap that shrinks by 1.3 each pass, so small values near the end move forward quickly.',
    sort: comb,
  },
  {
    id: 'insertion',
    name: 'Insertion sort',
    complexity: 'O(n²), O(n) when nearly sorted',
    stable: true,
    summary: 'Grows a sorted prefix by sinking each new value into place.',
    sort: insertion,
  },
  {
    id: 'shell',
    name: 'Shell sort',
    complexity: 'about O(n^1.3) with Ciura gaps; no tight bound is known',
    stable: false,
    summary:
      'Insertion sort on values a gap apart, for gaps 701, 301, 132, 57, 23, 10, 4, 1. Early passes move values far; the last pass has little left to do.',
    sort: shell,
  },
  {
    id: 'selection',
    name: 'Selection sort',
    complexity: 'O(n²) comparisons, at most n − 1 swaps',
    stable: false,
    summary: 'Picks the smallest remaining value and swaps it to the front.',
    sort: selection,
  },
  {
    id: 'merge',
    name: 'Merge sort',
    complexity: 'O(n log n), O(n) extra space',
    stable: true,
    summary:
      'Sorts each half, then merges them: compare the fronts of the two halves, then write the values back in order.',
    sort: merge,
  },
  {
    id: 'tim',
    name: 'Timsort (simplified)',
    complexity: 'O(n log n), O(n) when the input is already in runs',
    stable: true,
    summary:
      'Finds runs already in order, lengthens short ones with insertion sort, and merges runs of similar length. Runs here are at least 4 to 8 long; the real one uses 32 to 64 and gallops.',
    sort: tim,
  },
  {
    id: 'quick',
    name: 'Quicksort',
    complexity: 'O(n log n) typical, O(n²) worst case',
    stable: false,
    summary: 'Partitions around a median-of-three pivot, then sorts each side.',
    sort: quick,
  },
  {
    id: 'heap',
    name: 'Heapsort',
    complexity: 'O(n log n)',
    stable: false,
    summary: 'Builds a max-heap, then repeatedly moves the largest value to the end.',
    sort: heap,
  },
  {
    id: 'counting',
    name: 'Counting sort',
    complexity: 'O(n + k) for k possible values, no comparisons',
    stable: true,
    summary:
      'Tallies how often each value occurs, then writes the values back in bucket order. It must know the range of values in advance.',
    sort: counting,
  },
  {
    id: 'radix',
    name: 'Radix sort (LSD)',
    complexity: 'O(d (n + b)) for d digits in base b, no comparisons',
    stable: true,
    summary:
      'A stable counting sort on the ones digit, then the tens, then the hundreds. Each pass keeps the order the earlier passes made.',
    sort: radix,
  },
  {
    id: 'bogo',
    name: 'Bogo sort (a joke)',
    complexity: 'O(n · n!) expected',
    stable: false,
    summary: `Shuffles until the array happens to be sorted. Here it only tries with up to ${BOGO_MAX_SIZE} values and ${BOGO_MAX_SHUFFLES} shuffles, then gives up and uses insertion sort.`,
    sort: bogo,
  },
];

export function getAlgorithm(id: string): Algorithm {
  return ALGORITHMS.find((a) => a.id === id) ?? ALGORITHMS[0];
}
