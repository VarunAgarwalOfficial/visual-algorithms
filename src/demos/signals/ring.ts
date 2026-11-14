/**
 * A fixed-size stack of reusable snapshot buffers: pushing onto a full ring
 * overwrites the oldest entry. Used for the Back button of the grid simulations,
 * where allocating a copy of the grid every tick would churn memory.
 */
export interface Ring<S> {
  /** Takes the next slot and lets `fill` copy the current state into it. */
  push(fill: (slot: S) => void): void;
  /** The most recent snapshot, removed from the ring; undefined when empty. */
  pop(): S | undefined;
  clear(): void;
  readonly size: number;
}

export function snapshotRing<S>(capacity: number, make: () => S): Ring<S> {
  const slots: S[] = [];
  let start = 0;
  let size = 0;
  return {
    push(fill) {
      const at = (start + size) % capacity;
      fill((slots[at] ??= make()));
      if (size < capacity) size++;
      else start = (start + 1) % capacity;
    },
    pop() {
      if (size === 0) return undefined;
      size--;
      return slots[(start + size) % capacity];
    },
    clear() {
      start = 0;
      size = 0;
    },
    get size() {
      return size;
    },
  };
}
