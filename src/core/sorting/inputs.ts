export type InputKind = 'random' | 'nearly' | 'reversed' | 'few';

export const INPUT_KINDS: readonly { id: InputKind; name: string }[] = [
  { id: 'random', name: 'Random' },
  { id: 'nearly', name: 'Nearly sorted' },
  { id: 'reversed', name: 'Reversed' },
  { id: 'few', name: 'Few distinct values' },
];

/** Fisher-Yates shuffle, in place. `random` returns [0, 1). */
export function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
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
  }
}
