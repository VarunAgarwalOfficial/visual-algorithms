/**
 * Lindenmayer systems: a string rewritten in parallel, then read as turtle
 * commands. F and G draw a unit step, f moves without drawing, + and − turn,
 * [ and ] save and restore the turtle, | turns around. Other symbols only
 * take part in the rewriting.
 */

export type Rules = ReadonlyMap<string, string>;

const SYMBOL = /^[A-Za-z0-9+\-[\]|]$/;

export const MAX_RULES = 12;
export const MAX_RULE_LENGTH = 80;

/** Keeps only the characters an L-system string may hold. */
export function cleanSymbols(text: string, maxLength: number): string {
  // The typographic minus is accepted as a turn.
  return [...text.replace(/−/g, '-')]
    .filter((c) => SYMBOL.test(c))
    .slice(0, maxLength)
    .join('');
}

/**
 * Parses rules written as "F=F+F--F+F; X=FX". Returns the rules, or a message
 * saying what is wrong. An empty right-hand side erases the symbol.
 */
export function parseRules(text: string): { rules: Map<string, string>; error?: string } {
  const rules = new Map<string, string>();
  for (const raw of text.split(/[;,\n]/)) {
    const part = raw.replace(/\s+/g, '').replace(/−/g, '-').replace(/→|->/, '=');
    if (!part) continue;
    const at = part.indexOf('=');
    if (at !== 1) return { rules, error: `"${raw.trim()}" should look like F=F+F.` };
    const symbol = part[0];
    const body = part.slice(2);
    if (!/^[A-Za-z0-9]$/.test(symbol)) {
      return { rules, error: `"${symbol}" cannot be rewritten: use a letter or digit.` };
    }
    const bad = [...body].find((c) => !SYMBOL.test(c));
    if (bad) return { rules, error: `"${bad}" is not a symbol.` };
    if (body.length > MAX_RULE_LENGTH) {
      return { rules, error: `A rule can be at most ${MAX_RULE_LENGTH} symbols long.` };
    }
    if (rules.has(symbol)) return { rules, error: `"${symbol}" has two rules.` };
    if (rules.size >= MAX_RULES) return { rules, error: `At most ${MAX_RULES} rules.` };
    rules.set(symbol, body);
  }
  return { rules };
}

export interface Expansion {
  text: string;
  /** String length of every generation reached, starting with the axiom. */
  lengths: number[];
  /** True when a generation would have passed the cap, so the run stopped early. */
  truncated: boolean;
}

/**
 * Rewrites the axiom `iterations` times. Every symbol is replaced at once;
 * symbols without a rule stay. Stops before a generation longer than
 * `maxLength`, so no input can take long.
 */
export function expand(
  axiom: string,
  rules: Rules,
  iterations: number,
  maxLength = 200_000,
): Expansion {
  let text = axiom.slice(0, maxLength);
  const lengths = [text.length];
  for (let g = 0; g < iterations; g++) {
    const parts: string[] = [];
    let size = 0;
    for (const symbol of text) {
      const next = rules.get(symbol) ?? symbol;
      size += next.length;
      if (size > maxLength) return { text, lengths, truncated: true };
      parts.push(next);
    }
    text = parts.join('');
    lengths.push(text.length);
  }
  return { text, lengths, truncated: false };
}

export interface TurtlePath {
  /** x1, y1, x2, y2 for each drawn step, in drawing order. y points up. */
  segments: Float32Array;
  count: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const MAX_STACK = 4096;

/** Walks the string with a turtle that starts at the origin facing `heading` degrees. */
export function turtle(
  text: string,
  angleDegrees: number,
  headingDegrees = 0,
  maxSegments = 100_000,
): TurtlePath {
  const turn = (angleDegrees * Math.PI) / 180;
  let x = 0;
  let y = 0;
  let heading = (headingDegrees * Math.PI) / 180;
  const stack: number[] = [];
  const out: number[] = [];
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const symbol of text) {
    if (symbol === 'F' || symbol === 'G' || symbol === 'f') {
      const nx = x + Math.cos(heading);
      const ny = y + Math.sin(heading);
      if (symbol !== 'f') {
        if (out.length >= maxSegments * 4) break;
        out.push(x, y, nx, ny);
        if (nx < minX) minX = nx;
        if (nx > maxX) maxX = nx;
        if (ny < minY) minY = ny;
        if (ny > maxY) maxY = ny;
      }
      x = nx;
      y = ny;
    } else if (symbol === '+') heading += turn;
    else if (symbol === '-') heading -= turn;
    else if (symbol === '|') heading += Math.PI;
    else if (symbol === '[') {
      if (stack.length < MAX_STACK * 3) stack.push(x, y, heading);
    } else if (symbol === ']' && stack.length >= 3) {
      heading = stack.pop() as number;
      y = stack.pop() as number;
      x = stack.pop() as number;
    }
  }
  return { segments: Float32Array.from(out), count: out.length / 4, minX, minY, maxX, maxY };
}
