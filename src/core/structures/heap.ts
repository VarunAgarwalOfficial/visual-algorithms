import { marks, type Marks, type StepFrame } from './trace';

export interface HeapItem {
  id: number;
  value: number;
}

export interface HeapFrame extends StepFrame {
  items: HeapItem[];
  /** Highlights by array index. */
  hi: Marks;
  /** Counted since the current operation began. */
  comparisons: number;
  swaps: number;
  /** Values extracted so far, oldest first. */
  out: number[];
}

export const HEAP_CAPACITY = 31;

/** A binary heap in an array. Every public operation appends frames describing what it did. */
export class BinaryHeap {
  readonly frames: HeapFrame[] = [];
  private items: HeapItem[] = [];
  private out: number[] = [];
  private comparisons = 0;
  private swaps = 0;
  private nextId = 1;

  constructor(readonly max = false) {
    this.emit(`An empty ${this.kind}-heap.`);
  }

  get size(): number {
    return this.items.length;
  }

  values(): number[] {
    return this.items.map((item) => item.value);
  }

  private get kind() {
    return this.max ? 'max' : 'min';
  }
  private get word() {
    return this.max ? 'larger' : 'smaller';
  }

  private emit(caption: string, hi: Marks = new Map()) {
    this.frames.push({
      caption,
      items: [...this.items],
      hi,
      comparisons: this.comparisons,
      swaps: this.swaps,
      out: [...this.out],
    });
  }

  private begin() {
    this.comparisons = 0;
    this.swaps = 0;
  }

  /** True when a should sit above b. */
  private above(a: number, b: number): boolean {
    this.comparisons++;
    const x = this.items[a].value;
    const y = this.items[b].value;
    return this.max ? x > y : x < y;
  }

  private swap(i: number, j: number) {
    [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    this.swaps++;
  }

  private siftUp(start: number) {
    let i = start;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const v = this.items[i].value;
      const pv = this.items[p].value;
      const moves = this.above(i, p);
      this.emit(
        `Index ${i} holds ${v}. Its parent is at (${i} − 1) / 2 = ${p} and holds ${pv}. ` +
          (moves ? `${v} is ${this.word}, so swap.` : `${v} is not ${this.word}, so it stays.`),
        marks([i, 'compare'], [p, 'compare']),
      );
      if (!moves) return;
      this.swap(i, p);
      this.emit(`Swapped ${v} up to index ${p}.`, marks([i, 'change'], [p, 'change']));
      i = p;
    }
    this.emit(`${this.items[0].value} reached the root.`, marks([0, 'good']));
  }

  private siftDown(start: number) {
    const n = this.items.length;
    let i = start;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      if (l >= n) {
        if (i !== start) this.emit(`Index ${i} has no children, so it stops.`, marks([i, 'good']));
        return;
      }
      let best = l;
      if (r < n && this.above(r, l)) best = r;
      const v = this.items[i].value;
      const bv = this.items[best].value;
      const kids =
        r < n
          ? `Children of index ${i} are at 2·${i} + 1 = ${l} and 2·${i} + 2 = ${r}; the ${this.word} is ${bv}.`
          : `Index ${i} has one child, at 2·${i} + 1 = ${l}, holding ${bv}.`;
      const moves = this.above(best, i);
      const hi = marks(
        [i, 'compare'],
        [l, 'visit'],
        [r < n ? r : null, 'visit'],
        [best, 'compare'],
      );
      this.emit(
        `${kids} ` +
          (moves
            ? `${bv} is ${this.word} than ${v}, so swap.`
            : `${v} is already in place above it.`),
        hi,
      );
      if (!moves) return;
      this.swap(i, best);
      this.emit(`Swapped ${v} down to index ${best}.`, marks([i, 'change'], [best, 'change']));
      i = best;
    }
  }

  insert(value: number, counted = true): boolean {
    if (counted) this.begin();
    if (this.items.length >= HEAP_CAPACITY) {
      this.emit(`The heap is full (${HEAP_CAPACITY} items); ${value} was not added.`);
      return false;
    }
    this.items.push({ id: this.nextId++, value });
    const i = this.items.length - 1;
    this.emit(`Put ${value} at the end of the array, index ${i}.`, marks([i, 'change']));
    if (i > 0) this.siftUp(i);
    if (counted) this.summary(`Inserted ${value}`);
    return true;
  }

  extract(): number | undefined {
    this.begin();
    const n = this.items.length;
    if (n === 0) {
      this.emit('The heap is empty; nothing to extract.');
      return undefined;
    }
    const top = this.items[0].value;
    if (n > 1) {
      this.emit(
        `The root, ${top}, is the ${this.max ? 'maximum' : 'minimum'}. Swap it with the last item, index ${n - 1}.`,
        marks([0, 'compare'], [n - 1, 'compare']),
      );
      this.swap(0, n - 1);
      this.emit(`Swapped. ${top} is now at the end.`, marks([0, 'change'], [n - 1, 'change']));
    }
    this.items.pop();
    this.out.push(top);
    if (this.items.length > 1) {
      this.emit(`Removed ${top}. Sift the new root down.`, marks([0, 'compare']));
      this.siftDown(0);
    }
    this.summary(`Extracted ${top}`);
    return top;
  }

  /** Replaces the contents with `values` and builds a heap, bottom-up (Floyd) or by n inserts. */
  build(values: readonly number[], method: 'floyd' | 'inserts') {
    this.begin();
    const input = values.slice(0, HEAP_CAPACITY);
    this.items = [];
    this.out = [];
    if (method === 'inserts') {
      this.emit(`Build by ${input.length} inserts, starting from an empty heap.`);
      for (const value of input) this.insert(value, false);
      this.summary(`Built by ${input.length} inserts`);
      return;
    }
    this.items = input.map((value) => ({ id: this.nextId++, value }));
    const n = this.items.length;
    const lastParent = (n >> 1) - 1;
    this.emit(
      n < 2
        ? 'The array as given. It is already a heap.'
        : `The array as given. Leaves are heaps already, so start at the last parent, index ${n} / 2 − 1 = ${lastParent}, and work back to the root.`,
    );
    for (let i = lastParent; i >= 0; i--) {
      this.emit(`Sift down from index ${i}.`, marks([i, 'compare']));
      this.siftDown(i);
    }
    this.summary('Bottom-up build finished');
  }

  private summary(what: string) {
    const c = this.comparisons;
    const s = this.swaps;
    this.emit(
      `${what}: ${c} comparison${c === 1 ? '' : 's'}, ${s} swap${s === 1 ? '' : 's'}.`,
      new Map(),
    );
  }

  /** The heap property, for tests: every item sits below a parent that may come before it. */
  valid(): boolean {
    return this.items.every((item, i) => {
      if (i === 0) return true;
      const parent = this.items[(i - 1) >> 1].value;
      return this.max ? parent >= item.value : parent <= item.value;
    });
  }
}
