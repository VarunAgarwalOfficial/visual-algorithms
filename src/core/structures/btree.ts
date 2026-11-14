import { marks, type Marks, type Role, type StepFrame } from './trace';

interface Node {
  id: number;
  keys: number[];
  /** Empty for a leaf, otherwise keys.length + 1 children. */
  kids: Node[];
}

export interface BTreeSnap {
  id: number;
  keys: number[];
  kids: BTreeSnap[];
}

export interface BTreeFrame extends StepFrame {
  root: BTreeSnap;
  /** Highlights by node id. */
  hi: Marks;
  /** Keys to pick out inside the highlighted nodes. */
  keys: number[];
  size: number;
  height: number;
  splits: number;
  merges: number;
}

type Mark = readonly [Node | null, Role];

const snap = (node: Node): BTreeSnap => ({
  id: node.id,
  keys: [...node.keys],
  kids: node.kids.map(snap),
});
const list = (keys: readonly number[]) => `[${keys.join(' ')}]`;

/** First index whose key is not less than `key`. */
function slot(keys: readonly number[], key: number): number {
  let i = 0;
  while (i < keys.length && keys[i] < key) i++;
  return i;
}

/**
 * A B-tree of minimum degree t: every node except the root holds t − 1 to
 * 2t − 1 keys. Insertion adds to a leaf and splits overfull nodes upwards;
 * deletion tops up each node on the way down, so it never has to back up.
 */
export class BTree {
  readonly frames: BTreeFrame[] = [];
  splits = 0;
  merges = 0;
  private root: Node;
  private count = 0;
  private nextId = 1;

  constructor(readonly t: number) {
    this.root = this.node([], []);
    this.emit(`An empty B-tree. Each node holds at most ${2 * t - 1} keys.`);
  }

  get size(): number {
    return this.count;
  }

  private node(keys: number[], kids: Node[]): Node {
    return { id: this.nextId++, keys, kids };
  }

  private depth(): number {
    let levels = 1;
    for (let node = this.root; node.kids.length > 0; node = node.kids[0]) levels++;
    return levels;
  }

  private emit(caption: string, hi: readonly Mark[] = [], keys: number[] = []) {
    this.frames.push({
      caption,
      root: snap(this.root),
      hi: marks(...hi.map(([node, role]) => [node?.id, role] as const)),
      keys,
      size: this.count,
      height: this.count === 0 ? 0 : this.depth(),
      splits: this.splits,
      merges: this.merges,
    });
  }

  has(key: number): boolean {
    let node = this.root;
    for (;;) {
      const i = slot(node.keys, key);
      if (node.keys[i] === key) return true;
      if (node.kids.length === 0) return false;
      node = node.kids[i];
    }
  }

  /** Walks down towards `key`, recording each node. Returns the path and whether the key was met. */
  private descend(key: number): { path: Node[]; found: boolean } {
    const path: Node[] = [];
    let node = this.root;
    for (;;) {
      path.push(node);
      const i = slot(node.keys, key);
      if (node.keys[i] === key) {
        this.emit(`${key} is in node ${list(node.keys)}.`, [[node, 'good']], [key]);
        return { path, found: true };
      }
      if (node.kids.length === 0) return { path, found: false };
      const where =
        i === 0
          ? `${key} is less than ${node.keys[0]}`
          : i === node.keys.length
            ? `${key} is greater than ${node.keys[i - 1]}`
            : `${key} lies between ${node.keys[i - 1]} and ${node.keys[i]}`;
      this.emit(
        `In node ${list(node.keys)}: ${where}, so take child ${i + 1} of ${node.kids.length}.`,
        [[node, 'compare']],
      );
      node = node.kids[i];
    }
  }

  find(key: number): boolean {
    const { path, found } = this.descend(key);
    if (!found) {
      const leaf = path[path.length - 1];
      this.emit(
        this.count === 0
          ? `The tree is empty, so ${key} is not here.`
          : `Leaf ${list(leaf.keys)} does not hold ${key}: not found.`,
        [[leaf, 'compare']],
      );
    }
    return found;
  }

