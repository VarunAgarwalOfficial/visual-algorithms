export type Matcher = 'naive' | 'kmp' | 'z';

/**
 * One frame of a matcher's trace. The picture is always two rows: a top string
 * (the pattern while a table is being built, the text while searching) and the
 * pattern beneath it, moved right by `shift` cells.
 */
export interface MatchStep {
  phase: 'build' | 'search';
  kind: 'compare' | 'set' | 'shift' | 'found';
  shift: number;
  /** Cells of the bottom row, from its start, known to equal the cells above. */
  matched: number;
  /** Top-row index being compared, with the outcome. */
  at?: number;
  equal?: boolean;
  /** Entries of the pattern's own table (failure or Z) known after this step. */
  known: number;
  /** Z search only: entries of the text's Z array known after this step. */
  knownText?: number;
  /** Table index in use: written in the top row on 'set' and 'found', read under the pattern on 'shift'. */
  cell?: number;
  /** Z-box [l, r) in top-row coordinates. */
  box?: readonly [number, number];
  text: string;
}

export interface MatchTrace {
  steps: MatchStep[];
  /** Start indices of every occurrence, overlapping ones included. */
  matches: number[];
  /** Failure table (KMP) or Z array (Z) of the pattern; empty for the naive matcher. */
  table: number[];
  /** Z search only: Z value at each text position against the pattern. */
  textTable: number[];
}

/** Failure (prefix) function: table[i] is the longest proper border of pattern[0..i]. */
export function failureTable(pattern: string): number[] {
  const table = new Array<number>(pattern.length).fill(0);
  for (let i = 1, k = 0; i < pattern.length; i++) {
    while (k > 0 && pattern[i] !== pattern[k]) k = table[k - 1];
    if (pattern[i] === pattern[k]) k++;
    table[i] = k;
  }
  return table;
}

/** Z array: z[i] is the length of the longest common prefix of s and s[i..]. z[0] is the length. */
export function zArray(s: string): number[] {
  const n = s.length;
  const z = new Array<number>(n).fill(0);
  if (n > 0) z[0] = n;
  for (let i = 1, l = 0, r = 0; i < n; i++) {
    if (i < r) z[i] = Math.min(r - i, z[i - l]);
    while (i + z[i] < n && s[z[i]] === s[i + z[i]]) z[i]++;
    if (i + z[i] > r) {
      l = i;
      r = i + z[i];
    }
  }
  return z;
}

/** Comparisons the naive matcher makes: each alignment stops at its first mismatch. */
export function naiveComparisons(text: string, pattern: string): number {
  let count = 0;
  for (let s = 0; s + pattern.length <= text.length; s++) {
    for (let j = 0; j < pattern.length; j++) {
      count++;
      if (text[s + j] !== pattern[j]) break;
    }
  }
  return count;
}

const q = (c: string) => `'${c}'`;

function naive(text: string, p: string): MatchTrace {
  const steps: MatchStep[] = [];
  const matches: number[] = [];
  const m = p.length;
  for (let s = 0; m > 0 && s + m <= text.length; s++) {
    let j = 0;
    for (; j < m; j++) {
      const equal = text[s + j] === p[j];
      steps.push({
        phase: 'search',
        kind: 'compare',
        shift: s,
        matched: j + (equal ? 1 : 0),
        at: s + j,
        equal,
        known: 0,
        text: equal
          ? `Text ${q(text[s + j])} at ${s + j} equals pattern[${j}].`
          : `Text ${q(text[s + j])} at ${s + j} differs from pattern[${j}] ${q(p[j])}. Move the pattern one place and start again from its first letter.`,
      });
      if (!equal) break;
    }
    if (j === m) {
      matches.push(s);
      steps.push({
        phase: 'search',
        kind: 'found',
        shift: s,
        matched: m,
        known: 0,
        text: `Match at position ${s}.`,
      });
    }
  }
  return { steps, matches, table: [], textTable: [] };
}

