import { marks, type Marks, type StepFrame } from './trace';

export type HashScheme = 'linear' | 'quadratic' | 'double' | 'chain';

export interface HashCell {
  id: number;
  key: number;
  /** A deleted entry that probes must still walk past. */
  tomb: boolean;
}

export interface HashFrame extends StepFrame {
  m: number;
  /** Open addressing: one cell or null per slot. Chaining: unused (all null). */
  slots: (HashCell | null)[];
  /** Chaining: the list in each bucket. Open addressing: unused (all empty). */
  chains: HashCell[][];
  /** Highlights by slot number. */
  hi: Marks;
  /** Highlighted entry inside a chain, by cell id. */
  cell: number;
  /** Slots looked at in the current operation, and since the start. */
  probes: number;
  totalProbes: number;
  operations: number;
  live: number;
  tombs: number;
}

/** Table sizes, all prime: each is the first prime past twice the one before. */
export const HASH_SIZES = [11, 23, 47] as const;

export class HashTable {
  readonly frames: HashFrame[] = [];
  private m: number = HASH_SIZES[0];
  private slots: (HashCell | null)[] = [];
  private chains: HashCell[][] = [];
  private live = 0;
  private tombs = 0;
  private probes = 0;
  private totalProbes = 0;
  private operations = 0;
  private nextId = 1;

  /** `threshold` is the load factor past which the table grows. */
  constructor(
    readonly scheme: HashScheme,
    readonly threshold = 0.7,
  ) {
    this.allocate(this.m);
    this.emit(`An empty table with ${this.m} ${scheme === 'chain' ? 'buckets' : 'slots'}.`);
  }

  get size(): number {
    return this.live;
  }
  get capacity(): number {
    return this.m;
  }

  private allocate(m: number) {
    this.m = m;
    this.slots = new Array<HashCell | null>(m).fill(null);
    this.chains = Array.from({ length: m }, () => []);
    this.tombs = 0;
  }

  private emit(caption: string, hi: Marks = new Map(), cell = 0) {
    this.frames.push({
      caption,
      m: this.m,
      slots: this.slots.map((slot) => (slot ? { ...slot } : null)),
      chains: this.chains.map((chain) => chain.map((entry) => ({ ...entry }))),
      hi,
      cell,
      probes: this.probes,
      totalProbes: this.totalProbes,
      operations: this.operations,
      live: this.live,
      tombs: this.tombs,
    });
  }

  private begin() {
    this.probes = 0;
    this.operations++;
  }

  private count() {
    this.probes++;
    this.totalProbes++;
  }

  private step(key: number): number {
    return 1 + (key % (this.m - 1));
  }

  /** Slot tried on attempt i (0-based) for `key`. */
  private at(key: number, i: number): number {
    const h = key % this.m;
    if (this.scheme === 'quadratic') return (h + i * i) % this.m;
    if (this.scheme === 'double') return (h + i * this.step(key)) % this.m;
    return (h + i) % this.m;
  }

  private rule(key: number, i: number): string {
    const h = key % this.m;
    const s = this.at(key, i);
    if (this.scheme === 'quadratic') return `(${h} + ${i}²) mod ${this.m} = ${s}`;
    if (this.scheme === 'double') return `(${h} + ${i}·${this.step(key)}) mod ${this.m} = ${s}`;
    return `(${h} + ${i}) mod ${this.m} = ${s}`;
  }

  private start(key: number): number {
    const h = key % this.m;
    const extra =
      this.scheme === 'double'
        ? ` The step for this key is 1 + (${key} mod ${this.m - 1}) = ${this.step(key)}.`
        : '';
    this.emit(`h(${key}) = ${key} mod ${this.m} = ${h}.${extra}`, marks([h, 'compare']));
    return h;
  }

  /**
   * Probes for `key` in an open-addressing table. Returns where it is, or the
   * slot an insert should use (-1 when the probe sequence found nowhere).
   */
  private probe(key: number, record: boolean): { found: number; free: number } {
    let free = -1;
    const seen: number[] = [];
    const trail = () => seen.map((s) => [s, 'visit'] as const);
    for (let i = 0; i < this.m; i++) {
      const s = this.at(key, i);
      const slot = this.slots[s];
      if (record) this.count();
      const how = i === 0 ? `Slot ${s}` : `Probe ${i}: ${this.rule(key, i)}. Slot ${s}`;
      if (!slot) {
        if (record) this.emit(`${how} is empty.`, marks(...trail(), [s, 'compare']));
        return { found: -1, free: free >= 0 ? free : s };
      }
      if (slot.tomb) {
        if (free < 0) free = s;
        if (record) {
          this.emit(
            `${how} is a tombstone: something was deleted here, so keep going.`,
            marks(...trail(), [s, 'compare']),
          );
        }
      } else if (slot.key === key) {
        if (record) this.emit(`${how} holds ${key}.`, marks(...trail(), [s, 'good']));
        return { found: s, free };
      } else if (record) {
        this.emit(
          `${how} holds ${slot.key}, not ${key}: collision.`,
          marks(...trail(), [s, 'compare']),
        );
      }
      seen.push(s);
    }
    return { found: -1, free };
  }

  has(key: number): boolean {
    if (this.scheme === 'chain') return this.chains[key % this.m].some((c) => c.key === key);
    return this.probe(key, false).found >= 0;
  }

