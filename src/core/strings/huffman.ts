export interface HuffNode {
  /** Leaves are numbered first, in symbol order; each merge takes the next id. */
  id: number;
  weight: number;
  symbol?: string;
  left?: HuffNode;
  right?: HuffNode;
}

export interface HuffMerge {
  /** The two lightest subtrees: `a` is the lighter and becomes the 0 branch. */
  a: number;
  b: number;
  parent: number;
}

export interface Huffman {
  /** All nodes by id. */
  nodes: HuffNode[];
  /** Symbols in code-point order with their counts. */
  symbols: { symbol: string; count: number }[];
  merges: HuffMerge[];
  /** queues[k] is the forest (root ids, lightest first) after k merges. */
  queues: number[][];
  root: HuffNode | undefined;
  codes: Map<string, string>;
  /** Number of symbols in the text. */
  total: number;
  encodedBits: number;
  /** Bits per symbol for a fixed-length code: ceil(log2(distinct)), at least 1. */
  fixedWidth: number;
  /** Shannon entropy in bits per symbol. */
  entropy: number;
}

/**
 * Builds a Huffman tree. Ties are broken the same way every time: by weight,
 * then by id, so leaves come before merged trees and older trees before newer.
 */
export function huffman(text: string): Huffman {
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const symbols = [...counts.entries()]
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([symbol, count]) => ({ symbol, count }));
  const nodes: HuffNode[] = symbols.map((s, id) => ({ id, weight: s.count, symbol: s.symbol }));
  const order = (x: HuffNode, y: HuffNode) => x.weight - y.weight || x.id - y.id;

  let queue = [...nodes].sort(order);
  const queues = [queue.map((n) => n.id)];
  const merges: HuffMerge[] = [];
  while (queue.length > 1) {
    const [a, b, ...rest] = queue;
    const parent: HuffNode = { id: nodes.length, weight: a.weight + b.weight, left: a, right: b };
    nodes.push(parent);
    merges.push({ a: a.id, b: b.id, parent: parent.id });
    queue = [...rest, parent].sort(order);
    queues.push(queue.map((n) => n.id));
  }

  const root = queue[0];
  const codes = new Map<string, string>();
  const walk = (node: HuffNode, code: string) => {
    if (node.symbol !== undefined) codes.set(node.symbol, code || '0');
    if (node.left) walk(node.left, `${code}0`);
    if (node.right) walk(node.right, `${code}1`);
  };
  if (root) walk(root, '');

  const total = symbols.reduce((sum, s) => sum + s.count, 0);
  let encodedBits = 0;
  let entropy = 0;
  for (const { symbol, count } of symbols) {
    encodedBits += count * (codes.get(symbol)?.length ?? 0);
    entropy -= (count / total) * Math.log2(count / total);
  }
  return {
    nodes,
    symbols,
    merges,
    queues,
    root,
    codes,
    total,
    encodedBits,
    fixedWidth: Math.max(1, Math.ceil(Math.log2(Math.max(1, symbols.length)))),
    entropy: Math.abs(entropy),
  };
}

export function encode(text: string, codes: ReadonlyMap<string, string>): string {
  let bits = '';
  for (const ch of text) bits += codes.get(ch) ?? '';
  return bits;
}

/** Decodes by walking the tree; a one-symbol tree spends one bit per symbol. */
export function decode(bits: string, root: HuffNode | undefined): string {
  if (!root) return '';
  if (root.symbol !== undefined) return root.symbol.repeat(bits.length);
  let out = '';
  let node = root;
  for (const bit of bits) {
    const next = bit === '0' ? node.left : node.right;
    if (!next) break;
    node = next;
    if (node.symbol !== undefined) {
      out += node.symbol;
      node = root;
    }
  }
  return out;
}
