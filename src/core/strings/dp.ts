/** A table position: row i, column j. */
export type Cell = readonly [number, number];

// --- Edit distance ---

export type EditKind = 'match' | 'substitute' | 'insert' | 'delete';

export interface EditOp {
  kind: EditKind;
  /** Character of the source word, or '' for an insertion. */
  from: string;
  /** Character of the target word, or '' for a deletion. */
  to: string;
}

export interface EditResult {
  /** table[i][j] is the cost of turning the first i characters of a into the first j of b. */
  table: number[][];
  distance: number;
  /** Cells visited walking back from the bottom right corner to the top left. */
  path: Cell[];
  /** Operations in reading order (left to right). */
  ops: EditOp[];
}

export const editCost = (op: EditOp, substitution: number): number =>
  op.kind === 'match' ? 0 : op.kind === 'substitute' ? substitution : 1;

/** Levenshtein distance with unit insert and delete and a chosen substitution cost. */
export function editDistance(a: string, b: string, substitution = 1): EditResult {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diagonal = table[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : substitution);
      table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, diagonal);
    }
  }

  const path: Cell[] = [];
  const ops: EditOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    path.push([i, j]);
    const same = i > 0 && j > 0 && a[i - 1] === b[j - 1];
    if (i > 0 && j > 0 && table[i][j] === table[i - 1][j - 1] + (same ? 0 : substitution)) {
      ops.push({ kind: same ? 'match' : 'substitute', from: a[i - 1], to: b[j - 1] });
      i--;
      j--;
    } else if (i > 0 && table[i][j] === table[i - 1][j] + 1) {
      ops.push({ kind: 'delete', from: a[i - 1], to: '' });
      i--;
    } else {
      ops.push({ kind: 'insert', from: '', to: b[j - 1] });
      j--;
    }
  }
  path.push([0, 0]);
  ops.reverse();
  return { table, distance: table[n][m], path, ops };
}

// --- Longest common subsequence ---

export interface LcsResult {
  /** table[i][j] is the LCS length of the first i characters of a and the first j of b. */
  table: number[][];
  length: number;
  path: Cell[];
  /** Matched index pairs [index in a, index in b], left to right. */
  pairs: Cell[];
  subsequence: string;
}

export function lcs(a: string, b: string): LcsResult {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      table[i][j] =
        a[i - 1] === b[j - 1]
          ? table[i - 1][j - 1] + 1
          : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  const path: Cell[] = [];
  const pairs: Cell[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    path.push([i, j]);
    if (a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (table[i - 1][j] >= table[i][j - 1]) i--;
    else j--;
  }
  path.push([i, j]);
  pairs.reverse();
  return {
    table,
    length: table[n][m],
    path,
    pairs,
    subsequence: pairs.map(([p]) => a[p]).join(''),
  };
}

// --- Knapsack ---

export interface Item {
  weight: number;
  value: number;
}

export interface KnapsackResult {
  /** table[i][w] is the best value using the first i items within capacity w. */
  table: number[][];
  /** take[i][w] is true when the best choice for the cell uses item i. */
  take: boolean[][];
  best: number;
  path: Cell[];
  /** Indices of the chosen items (repeats allowed when unbounded), in table order. */
  chosen: number[];
}

/** 0/1 knapsack, or unbounded (any number of copies of each item). Weights must be at least 1. */
export function knapsack(
  items: readonly Item[],
  capacity: number,
  unbounded = false,
): KnapsackResult {
  const n = items.length;
  const table = Array.from({ length: n + 1 }, () => new Array<number>(capacity + 1).fill(0));
  const take = Array.from({ length: n + 1 }, () => new Array<boolean>(capacity + 1).fill(false));
  for (let i = 1; i <= n; i++) {
    const { weight, value } = items[i - 1];
    for (let w = 0; w <= capacity; w++) {
      const skip = table[i - 1][w];
      table[i][w] = skip;
      if (weight <= w) {
        const taken = table[unbounded ? i : i - 1][w - weight] + value;
        if (taken > skip) {
          table[i][w] = taken;
          take[i][w] = true;
        }
      }
    }
  }
  const path: Cell[] = [];
  const chosen: number[] = [];
  let i = n;
  let w = capacity;
  while (i > 0) {
    path.push([i, w]);
    if (take[i][w]) {
      chosen.push(i - 1);
      w -= items[i - 1].weight;
      if (!unbounded) i--;
    } else i--;
  }
  path.push([0, w]);
  chosen.reverse();
  return { table, take, best: table[n][capacity], path, chosen };
}