  /** Walks the chain for `key`; returns the entry if present. */
  private scan(key: number, h: number): HashCell | undefined {
    const chain = this.chains[h];
    for (const entry of chain) {
      this.count();
      if (entry.key === key) {
        this.emit(`Bucket ${h}: ${entry.key} is the key.`, marks([h, 'good']), entry.id);
        return entry;
      }
      this.emit(
        `Bucket ${h}: ${entry.key} is not ${key}, follow the chain.`,
        marks([h, 'compare']),
        entry.id,
      );
    }
    if (chain.length === 0) {
      this.count();
      this.emit(`Bucket ${h} is empty.`, marks([h, 'compare']));
    }
    return undefined;
  }

  find(key: number): boolean {
    this.begin();
    const h = this.start(key);
    const found =
      this.scheme === 'chain' ? this.scan(key, h) !== undefined : this.probe(key, true).found >= 0;
    this.emit(
      `${key} is ${found ? 'in the table' : 'not in the table'}: ${this.probes} probe${this.probes === 1 ? '' : 's'}.`,
    );
    return found;
  }

  insert(key: number): boolean {
    this.begin();
    const h = this.start(key);
    if (this.scheme === 'chain') {
      if (this.scan(key, h)) {
        this.emit(`${key} is already in the table.`);
        return false;
      }
      const entry = { id: this.nextId++, key, tomb: false };
      this.chains[h].push(entry);
      this.live++;
      this.emit(
        `Add ${key} to the end of the chain in bucket ${h}.`,
        marks([h, 'change']),
        entry.id,
      );
    } else {
      const { found, free } = this.probe(key, true);
      if (found >= 0) {
        this.emit(`${key} is already in the table.`, marks([found, 'good']));
        return false;
      }
      if (free < 0) {
        this.emit(
          this.scheme === 'quadratic'
            ? `No free slot in ${this.m} probes. Quadratic probing only reaches about half the slots, so it can fail before the table is full. ${key} was not inserted.`
            : `The table is full. ${key} was not inserted.`,
        );
        return false;
      }
      const reused = this.slots[free] !== null;
      this.slots[free] = { id: this.nextId++, key, tomb: false };
      this.live++;
      if (reused) this.tombs--;
      this.emit(
        `Store ${key} in slot ${free}${reused ? ', reusing the first tombstone on its path' : ''}: ${this.probes} probe${this.probes === 1 ? '' : 's'}.`,
        marks([free, 'change']),
      );
    }
    this.grow();
    return true;
  }

  delete(key: number): boolean {
    this.begin();
    const h = this.start(key);
    if (this.scheme === 'chain') {
      const entry = this.scan(key, h);
      if (!entry) {
        this.emit(`${key} is not in the table; nothing to delete.`);
        return false;
      }
      this.chains[h] = this.chains[h].filter((c) => c !== entry);
      this.live--;
      this.emit(`Unlink ${key} from the chain in bucket ${h}.`, marks([h, 'change']));
      return true;
    }
    const { found } = this.probe(key, true);
    if (found < 0) {
      this.emit(`${key} is not in the table; nothing to delete.`);
      return false;
    }
    (this.slots[found] as HashCell).tomb = true;
    this.live--;
    this.tombs++;
    this.emit(
      `Delete ${key} but leave a tombstone in slot ${found}. Emptying the slot would cut the probe path of keys stored after it.`,
      marks([found, 'change']),
    );
    return true;
  }

  /** Rehashes into the next size when the load factor (tombstones included) passes the threshold. */
  private grow() {
    const used = this.live + this.tombs;
    if (used / this.m <= this.threshold) return;
    const next = HASH_SIZES[HASH_SIZES.indexOf(this.m as (typeof HASH_SIZES)[number]) + 1];
    const load = `${used} / ${this.m} = ${(used / this.m).toFixed(2)}`;
    const entries = [...this.slots, ...this.chains.flat()].filter(
      (cell): cell is HashCell => cell !== null && !cell.tomb,
    );
    if (!next) {
      if (this.tombs === 0) return;
      this.emit(
        `Load factor ${load} is past ${this.threshold}. The table is at its largest size here, so rehash in place to clear the tombstones.`,
      );
      this.allocate(this.m);
    } else {
      this.emit(
        `Load factor ${load} is past ${this.threshold}. Allocate ${next} slots and rehash every key: the slot depends on the table size.`,
      );
      this.allocate(next);
    }
    for (const entry of entries) {
      const h = entry.key % this.m;
      if (this.scheme === 'chain') {
        this.chains[h].push(entry);
        this.emit(
          `Rehash ${entry.key}: ${entry.key} mod ${this.m} = ${h}.`,
          marks([h, 'change']),
          entry.id,
        );
        continue;
      }
      const { free } = this.probe(entry.key, false);
      let tries = 0;
      while (this.at(entry.key, tries) !== free) tries++;
      this.slots[free] = entry;
      this.emit(
        `Rehash ${entry.key}: ${entry.key} mod ${this.m} = ${h}` +
          (tries === 0 ? '.' : `, taken; it lands in slot ${free} after ${tries + 1} probes.`),
        marks([h, 'visit'], [free, 'change']),
      );
    }
    this.emit(
      `Rehash finished. Load factor is now ${this.live} / ${this.m} = ${(this.live / this.m).toFixed(2)}.`,
    );
  }

  keys(): number[] {
    return [...this.slots, ...this.chains.flat()]
      .filter((cell): cell is HashCell => cell !== null && !cell.tomb)
      .map((cell) => cell.key)
      .sort((a, b) => a - b);
  }
}
