import { marks, type Marks, type Role, type StepFrame } from './trace';

export type TreeVariant = 'bst' | 'avl' | 'rb';

interface Node {
  id: number;
  key: number;
  left: Node | null;
  right: Node | null;
  parent: Node | null;
  red: boolean;
}

export interface TreeSnap {
  id: number;
  key: number;
  red: boolean;
  /** Height of the left subtree minus height of the right subtree. */
  balance: number;
  left: TreeSnap | null;
  right: TreeSnap | null;
}

export interface TreeFrame extends StepFrame {
  root: TreeSnap | null;
  /** Highlights by node id. */
  hi: Marks;
  size: number;
  height: number;
  /** Rotations since the tree was created. */
  rotations: number;
  /** Key comparisons in the current operation. */
  comparisons: number;
  /** The balancing case being applied, when there is one. */
  rule: string;
}

type Mark = readonly [Node | null, Role];

const height = (node: Node | null): number =>
  node ? 1 + Math.max(height(node.left), height(node.right)) : 0;
const balance = (node: Node) => height(node.left) - height(node.right);
const isRed = (node: Node | null) => node !== null && node.red;

function snap(node: Node | null): TreeSnap | null {
  if (!node) return null;
  return {
    id: node.id,
    key: node.key,
    red: node.red,
    balance: balance(node),
    left: snap(node.left),
    right: snap(node.right),
  };
}

/**
 * A binary search tree that is plain, AVL or red-black. Operations append
 * frames. The red-black code follows the usual textbook cases (CLRS), with
 * null children counted as black leaves.
 */
export class SearchTree {
  readonly frames: TreeFrame[] = [];
  rotations = 0;
  private root: Node | null = null;
  private count = 0;
  private comparisons = 0;
  private nextId = 1;

  constructor(readonly variant: TreeVariant) {
    this.emit('An empty tree.');
  }

  get size(): number {
    return this.count;
  }
  get height(): number {
    return height(this.root);
  }

  private emit(caption: string, hi: readonly Mark[] = [], rule = '') {
    this.frames.push({
      caption,
      root: snap(this.root),
      hi: marks(...hi.map(([node, role]) => [node?.id, role] as const)),
      size: this.count,
      height: height(this.root),
      rotations: this.rotations,
      comparisons: this.comparisons,
      rule,
    });
  }

  // --- Search ---

  /** Walks down from the root. Returns the node holding `key`, or the last node visited. */
  private descend(key: number): { found: Node | null; last: Node | null } {
    let node = this.root;
    let last: Node | null = null;
    while (node) {
      this.comparisons++;
      last = node;
      if (key === node.key) {
        this.emit(`${key} equals ${node.key}: found.`, [[node, 'good']]);
        return { found: node, last };
      }
      const left = key < node.key;
      const next: Node | null = left ? node.left : node.right;
      this.emit(
        `${key} is ${left ? 'less' : 'greater'} than ${node.key}: go ${left ? 'left' : 'right'}` +
          (next ? '.' : `, where there is an empty place.`),
        [[node, 'compare']],
      );
      node = next;
    }
    return { found: null, last };
  }

  find(key: number): boolean {
    this.comparisons = 0;
    if (!this.root) {
      this.emit(`The tree is empty, so ${key} is not here.`);
      return false;
    }
    const { found } = this.descend(key);
    if (!found) this.emit(`${key} is not in the tree.`);
    return found !== null;
  }

  has(key: number): boolean {
    let node = this.root;
    while (node && node.key !== key) node = key < node.key ? node.left : node.right;
    return node !== null;
  }

  // --- Rotations ---

  private replaceChild(parent: Node | null, old: Node, next: Node | null) {
    if (!parent) this.root = next;
    else if (parent.left === old) parent.left = next;
    else parent.right = next;
    if (next) next.parent = parent;
  }