  insert(key: number): boolean {
    const { path, found } = this.descend(key);
    if (found) {
      this.emit(`${key} is already in the tree; nothing to insert.`);
      return false;
    }
    let node = path.pop() as Node;
    node.keys.splice(slot(node.keys, key), 0, key);
    this.count++;
    const max = 2 * this.t - 1;
    this.emit(
      `Insert ${key} into leaf ${list(node.keys)}.` +
        (node.keys.length > max ? ` That is ${node.keys.length} keys, one more than fits.` : ''),
      [[node, 'change']],
      [key],
    );
    while (node.keys.length > max) {
      const mid = this.t;
      const median = node.keys[mid];
      this.emit(
        `Node ${list(node.keys)} is overfull. Split it around its median ${median}.`,
        [[node, 'compare']],
        [median],
      );
      const right = this.node(node.keys.splice(mid + 1), node.kids.splice(mid + 1));
      node.keys.pop();
      this.splits++;
      const parent = path.pop();
      if (parent) {
        const i = parent.kids.indexOf(node);
        parent.keys.splice(i, 0, median);
        parent.kids.splice(i + 1, 0, right);
        this.emit(
          `${median} moves up into the parent, between the two halves.` +
            (parent.keys.length > max ? ' Now the parent is overfull.' : ''),
          [
            [node, 'change'],
            [right, 'change'],
            [parent, 'good'],
          ],
          [median],
        );
        node = parent;
      } else {
        this.root = this.node([median], [node, right]);
        this.emit(
          `The root split, so ${median} becomes a new root. This is the only way the tree grows taller.`,
          [
            [node, 'change'],
            [right, 'change'],
            [this.root, 'good'],
          ],
          [median],
        );
        node = this.root;
      }
    }
    return true;
  }

  // --- Delete ---

  /** Merges child i, the separating key and child i + 1 of `parent` into one node. */
  private merge(parent: Node, i: number): Node {
    const left = parent.kids[i];
    const right = parent.kids[i + 1];
    const separator = parent.keys[i];
    this.emit(
      `${list(left.keys)} and its sibling ${list(right.keys)} are both at the minimum of ${this.t - 1}. Merge them, pulling ${separator} down between them.`,
      [
        [left, 'compare'],
        [right, 'compare'],
        [parent, 'compare'],
      ],
      [separator],
    );
    left.keys.push(separator, ...right.keys);
    left.kids.push(...right.kids);
    parent.keys.splice(i, 1);
    parent.kids.splice(i + 1, 1);
    this.merges++;
    if (parent === this.root && parent.keys.length === 0) {
      this.root = left;
      this.emit(
        `Merged into ${list(left.keys)}. The root was left empty, so the merged node becomes the root and the tree is one level shorter.`,
        [[left, 'change']],
      );
    } else {
      this.emit(`Merged into ${list(left.keys)}.`, [[left, 'change']]);
    }
    return left;
  }

  /** Makes sure child i of `node` has at least t keys before the search enters it. */
  private topUp(node: Node, i: number): Node {
    const child = node.kids[i];
    if (child.keys.length >= this.t) return child;
    const left = i > 0 ? node.kids[i - 1] : null;
    const right = i < node.keys.length ? node.kids[i + 1] : null;
    if (left && left.keys.length >= this.t) {
      const moved = left.keys[left.keys.length - 1];
      this.emit(
        `Child ${list(child.keys)} is at the minimum. Borrow through the parent: ${node.keys[i - 1]} comes down and ${moved} goes up from the left sibling.`,
        [
          [child, 'compare'],
          [left, 'compare'],
        ],
        [node.keys[i - 1], moved],
      );
      child.keys.unshift(node.keys[i - 1]);
      node.keys[i - 1] = left.keys.pop() as number;
      if (left.kids.length > 0) child.kids.unshift(left.kids.pop() as Node);
      this.emit(`Borrowed. The child is now ${list(child.keys)}.`, [[child, 'change']]);
      return child;
    }
    if (right && right.keys.length >= this.t) {
      const moved = right.keys[0];
      this.emit(
        `Child ${list(child.keys)} is at the minimum. Borrow through the parent: ${node.keys[i]} comes down and ${moved} goes up from the right sibling.`,
        [
          [child, 'compare'],
          [right, 'compare'],
        ],
        [node.keys[i], moved],
      );
      child.keys.push(node.keys[i]);
      node.keys[i] = right.keys.shift() as number;
      if (right.kids.length > 0) child.kids.push(right.kids.shift() as Node);
      this.emit(`Borrowed. The child is now ${list(child.keys)}.`, [[child, 'change']]);
      return child;
    }
    return this.merge(node, right ? i : i - 1);
  }

