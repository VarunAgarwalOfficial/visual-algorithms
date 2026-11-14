/**
 * A sort is recorded as a list of steps, so that playback (pause, step, scrub,
 * speed) is just moving a cursor through data.
 *
 * - compare: two positions were read and compared. Does not change the array.
 * - swap:    the values at two positions were exchanged.
 * - write:   a value was stored at a position (merge sort copies rather than swaps).
 */
export type Step =
  | { type: 'compare'; i: number; j: number }
  | { type: 'swap'; i: number; j: number }
  | { type: 'write'; i: number; value: number };

export interface Counts {
  comparisons: number;
  swaps: number;
  writes: number;
}

export interface SortTrace {
  steps: Step[];
  /** The array after all steps have been applied. */
  result: number[];
  counts: Counts;
}

/** Applies one step to an array in place. */
export function applyStep(array: number[], step: Step): void {
  if (step.type === 'swap') {
    const tmp = array[step.i];
    array[step.i] = array[step.j];
    array[step.j] = tmp;
  } else if (step.type === 'write') {
    array[step.i] = step.value;
  }
}

/** Replays the first `upTo` steps on a copy of `input`. */
export function replay(input: readonly number[], steps: readonly Step[], upTo = steps.length) {
  const array = [...input];
  const counts: Counts = { comparisons: 0, swaps: 0, writes: 0 };
  const end = Math.min(upTo, steps.length);
  for (let k = 0; k < end; k++) {
    applyStep(array, steps[k]);
    tally(counts, steps[k], 1);
  }
  return { array, counts };
}

/** Adds (or with sign -1, removes) one step from the running counts. */
export function tally(counts: Counts, step: Step, sign: 1 | -1): void {
  if (step.type === 'compare') counts.comparisons += sign;
  else if (step.type === 'swap') counts.swaps += sign;
  else counts.writes += sign;
}

/** Records the steps a sorting algorithm takes on its working copy of the input. */
export class Recorder {
  readonly array: number[];
  readonly steps: Step[] = [];

  constructor(input: readonly number[]) {
    this.array = [...input];
  }

  get length(): number {
    return this.array.length;
  }

  /** Compares positions i and j; negative when array[i] < array[j]. */
  compare(i: number, j: number): number {
    this.steps.push({ type: 'compare', i, j });
    return this.array[i] - this.array[j];
  }

  swap(i: number, j: number): void {
    if (i === j) return;
    this.steps.push({ type: 'swap', i, j });
    const tmp = this.array[i];
    this.array[i] = this.array[j];
    this.array[j] = tmp;
  }

  write(i: number, value: number): void {
    this.steps.push({ type: 'write', i, value });
    this.array[i] = value;
  }

  /**
   * Records a comparison whose outcome the caller decides, for algorithms that
   * compare buffered copies (merge sort) rather than the live array.
   */
  mark(i: number, j: number): void {
    this.steps.push({ type: 'compare', i, j });
  }

  finish(): SortTrace {
    const counts: Counts = { comparisons: 0, swaps: 0, writes: 0 };
    for (const step of this.steps) tally(counts, step, 1);
    return { steps: this.steps, result: this.array, counts };
  }
}
