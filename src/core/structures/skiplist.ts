import type { Random } from '../random';
import { type Marks, type Role, type StepFrame } from './trace';

interface Node {
  id: number;
  key: number;
  /** next[level]; undefined while a new tower is still being linked in at that level. */
  next: (Node | null | undefined)[];
}

export interface SkipNodeSnap {
  id: number;
  key: number;
  /** Id of the next node on each level; null is the end of the list, undefined is not linked yet. */
  next: (number | null | undefined)[];
}

export interface SkipFrame extends StepFrame {
  /** Head first (id 0), then the towers in key order. */
  nodes: SkipNodeSnap[];
  /** Highlights by "nodeId:level". */
  hi: Marks<string>;
  /** The coin flips that chose the last tower height: true is heads. */
  flips: boolean[] | null;
  size: number;
  /** Levels in use. */
  levels: number;
  /** Key comparisons in the current operation. */
  comparisons: number;
}

export const SKIP_MAX_LEVEL = 5;

type Mark = readonly [Node, number, Role];

/** A skip list with towers of random height: each extra level is one more coin flip landing heads. */
export class SkipList {
  readonly frames: SkipFrame[] = [];
  private head: Node = {
    id: 0,
    key: -Infinity,
    next: new Array<Node | null>(SKIP_MAX_LEVEL).fill(null),
  };
  private levels = 1;
  private count = 0;
  private comparisons = 0;
  private nextId = 1;

  constructor(private readonly random: Random) {
    this.emit('An empty skip list: only the head tower.');
  }

  get size(): number {
    return this.count;
  }

  private emit(caption: string, hi: readonly Mark[] = [], flips: boolean[] | null = null) {
    const nodes: SkipNodeSnap[] = [];
    for (let node: Node | null | undefined = this.head; node; node = node.next[0]) {
      nodes.push({
        id: node.id,
        key: node.key,
        next: node.next.map((next) => (next ? next.id : next)),
      });
    }
    this.frames.push({
      caption,
      nodes,
      hi: new Map(hi.map(([node, level, role]) => [`${node.id}:${level}`, role])),
      flips,
      size: this.count,
      levels: this.levels,
      comparisons: this.comparisons,
    });
  }

  /**
   * Walks from the top-left towards `key`. Returns, for each level, the last
   * node before the key (the nodes whose pointers an insert or delete changes).
   */
  private search(key: number): { update: Node[]; trail: Mark[] } {
    const update: Node[] = new Array<Node>(SKIP_MAX_LEVEL).fill(this.head);
    const trail: Mark[] = [];
    let node = this.head;
    for (let level = this.levels - 1; level >= 0; level--) {
      for (;;) {
        const next = node.next[level];
        const here: Mark = [node, level, 'compare'];
        if (next) this.comparisons++;
        if (next && next.key < key) {
          this.emit(
            `Level ${level + 1}: the next key ${next.key} is less than ${key}, so move right.`,
            [...trail, here],
          );
          trail.push([node, level, 'visit']);
          node = next;
          continue;
        }
        const why = next
          ? next.key === key
            ? `the next key is ${key} itself`
            : `the next key ${next.key} is greater than ${key}`
          : 'the list ends here';
        this.emit(
          `Level ${level + 1}: ${why}, so ${level > 0 ? 'drop down a level' : 'the search stops'}.`,
          [...trail, here],
        );
        trail.push([node, level, 'visit']);
        break;
      }
      update[level] = node;
    }
    return { update, trail };
  }

  has(key: number): boolean {
    let node = this.head;
    for (let level = this.levels - 1; level >= 0; level--) {
      for (let next = node.next[level]; next && next.key < key; next = node.next[level])
        node = next;
    }
    return node.next[0]?.key === key;
  }

  find(key: number): boolean {
    this.comparisons = 0;
    const { update, trail } = this.search(key);
    const hit = update[0].next[0];
    if (hit && hit.key === key) {
      this.emit(`Found ${key} after ${this.comparisons} comparisons.`, [
        ...trail,
        [hit, 0, 'good'],
      ]);
      return true;
    }
    this.emit(`${key} is not in the list (${this.comparisons} comparisons).`, trail);
    return false;
  }

  insert(key: number): boolean {
    this.comparisons = 0;
    const { update, trail } = this.search(key);
    const hit = update[0].next[0];
    if (hit && hit.key === key) {
      this.emit(`${key} is already in the list.`, [...trail, [hit, 0, 'good']]);
      return false;
    }
    const flips: boolean[] = [];
    let height = 1;
    while (height < SKIP_MAX_LEVEL) {
      const heads = this.random() < 0.5;
      flips.push(heads);
      if (!heads) break;
      height++;
    }
    const shown = flips.map((heads) => (heads ? 'heads' : 'tails')).join(', ');
    this.emit(
      `Flip a coin until it lands tails: ${shown || 'no flips left'}. ` +
        `${height - 1} head${height === 2 ? '' : 's'}, so the tower for ${key} is ${height} level${height === 1 ? '' : 's'} tall` +
        (height === SKIP_MAX_LEVEL ? ' (the cap here).' : '.'),
      trail,
      flips,
    );
    const node: Node = {
      id: this.nextId++,
      key,
      next: new Array<undefined>(height).fill(undefined),
    };
    this.levels = Math.max(this.levels, height);
    this.count++;
    for (let level = 0; level < height; level++) {
      const before = update[level];
      const after = before.next[level] ?? null;
      node.next[level] = after;
      before.next[level] = node;
      this.emit(
        `Level ${level + 1}: splice ${key} in after ${before === this.head ? 'the head' : before.key}` +
          (after ? `, before ${after.key}.` : ', at the end.'),
        [
          [before, level, 'compare'],
          [node, level, 'change'],
        ],
        flips,
      );
    }
    this.emit(`Inserted ${key}: ${height} pointer${height === 1 ? '' : 's'} changed.`, [], flips);
    return true;
  }

  delete(key: number): boolean {
    this.comparisons = 0;
    const { update, trail } = this.search(key);
    const node = update[0].next[0];
    if (!node || node.key !== key) {
      this.emit(`${key} is not in the list; nothing to delete.`, trail);
      return false;
    }
    this.emit(
      `Found ${key}. Its tower is ${node.next.length} level${node.next.length === 1 ? '' : 's'} tall; unlink it on each.`,
      node.next.map((_, level) => [node, level, 'compare'] as const),
    );
    for (let level = node.next.length - 1; level >= 0; level--) {
      const before = update[level];
      before.next[level] = node.next[level] ?? null;
      const after = before.next[level];
      if (level === 0) this.count--;
      this.emit(
        `Level ${level + 1}: ${before === this.head ? 'the head' : before.key} now points past ${key} to ${after ? after.key : 'the end'}.`,
        [[before, level, 'change']],
      );
    }
    while (this.levels > 1 && !this.head.next[this.levels - 1]) this.levels--;
    this.emit(`Deleted ${key}.`);
    return true;
  }

  keys(): number[] {
    const out: number[] = [];
    for (let node = this.head.next[0]; node; node = node.next[0]) out.push(node.key);
    return out;
  }

  /** True when every level is sorted and is a sub-sequence of the level below. */
  valid(): boolean {
    for (let level = 0; level < SKIP_MAX_LEVEL; level++) {
      let last = -Infinity;
      for (let node = this.head.next[level]; node; node = node.next[level]) {
        if (node.key <= last || node.next.length <= level) return false;
        last = node.key;
      }
    }
    return true;
  }
}
