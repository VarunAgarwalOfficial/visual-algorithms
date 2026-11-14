import { shuffle } from '../random';

export type InputKind = 'random' | 'nearly' | 'reversed' | 'few' | 'sawtooth' | 'organ' | 'runs';

export const INPUT_KINDS: readonly { id: InputKind; name: string }[] = [
  { id: 'random', name: 'Random' },
  { id: 'nearly', name: 'Nearly sorted' },
  { id: 'reversed', name: 'Reversed' },
  { id: 'few', name: 'Few distinct values' },
  { id: 'sawtooth', name: 'Sawtooth' },
  { id: 'organ', name: 'Organ pipes' },
  { id: 'runs', name: 'Sorted runs' },
];

/** The largest value an input may hold, and the most values. */
export const MAX_VALUE = 999;
export const MAX_SIZE = 256;

/**
 * Reads a list of whole numbers separated by commas, spaces or dots. Values
 * are clamped to 1..MAX_VALUE and the list is cut at MAX_SIZE. Returns
 * undefined when fewer than two numbers are found or anything else is present.
 */
export function parseValues(text: string): number[] | undefined {
  const parts = text.split(/[\s,.;]+/).filter((part) => part !== '');
  if (parts.length < 2 || parts.some((part) => !/^\d{1,6}$/.test(part))) return undefined;
  return parts.slice(0, MAX_SIZE).map((part) => Math.max(1, Math.min(MAX_VALUE, Number(part))));
}

/** Builds an array of `size` values in 1..size with the given arrangement. */
export function makeInput(kind: InputKind, size: number, random: () => number): number[] {
  const sorted = Array.from({ length: size }, (_, i) => i + 1);
  switch (kind) {
    case 'random':
      return shuffle(sorted, random);
    case 'reversed':
      return sorted.reverse();
    case 'nearly': {
      // A handful of swaps between close neighbours.
      const swaps = Math.max(1, Math.round(size / 12));
      for (let s = 0; s < swaps && size > 1; s++) {
        const i = Math.floor(random() * (size - 1));
        const j = Math.min(size - 1, i + 1 + Math.floor(random() * 3));
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      }
      return sorted;
    }
    case 'few': {
      const levels = Math.min(5, size);
      const values = sorted.map((_, i) => Math.ceil(((1 + (i % levels)) * size) / levels));
      return shuffle(values, random);
    }
    case 'sawtooth': {
      // Four rising ramps, each covering the whole range.
      const teeth = Math.min(4, size);
      const order = Array.from({ length: size }, (_, i) => i);
      const ramp = Math.ceil(size / teeth);
      order.sort((a, b) => (a % ramp) - (b % ramp) || a - b);
      const values = new Array<number>(size);
      order.forEach((position, rank) => (values[position] = rank + 1));
      return values;
    }
    case 'organ': {
      // Odd values rising, then even values falling.
      const up = sorted.filter((v) => v % 2 === 1);
      const down = sorted.filter((v) => v % 2 === 0).reverse();
      return [...up, ...down];
    }
    case 'runs': {
      // A shuffle cut into pieces of random length, each sorted up or down.
      shuffle(sorted, random);
      const values: number[] = [];
      for (let lo = 0; lo < size;) {
        const length = 3 + Math.floor(random() * Math.max(3, size / 4));
        const piece = sorted.slice(lo, lo + length).sort((a, b) => a - b);
        values.push(...(random() < 0.3 ? piece.reverse() : piece));
        lo += length;
      }
      return values;
    }
  }
}