  /** Left rotation: the right child of x rises above x. */
  private rotateLeft(x: Node): Node {
    const y = x.right as Node;
    x.right = y.left;
    if (y.left) y.left.parent = x;
    this.replaceChild(x.parent, x, y);
    y.left = x;
    x.parent = y;
    this.rotations++;
    return y;
  }

  private rotateRight(x: Node): Node {
    const y = x.left as Node;
    x.left = y.right;
    if (y.right) y.right.parent = x;
    this.replaceChild(x.parent, x, y);
    y.right = x;
    x.parent = y;
    this.rotations++;
    return y;
  }

  private rotate(x: Node, left: boolean, rule: string, why: string): Node {
    const side = left ? 'left' : 'right';
    const riser = (left ? x.right : x.left) as Node;
    this.emit(
      `${why} Rotate ${side} at ${x.key}: ${riser.key} will rise above it.`,
      [
        [x, 'compare'],
        [riser, 'compare'],
      ],
      rule,
    );
    const top = left ? this.rotateLeft(x) : this.rotateRight(x);
    this.emit(
      `Rotated ${side}: ${top.key} is now the parent of ${x.key}.`,
      [
        [x, 'change'],
        [top, 'change'],
      ],
      rule,
    );
    return top;
  }

  // --- Insert ---

  insert(key: number): boolean {
    this.comparisons = 0;
    const { found, last } = this.descend(key);
    if (found) {
      this.emit(`${key} is already in the tree; nothing to insert.`, [[found, 'good']]);
      return false;
    }
    const node: Node = {
      id: this.nextId++,
      key,
      left: null,
      right: null,
      parent: last,
      red: this.variant === 'rb',
    };
    if (!last) this.root = node;
    else if (key < last.key) last.left = node;
    else last.right = node;
    this.count++;
    this.emit(
      last
        ? `Attach ${key} as the ${key < last.key ? 'left' : 'right'} child of ${last.key}` +
            (this.variant === 'rb' ? ', coloured red.' : '.')
        : `${key} becomes the root.`,
      [[node, 'change']],
    );
    if (this.variant === 'avl') this.retrace(last);
    if (this.variant === 'rb') this.fixInsert(node);
    return true;
  }

  // --- AVL ---

  /** Walks from `start` to the root, rotating wherever the balance factor reaches ±2. */
  private retrace(start: Node | null) {
    let node = start;
    let rotated = false;
    while (node) {
      const b = balance(node);
      if (b > 1) {
        const child = node.left as Node;
        const why = `${node.key} has balance factor +${b}: its left side is too tall.`;
        if (balance(child) < 0) {
          this.rotate(child, true, 'Left-right case', `${why} The extra height is on the inside.`);
          node = this.rotate(node, false, 'Left-right case', 'Now it is a left-left shape.');
        } else {
          node = this.rotate(node, false, 'Left-left case', why);
        }
        rotated = true;
      } else if (b < -1) {
        const child = node.right as Node;
        const why = `${node.key} has balance factor ${b}: its right side is too tall.`;
        if (balance(child) > 0) {
          this.rotate(child, false, 'Right-left case', `${why} The extra height is on the inside.`);
          node = this.rotate(node, true, 'Right-left case', 'Now it is a right-right shape.');
        } else {
          node = this.rotate(node, true, 'Right-right case', why);
        }
        rotated = true;
      }
      node = node.parent;
    }
    this.emit(
      rotated
        ? 'Every balance factor is back within −1 to +1.'
        : 'Every balance factor on the way up is within −1 to +1: no rotation needed.',
    );
  }

  // --- Red-black ---

