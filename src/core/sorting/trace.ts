/**
 * A sort is recorded as a list of steps, so that playback (pause, step, scrub,
 * speed) is just moving a cursor through data.
 *
 * - compare: two positions were read and compared. Does not change the array.
 * - swap:    the values at two positions were exchanged.
 * - write:   a value was stored at a position (merges and bucket sorts copy
 *            rather than swap). `bucket` says which bucket it was taken from.
 * - read:    a value was read and tallied in a bucket, without being compared
 *            with anything (counting and radix sort).
 *
 * Marks sit beside the steps and say what the algorithm is working on from a
 * given step onwards: a gap, a digit, the runs being merged. They are not
 * steps, so they never count as operations.
 */
export type Step =
  | { type: 'compare'; i: number; j: number }
  | { type: 'swap'; i: number; j: number }
  | { type: 'write'; i: number; value: number; bucket?: number }
  | { type: 'read'; i: number; bucket: number };

/** A half-open range of positions, [lo, hi). */
export type Range = readonly [lo: number, hi: number];

export interface Mark {
  /** Index of the first step this mark covers. */
  at: number;
  label: string;
  /** Ranges to colour, such as the runs found so far or the halves being merged. */
  ranges?: readonly Range[];
  /** Starts a fresh set of buckets: how many, and the value the first one stands for. */
  buckets?: { count: number; base: number };
}

export interface Counts {
  comparisons: number;
  swaps: number;
  writes: number;
  reads: number;
}

export interface SortTrace {
  steps: Step[];
  marks: Mark[];
  /** The array after all steps have been applied. */
  result: number[];
  counts: Counts;
}

export const zeroCounts = (): Counts => ({ comparisons: 0, swaps: 0, writes: 0, reads: 0 });

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

/** Adds (or with sign -1, removes) one step from the running counts. */
export function tally(counts: Counts, step: Step, sign: 1 | -1): void {
  if (step.type === 'compare') counts.comparisons += sign;
  else if (step.type === 'swap') counts.swaps += sign;
  else if (step.type === 'write') counts.writes += sign;
  else counts.reads += sign;
}

/** Replays the first `upTo` steps on a copy of `input`. */
export function replay(input: readonly number[], steps: readonly Step[], upTo = steps.length) {
  const array = [...input];
  const counts = zeroCounts();
  const end = Math.min(upTo, steps.length);
  for (let k = 0; k < end; k++) {
    applyStep(array, steps[k]);
    tally(counts, steps[k], 1);
  }
  return { array, counts };
}

/**
 * A cursor through a trace: the array, counts, bucket tallies and current mark
 * after `position` steps. Moving forwards applies only the new steps; moving
 * backwards replays from the start.
 */
export class Playback {
  readonly input: readonly number[];
  readonly trace: SortTrace;
  array: number[];
  counts: Counts = zeroCounts();
  /** Bucket tallies of the current pass: a read adds one, a write from a bucket removes one. */
  buckets: number[] = [];
  bucketBase = 0;
  position = 0;
  private nextMark = 0;

  constructor(input: readonly number[], trace: SortTrace) {
    this.input = input;
    this.trace = trace;
    this.array = [...input];
  }

  get length(): number {
    return this.trace.steps.length;
  }

  get done(): boolean {
    return this.position >= this.length;
  }

  /** The step applied most recently, if any. */
  get last(): Step | undefined {
    return this.position > 0 ? this.trace.steps[this.position - 1] : undefined;
  }

  /** The mark covering the most recent step. */
  get mark(): Mark | undefined {
    return this.nextMark > 0 ? this.trace.marks[this.nextMark - 1] : undefined;
  }

  seek(to: number): void {
    const target = Math.max(0, Math.min(this.length, Math.round(to)));
    if (target < this.position) {
      this.array = [...this.input];
      this.counts = zeroCounts();
      this.buckets = [];
      this.bucketBase = 0;
      this.position = 0;
      this.nextMark = 0;
    }
    const { steps, marks } = this.trace;
    for (; this.position < target; this.position++) {
      while (this.nextMark < marks.length && marks[this.nextMark].at <= this.position) {
        const fresh = marks[this.nextMark++].buckets;
        if (fresh) {
          this.buckets = new Array<number>(fresh.count).fill(0);
          this.bucketBase = fresh.base;
        }
      }
      const step = steps[this.position];
      applyStep(this.array, step);
      tally(this.counts, step, 1);
      if (step.type === 'read') this.buckets[step.bucket]++;
      else if (step.type === 'write' && step.bucket !== undefined) this.buckets[step.bucket]--;
    }
  }
}

/** Records the steps a sorting algorithm takes on its working copy of the input. */
export class Recorder {
  readonly array: number[];
  readonly steps: Step[] = [];
  readonly marks: Mark[] = [];

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

  write(i: number, value: number, bucket?: number): void {
    this.steps.push(
      bucket === undefined ? { type: 'write', i, value } : { type: 'write', i, value, bucket },
    );
    this.array[i] = value;
  }

  /** Reads position i into a bucket and returns the value. */
  read(i: number, bucket: number): number {
    this.steps.push({ type: 'read', i, bucket });
    return this.array[i];
  }

  /** Says what the steps from here on are doing. */
  mark(label: string, extra: Omit<Mark, 'at' | 'label'> = {}): void {
    const mark: Mark = { at: this.steps.length, label, ...extra };
    // A mark that covered no steps is replaced, unless it opened a set of buckets.
    const previous = this.marks[this.marks.length - 1];
    if (previous && previous.at === mark.at && !previous.buckets) this.marks.pop();
    this.marks.push(mark);
  }

  finish(): SortTrace {
    const counts = zeroCounts();
    for (const step of this.steps) tally(counts, step, 1);
    return { steps: this.steps, marks: this.marks, result: this.array, counts };
  }
}