function kmp(text: string, p: string): MatchTrace {
  const steps: MatchStep[] = [];
  const matches: number[] = [];
  const m = p.length;
  const table = failureTable(p);
  if (m === 0) return { steps, matches, table, textTable: [] };

  // Build: the pattern is matched against itself. k is the current border length.
  steps.push({
    phase: 'build',
    kind: 'set',
    shift: 1,
    matched: 0,
    known: 1,
    cell: 0,
    text: 'fail[0] = 0: one letter has no proper border.',
  });
  for (let i = 1, k = 0; i < m; i++) {
    for (;;) {
      const equal = p[i] === p[k];
      steps.push({
        phase: 'build',
        kind: 'compare',
        shift: i - k,
        matched: k + (equal ? 1 : 0),
        at: i,
        equal,
        known: i,
        text: equal
          ? `pattern[${i}] ${q(p[i])} equals pattern[${k}]: the border grows to ${k + 1}.`
          : `pattern[${i}] ${q(p[i])} differs from pattern[${k}] ${q(p[k])}.`,
      });
      if (equal) {
        k++;
        break;
      }
      if (k === 0) break;
      const next = table[k - 1];
      steps.push({
        phase: 'build',
        kind: 'shift',
        shift: i - next,
        matched: next,
        known: i,
        cell: k - 1,
        text: `Fall back to the next shorter border: fail[${k - 1}] = ${next}.`,
      });
      k = next;
    }
    steps.push({
      phase: 'build',
      kind: 'set',
      shift: i - k + 1,
      matched: k,
      known: i + 1,
      cell: i,
      text: `fail[${i}] = ${k}: ${
        k > 0
          ? `"${p.slice(0, k)}" is both a prefix and a suffix of "${p.slice(0, i + 1)}"`
          : `"${p.slice(0, i + 1)}" has no border`
      }.`,
    });
  }

  // Search: i never moves backwards.
  for (let i = 0, j = 0; i < text.length;) {
    const equal = text[i] === p[j];
    steps.push({
      phase: 'search',
      kind: 'compare',
      shift: i - j,
      matched: j + (equal ? 1 : 0),
      at: i,
      equal,
      known: m,
      text: equal
        ? `Text ${q(text[i])} at ${i} equals pattern[${j}].`
        : `Text ${q(text[i])} at ${i} differs from pattern[${j}] ${q(p[j])}.${j === 0 ? ' Nothing matched, so move on one place.' : ''}`,
    });
    if (equal) {
      i++;
      j++;
      if (j === m) {
        matches.push(i - m);
        steps.push({
          phase: 'search',
          kind: 'found',
          shift: i - m,
          matched: m,
          known: m,
          text: `Match at position ${i - m}.`,
        });
        const next = table[m - 1];
        if (i < text.length) {
          steps.push({
            phase: 'search',
            kind: 'shift',
            shift: i - next,
            matched: next,
            known: m,
            cell: m - 1,
            text: `Carry on: fail[${m - 1}] = ${next}, so slide the pattern ${m - next} and keep ${next} matched.`,
          });
        }
        j = next;
      }
    } else if (j > 0) {
      const next = table[j - 1];
      steps.push({
        phase: 'search',
        kind: 'shift',
        shift: i - next,
        matched: next,
        known: m,
        cell: j - 1,
        text: `${j} matched and fail[${j - 1}] = ${next}: slide the pattern ${j - next} and keep ${next} matched. The text position stays at ${i}.`,
      });
      j = next;
    } else {
      i++;
    }
  }
  return { steps, matches, table, textTable: [] };
}

function zMatch(text: string, p: string): MatchTrace {
  const steps: MatchStep[] = [];
  const matches: number[] = [];
  const m = p.length;
  const table = zArray(p);
  const textTable = new Array<number>(text.length).fill(0);
  if (m === 0) return { steps, matches, table, textTable };

  steps.push({
    phase: 'build',
    kind: 'set',
    shift: 0,
    matched: 0,
    known: 1,
    cell: 0,
    text: `Z[0] is the whole pattern by definition (${m}).`,
  });

  // Pass 1: Z of the pattern. Pass 2: the same loop continued over the text, as if
  // the string were pattern + separator + text. The separator matches nothing, so
  // no value exceeds m and the box always maps into the pattern.
  const run = (top: string, search: boolean) => {
    const phase = search ? 'search' : 'build';
    const out = search ? textTable : table;
    const name = search ? 'Zt' : 'Z';
    let l = 0;
    let r = 0;
    for (let i = search ? 0 : 1; i < top.length; i++) {
      const frame = () =>
        ({
          phase,
          known: search ? m : i,
          knownText: search ? i : undefined,
          box: r > l ? ([l, r] as const) : undefined,
        }) as const;
      let z = 0;
      if (i < r) {
        z = Math.min(r - i, table[i - l]);
        steps.push({
          ...frame(),
          kind: 'shift',
          shift: l,
          matched: 0,
          at: i,
          cell: i - l,
          text:
            table[i - l] < r - i
              ? `Position ${i} is inside the box [${l}, ${r}), which copies the pattern's start. Z[${i - l}] = ${table[i - l]} ends inside the box, so ${name}[${i}] = ${z} with no comparisons.`
              : `Position ${i} is inside the box [${l}, ${r}). Z[${i - l}] = ${table[i - l]} reaches the box's end, so ${z} letters are known to match; compare beyond the box.`,
        });
      }
      if (i + z >= r) {
        while (i + z < top.length && z < m) {
          const equal = top[i + z] === p[z];
          steps.push({
            ...frame(),
            kind: 'compare',
            shift: i,
            matched: z + (equal ? 1 : 0),
            at: i + z,
            equal,
            text: equal
              ? `${search ? 'Text' : 'Pattern'} ${q(top[i + z])} at ${i + z} equals pattern[${z}].`
              : `${search ? 'Text' : 'Pattern'} ${q(top[i + z])} at ${i + z} differs from pattern[${z}] ${q(p[z])}.`,
          });
          if (!equal) break;
          z++;
        }
      }
      out[i] = z;
      if (i + z > r) {
        l = i;
        r = i + z;
      }
      const found = search && z === m;
      if (found) matches.push(i);
      steps.push({
        phase,
        kind: found ? 'found' : 'set',
        shift: i,
        matched: z,
        cell: i,
        known: search ? m : i + 1,
        knownText: search ? i + 1 : undefined,
        box: r > l ? [l, r] : undefined,
        text: found
          ? `Zt[${i}] = ${z}, the pattern's length: match at position ${i}.`
          : `${name}[${i}] = ${z}.${l === i && z > 0 ? ` The box becomes [${l}, ${r}).` : ''}`,
      });
    }
  };
  run(p, false);
  run(text, true);
  return { steps, matches, table, textTable };
}

export function matchTrace(matcher: Matcher, text: string, pattern: string): MatchTrace {
  return matcher === 'kmp'
    ? kmp(text, pattern)
    : matcher === 'z'
      ? zMatch(text, pattern)
      : naive(text, pattern);
}
