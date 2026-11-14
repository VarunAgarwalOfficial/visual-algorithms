/**
 * Elementary cellular automata: one row of two-state cells, where each cell's
 * next state depends on itself and its two neighbours. The eight possible
 * neighbourhoods give 2^8 = 256 rules, numbered as Wolfram did.
 */

/** Index of a neighbourhood in the rule table: left is the high bit. */
export function neighbourhood(left: number, centre: number, right: number): number {
  return (left << 2) | (centre << 1) | right;
}

/** The eight outputs of a rule; entry i is bit i of the rule number. */
export function ruleTable(rule: number): Uint8Array {
  const table = new Uint8Array(8);
  for (let i = 0; i < 8; i++) table[i] = (rule >> i) & 1;
  return table;
}

/** Flips the output for one neighbourhood and returns the new rule number. */
export function toggleRuleBit(rule: number, index: number): number {
  return (rule ^ (1 << index)) & 255;
}

/** Writes the successor of `row` into `next`. Without `wrap`, cells past the ends count as 0. */
export function stepRow(row: Uint8Array, next: Uint8Array, rule: number, wrap: boolean): void {
  const n = row.length;
  for (let i = 0; i < n; i++) {
    const left = i > 0 ? row[i - 1] : wrap ? row[n - 1] : 0;
    const right = i < n - 1 ? row[i + 1] : wrap ? row[0] : 0;
    next[i] = (rule >> neighbourhood(left, row[i], right)) & 1;
  }
}

/** Runs the automaton and returns all rows, row-major: `rows` rows of `first.length` cells. */
export function runElementary(
  first: Uint8Array,
  rule: number,
  rows: number,
  wrap: boolean,
): Uint8Array {
  const width = first.length;
  const grid = new Uint8Array(width * rows);
  grid.set(first.subarray(0, width));
  for (let r = 1; r < rows; r++) {
    stepRow(
      grid.subarray((r - 1) * width, r * width),
      grid.subarray(r * width, (r + 1) * width),
      rule,
      wrap,
    );
  }
  return grid;
}
