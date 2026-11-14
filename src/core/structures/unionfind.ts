import { marks, type Marks, type StepFrame } from './trace';

export type UnionRule = 'rank' | 'size' | 'none';

export interface UnionFindFrame extends StepFrame {
  parent: number[];
  /** Rank or size of each root, depending on the rule (unused for 'none'). */
  weight: number[];
  /** Highlights by element. */
  hi: Marks;
  /** Parent pointers followed in the current operation, and since the start. */
  hops: number;
  totalHops: number;
  sets: number;
}

/** Disjoint sets as a forest of parent pointers. */
export class UnionFind {
  readonly frames: UnionFindFrame[] = [];
  private parent: number[];
  private weight: number[];
  private hops = 0;
  private totalHops = 0;
  private sets: number;

  constructor(
    readonly n: number,
    readonly rule: UnionRule,
    readonly compression: boolean,
  ) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.weight = new Array<number>(n).fill(rule === 'size' ? 1 : 0);
    this.sets = n;
    this.emit(`${n} elements, each in its own set and its own root.`);
  }

  private emit(caption: string, hi: Marks = new Map()) {
    this.frames.push({
      caption,
      parent: [...this.parent],
      weight: [...this.weight],
      hi,
      hops: this.hops,
      totalHops: this.totalHops,
      sets: this.sets,
    });
  }

  /** Finds the root of x, recording the walk and, when enabled, the compression. */
  private walk(x: number): number {
    const path = [x];
    while (this.parent[path[path.length - 1]] !== path[path.length - 1]) {
      const at = path[path.length - 1];
      const up = this.parent[at];
      this.hops++;
      this.totalHops++;
      path.push(up);
      this.emit(
        `parent[${at}] = ${up}: step up.`,
        marks(...path.map((node) => [node, 'visit'] as const), [up, 'compare']),
      );
    }
    const root = path[path.length - 1];
    const trail = path.map((node) => [node, 'visit'] as const);
    this.emit(
      path.length === 1
        ? `${x} is its own parent, so it is a root.`
        : `${root} is its own parent: it is the root of the set holding ${x}, ${path.length - 1} hop${path.length === 2 ? '' : 's'} away.`,
      marks(...trail, [root, 'good']),
    );
    if (this.compression) {
      for (const node of path.slice(0, -2)) {
        this.parent[node] = root;
        this.emit(
          `Path compression: point ${node} straight at the root ${root}.`,
          marks(...trail, [node, 'change'], [root, 'good']),
        );
      }
    }
    return root;
  }

  find(x: number): number {
    this.hops = 0;
    return this.walk(x);
  }

  union(a: number, b: number): boolean {
    this.hops = 0;
    const ra = this.walk(a);
    const rb = this.walk(b);
    if (ra === rb) {
      this.emit(`${a} and ${b} have the same root ${ra}: already in one set.`, marks([ra, 'good']));
      return false;
    }
    let child = ra;
    let root = rb;
    let why = `No balancing rule: the root of ${a} goes under the root of ${b}.`;
    if (this.rule !== 'none') {
      const name = this.rule;
      const wa = this.weight[ra];
      const wb = this.weight[rb];
      if (wa > wb) [child, root] = [rb, ra];
      why =
        wa === wb
          ? `Both roots have ${name} ${wa}, so either may go under the other.`
          : `Root ${root} has ${name} ${this.weight[root]}, root ${child} has ${name} ${this.weight[child]}: the smaller goes under the larger.`;
      if (name === 'size') this.weight[root] += this.weight[child];
      else if (wa === wb) this.weight[root]++;
    }
    this.parent[child] = root;
    this.sets--;
    const grew =
      this.rule === 'rank' && this.weight[root] > this.weight[child] && why.startsWith('Both')
        ? ` The rank of ${root} rises to ${this.weight[root]}.`
        : '';
    this.emit(
      `${why} Set parent[${child}] = ${root}.${grew}`,
      marks([child, 'change'], [root, 'good']),
    );
    return true;
  }

  /** The current root of x, without recording or compressing. */
  rootOf(x: number): number {
    let at = x;
    while (this.parent[at] !== at) at = this.parent[at];
    return at;
  }

  /** Length of the longest chain of parent pointers. */
  tallest(): number {
    let best = 0;
    for (let i = 0; i < this.n; i++) {
      let depth = 0;
      for (let at = i; this.parent[at] !== at; at = this.parent[at]) depth++;
      best = Math.max(best, depth);
    }
    return best;
  }
}