  private remove(node: Node, key: number) {
    const i = slot(node.keys, key);
    const here = node.keys[i] === key;
    if (node.kids.length === 0) {
      node.keys.splice(i, 1);
      this.emit(`Remove ${key} from its leaf.`, [[node, 'change']]);
      return;
    }
    if (!here) {
      this.emit(`${key} is below node ${list(node.keys)}: go to child ${i + 1}.`, [
        [node, 'compare'],
      ]);
      this.remove(this.topUp(node, i), key);
      return;
    }
    const before = node.kids[i];
    const after = node.kids[i + 1];
    if (before.keys.length >= this.t) {
      let leaf = before;
      while (leaf.kids.length > 0) leaf = leaf.kids[leaf.kids.length - 1];
      const pred = leaf.keys[leaf.keys.length - 1];
      this.emit(
        `${key} is in an internal node. Replace it with its predecessor ${pred}, then delete ${pred} from the left subtree.`,
        [
          [node, 'compare'],
          [leaf, 'compare'],
        ],
        [key, pred],
      );
      node.keys[i] = pred;
      this.remove(before, pred);
    } else if (after.keys.length >= this.t) {
      let leaf = after;
      while (leaf.kids.length > 0) leaf = leaf.kids[0];
      const succ = leaf.keys[0];
      this.emit(
        `${key} is in an internal node. Replace it with its successor ${succ}, then delete ${succ} from the right subtree.`,
        [
          [node, 'compare'],
          [leaf, 'compare'],
        ],
        [key, succ],
      );
      node.keys[i] = succ;
      this.remove(after, succ);
    } else {
      this.remove(this.merge(node, i), key);
    }
  }

  delete(key: number): boolean {
    if (!this.has(key)) {
      this.find(key);
      return false;
    }
    this.count--;
    this.remove(this.root, key);
    this.emit(`${key} is deleted.`);
    return true;
  }

  // --- Checks ---

  inorder(): number[] {
    const out: number[] = [];
    const walk = (node: Node) => {
      node.keys.forEach((key, i) => {
        if (node.kids.length > 0) walk(node.kids[i]);
        out.push(key);
      });
      if (node.kids.length > 0) walk(node.kids[node.kids.length - 1]);
    };
    walk(this.root);
    return out;
  }

  /** Returns a description of the first broken invariant, or null when the tree is sound. */
  check(): string | null {
    let problem: string | null = null;
    let leafDepth = -1;
    const walk = (node: Node, level: number) => {
      const n = node.keys.length;
      if (n > 2 * this.t - 1) problem ??= `node ${list(node.keys)} is overfull`;
      if (node !== this.root && n < this.t - 1) problem ??= `node ${list(node.keys)} is underfull`;
      if (node.kids.length === 0) {
        if (leafDepth < 0) leafDepth = level;
        if (leafDepth !== level) problem ??= 'leaves at different depths';
      } else {
        if (n === 0) problem ??= 'internal node without keys';
        if (node.kids.length !== n + 1)
          problem ??= `node ${list(node.keys)} has the wrong child count`;
        for (const kid of node.kids) walk(kid, level + 1);
      }
    };
    walk(this.root, 0);
    const keys = this.inorder();
    if (keys.some((key, i) => i > 0 && keys[i - 1] >= key)) problem ??= 'keys out of order';
    if (keys.length !== this.count) problem ??= 'size is wrong';
    return problem;
  }
}
