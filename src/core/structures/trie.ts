import { type Marks, type Role, type StepFrame } from './trace';

interface Node {
  id: number;
  ch: string;
  kids: Map<string, Node>;
  end: boolean;
}

export interface TrieSnap {
  id: number;
  /** One letter, or several in the compressed view. Empty for the root. */
  label: string;
  end: boolean;
  kids: TrieSnap[];
}

export interface TrieFrame extends StepFrame {
  root: TrieSnap;
  /** Highlights by node id. */
  hi: Marks;
  nodes: number;
  words: number;
  /** Results of the last prefix search, or null when the operation was not a search. */
  completions: string[] | null;
}

type Mark = readonly [Node, Role];

const snap = (node: Node): TrieSnap => ({
  id: node.id,
  label: node.ch,
  end: node.end,
  kids: [...node.kids.values()].sort((a, b) => (a.ch < b.ch ? -1 : 1)).map(snap),
});

/** A trie over words: one node per letter, with a flag on nodes where a word ends. */
export class Trie {
  readonly frames: TrieFrame[] = [];
  private root: Node = { id: 0, ch: '', kids: new Map(), end: false };
  private nodeCount = 1;
  private wordCount = 0;
  private nextId = 1;

  constructor() {
    this.emit('An empty trie: only the root.');
  }

  get words(): number {
    return this.wordCount;
  }
  get nodes(): number {
    return this.nodeCount;
  }

  private emit(caption: string, hi: readonly Mark[] = [], completions: string[] | null = null) {
    this.frames.push({
      caption,
      root: snap(this.root),
      hi: new Map(hi.map(([node, role]) => [node.id, role])),
      nodes: this.nodeCount,
      words: this.wordCount,
      completions,
    });
  }

  /** Follows `text` from the root, recording each letter. Returns the nodes reached, root first. */
  private walk(text: string): { path: Node[]; complete: boolean } {
    const path = [this.root];
    for (let i = 0; i < text.length; i++) {
      const next = path[i].kids.get(text[i]);
      const trail = path.map((node) => [node, 'visit'] as const);
      if (!next) {
        this.emit(`No "${text[i]}" branch after "${text.slice(0, i)}".`, [
          ...trail,
          [path[i], 'compare'],
        ]);
        return { path, complete: false };
      }
      path.push(next);
      this.emit(`Follow "${text[i]}": the path now spells "${text.slice(0, i + 1)}".`, [
        ...trail,
        [next, 'compare'],
      ]);
    }
    return { path, complete: true };
  }

  has(word: string): boolean {
    let node: Node | undefined = this.root;
    for (const ch of word) node = node?.kids.get(ch);
    return node?.end === true;
  }

  /** Every stored word, in alphabetical order, without recording anything. */
  list(): string[] {
    const out: string[] = [];
    const visit = (node: Node, text: string) => {
      if (node.end) out.push(text);
      for (const ch of [...node.kids.keys()].sort()) visit(node.kids.get(ch) as Node, text + ch);
    };
    visit(this.root, '');
    return out;
  }

  insert(word: string): boolean {
    const { path } = this.walk(word);
    for (let i = path.length - 1; i < word.length; i++) {
      const node: Node = { id: this.nextId++, ch: word[i], kids: new Map(), end: false };
      path[i].kids.set(word[i], node);
      path.push(node);
      this.nodeCount++;
      this.emit(`Add a new node for "${word[i]}".`, [
        ...path.slice(0, -1).map((n) => [n, 'visit'] as const),
        [node, 'change'],
      ]);
    }
    const last = path[path.length - 1];
    const trail = path.map((n) => [n, 'good'] as const);
    if (last.end) {
      this.emit(`"${word}" is already in the trie.`, trail);
      return false;
    }
    last.end = true;
    this.wordCount++;
    this.emit(`Mark the last node as the end of "${word}".`, trail);
    return true;
  }

  /** All stored words that start with `prefix`, in alphabetical order. */
  complete(prefix: string): string[] {
    const { path, complete } = this.walk(prefix);
    const found: string[] = [];
    if (!complete) {
      this.emit(`No stored word starts with "${prefix}".`, [], found);
      return found;
    }
    const trail = path.map((n) => [n, 'visit'] as const);
    const branch: Node[] = [];
    const visit = (node: Node, text: string) => {
      if (node.end) {
        found.push(text);
        this.emit(
          `"${text}" ends here: a completion.`,
          [...trail, ...branch.map((n) => [n, 'good'] as const), [node, 'good']],
          [...found],
        );
      }
      for (const kid of [...node.kids.values()].sort((a, b) => (a.ch < b.ch ? -1 : 1))) {
        branch.push(kid);
        visit(kid, text + kid.ch);
        branch.pop();
      }
    };
    visit(path[path.length - 1], prefix);
    const n = found.length;
    this.emit(
      n === 0
        ? `No stored word starts with "${prefix}".`
        : `${n} word${n === 1 ? '' : 's'} start${n === 1 ? 's' : ''} with "${prefix}": ${found.join(', ')}.`,
      trail,
      found,
    );
    return found;
  }

  delete(word: string): boolean {
    const { path, complete } = this.walk(word);
    const last = path[path.length - 1];
    if (!complete || !last.end) {
      this.emit(`"${word}" is not in the trie; nothing to delete.`);
      return false;
    }
    last.end = false;
    this.wordCount--;
    this.emit(`Clear the end-of-word mark for "${word}".`, [[last, 'change']]);
    let pruned = 0;
    for (let i = path.length - 1; i > 0; i--) {
      const node = path[i];
      if (node.end || node.kids.size > 0) break;
      path[i - 1].kids.delete(node.ch);
      this.nodeCount--;
      pruned++;
      this.emit(`Node "${node.ch}" has no children and ends no word: remove it.`, [
        [path[i - 1], 'compare'],
      ]);
    }
    this.emit(
      pruned === 0
        ? `"${word}" is deleted. Its nodes stay because other words use them.`
        : `"${word}" is deleted and ${pruned} unused node${pruned === 1 ? '' : 's'} removed.`,
    );
    return true;
  }
}

/**
 * The compressed (radix) view of a trie snapshot: a node with a single child
 * that ends no word is joined with that child. Highlights follow the joined nodes.
 */
export function compress(root: TrieSnap, hi: Marks): { root: TrieSnap; hi: Marks } {
  const out: Marks = new Map();
  const squash = (node: TrieSnap): TrieSnap => {
    let label = node.label;
    let role = hi.get(node.id);
    let tail = node;
    while (tail.kids.length === 1 && !tail.end) {
      tail = tail.kids[0];
      label += tail.label;
      role = hi.get(tail.id) ?? role;
    }
    if (role) out.set(tail.id, role);
    return { id: tail.id, label, end: tail.end, kids: tail.kids.map(squash) };
  };
  const top: TrieSnap = { id: root.id, label: '', end: root.end, kids: root.kids.map(squash) };
  const rootRole = hi.get(root.id);
  if (rootRole) out.set(root.id, rootRole);
  return { root: top, hi: out };
}