  private fixInsert(start: Node) {
    let z = start;
    while (z.parent && z.parent.red) {
      const parent = z.parent;
      const grand = parent.parent as Node; // a red node is never the root
      const parentIsLeft = grand.left === parent;
      const uncle = parentIsLeft ? grand.right : grand.left;
      if (uncle && uncle.red) {
        const rule = 'Case 1: red uncle';
        this.emit(
          `${z.key} and its parent ${parent.key} are both red, and the uncle ${uncle.key} is red too. Recolour: parent and uncle black, grandparent ${grand.key} red.`,
          [
            [z, 'compare'],
            [parent, 'compare'],
            [uncle, 'compare'],
          ],
          rule,
        );
        parent.red = false;
        uncle.red = false;
        grand.red = true;
        this.emit(
          `Recoloured. Now check ${grand.key}, which has turned red.`,
          [[grand, 'change']],
          rule,
        );
        z = grand;
        continue;
      }
      const inner = parentIsLeft ? parent.right === z : parent.left === z;
      let top = parent;
      if (inner) {
        const rule = 'Case 2: black uncle, inner child';
        this.rotate(
          parent,
          parentIsLeft,
          rule,
          `${z.key} and its parent ${parent.key} are both red, the uncle is black, and ${z.key} is an inner child.`,
        );
        top = z;
        z = parent;
      }
      const rule = 'Case 3: black uncle, outer child';
      this.emit(
        `${z.key} and its parent ${top.key} are both red, the uncle is black, and ${z.key} is an outer child. Colour ${top.key} black and ${grand.key} red.`,
        [
          [z, 'compare'],
          [top, 'compare'],
          [grand, 'compare'],
        ],
        rule,
      );
      top.red = false;
      grand.red = true;
      this.rotate(grand, !parentIsLeft, rule, 'Recoloured.');
      break;
    }
    if (this.root && this.root.red) {
      this.root.red = false;
      this.emit('The root must be black: recolour it.', [[this.root, 'change']], 'Root is black');
    } else {
      this.emit('No red node has a red child, and every path has the same number of black nodes.');
    }
  }

  private fixDelete(start: Node | null, startParent: Node | null) {
    let x = start;
    let parent = startParent;
    const name = (node: Node | null) => (node ? String(node.key) : 'the empty place');
    while (x !== this.root && !isRed(x) && parent) {
      const left = parent.left === x;
      const near = (w: Node) => (left ? w.left : w.right);
      const far = (w: Node) => (left ? w.right : w.left);
      let w = (left ? parent.right : parent.left) as Node; // a short side always has a sibling
      if (w.red) {
        const rule = 'Case 1: red sibling';
        this.emit(
          `The path through ${name(x)} is one black node short. Its sibling ${w.key} is red: colour it black and ${parent.key} red.`,
          [
            [x, 'compare'],
            [w, 'compare'],
            [parent, 'compare'],
          ],
          rule,
        );
        w.red = false;
        parent.red = true;
        this.rotate(parent, left, rule, 'Recoloured.');
        w = (left ? parent.right : parent.left) as Node;
      }
      if (!isRed(w.left) && !isRed(w.right)) {
        const rule = 'Case 2: black sibling with black children';
        this.emit(
          `The path through ${name(x)} is one black node short. Its sibling ${w.key} is black with no red child: colour ${w.key} red, which shortens the other side to match.`,
          [
            [x, 'compare'],
            [w, 'compare'],
          ],
          rule,
        );
        w.red = true;
        x = parent;
        parent = x.parent;
        this.emit(
          isRed(x)
            ? `The shortage moves up to ${x.key}, which is red.`
            : x === this.root
              ? `The shortage moves up to the root ${x.key}, where it disappears: every path lost one black node.`
              : `The shortage moves up to ${x.key}.`,
          [
            [w, 'change'],
            [x, 'compare'],
          ],
          rule,
        );
        continue;
      }
      if (!isRed(far(w))) {
        const rule = 'Case 3: black sibling, near child red';
        const child = near(w) as Node;
        this.emit(
          `The sibling ${w.key} is black and only its near child ${child.key} is red. Colour ${child.key} black and ${w.key} red.`,
          [
            [x, 'compare'],
            [w, 'compare'],
            [child, 'compare'],
          ],
          rule,
        );
        child.red = false;
        w.red = true;
        this.rotate(w, !left, rule, 'Recoloured.');
        w = (left ? parent.right : parent.left) as Node;
      }
      const rule = 'Case 4: black sibling, far child red';
      const child = far(w) as Node;
      this.emit(
        `The sibling ${w.key} is black and its far child ${child.key} is red. Give ${w.key} the colour of ${parent.key}, colour ${parent.key} and ${child.key} black.`,
        [
          [x, 'compare'],
          [w, 'compare'],
          [child, 'compare'],
        ],
        rule,
      );
      w.red = parent.red;
      parent.red = false;
      child.red = false;
      this.rotate(parent, left, rule, 'Recoloured.');
      x = this.root;
      break;
    }
    if (x && x.red) {
      x.red = false;
      this.emit(
        `Colour ${x.key} black. That restores the missing black node.`,
        [[x, 'change']],
        'Red node absorbs the shortage',
      );
    }
    this.emit('Every path has the same number of black nodes again.');
  }

  // --- Delete ---

  delete(key: number): boolean {
    this.comparisons = 0;
    const { found: z } = this.descend(key);
    if (!z) {
      this.emit(`${key} is not in the tree; nothing to delete.`);
      return false;
    }
    let removedRed = z.red;
    let x: Node | null;
    let xParent: Node | null;
    if (!z.left || !z.right) {
      x = z.left ?? z.right;
      xParent = z.parent;
      this.replaceChild(z.parent, z, x);
      this.count--;
      this.emit(
        x
          ? `${key} has one child, ${x.key}, which takes its place.`
          : `${key} is a leaf: remove it.`,
        [[x, 'change']],
      );
    } else {
      let y = z.right;
      while (y.left) y = y.left;
      this.emit(
        `${key} has two children. Its successor ${y.key}, the smallest key in the right subtree, will take its place.`,
        [
          [z, 'compare'],
          [y, 'compare'],
        ],
      );
      removedRed = y.red;
      x = y.right;
      if (y.parent === z) {
        xParent = y;
      } else {
        xParent = y.parent;
        this.replaceChild(y.parent, y, y.right);
        y.right = z.right;
        y.right.parent = y;
      }
      this.replaceChild(z.parent, z, y);
      y.left = z.left;
      y.left.parent = y;
      y.red = z.red;
      this.count--;
      this.emit(`${y.key} moved into the place of ${key}.`, [[y, 'change']]);
    }
    if (this.variant === 'avl') this.retrace(xParent);
    if (this.variant === 'rb') {
      if (removedRed) this.emit('The node taken out was red, so no black node went missing.');
      else this.fixDelete(x, xParent);
    }
    return true;
  }

  // --- Checks ---

  inorder(): number[] {
    const out: number[] = [];
    const walk = (node: Node | null) => {
      if (!node) return;
      walk(node.left);
      out.push(node.key);
      walk(node.right);
    };
    walk(this.root);
    return out;
  }

  /** Returns a description of the first broken invariant, or null when the tree is sound. */
  check(): string | null {
    let problem: string | null = null;
    const fail = (text: string) => {
      problem ??= text;
      return 0;
    };
    // Returns the black height of the subtree.
    const walk = (node: Node | null, lo: number, hi: number, parent: Node | null): number => {
      if (!node) return 1;
      if (node.parent !== parent) fail(`bad parent pointer at ${node.key}`);
      if (node.key <= lo || node.key >= hi) fail(`order broken at ${node.key}`);
      if (this.variant === 'avl' && Math.abs(balance(node)) > 1) fail(`unbalanced at ${node.key}`);
      if (this.variant === 'rb' && node.red && (isRed(node.left) || isRed(node.right))) {
        fail(`red node ${node.key} has a red child`);
      }
      const l = walk(node.left, lo, node.key, node);
      const r = walk(node.right, node.key, hi, node);
      if (this.variant === 'rb' && l !== r) fail(`black heights differ at ${node.key}`);
      return l + (node.red ? 0 : 1);
    };
    walk(this.root, -Infinity, Infinity, null);
    if (this.variant === 'rb' && isRed(this.root)) fail('red root');
    return problem;
  }
}
