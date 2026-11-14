/** A function returning uniform numbers in [0, 1), like Math.random. */
export type Random = () => number;

/**
 * Mulberry32: a small seeded generator. The demos use it so that a seed in the
 * URL reproduces the same input.
 */
export function seeded(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh seed for "Randomise" buttons: small enough to read in a URL. */
export function newSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

/** Integer in [lo, hi] inclusive. */
export function randomInt(random: Random, lo: number, hi: number): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}

/** Fisher-Yates shuffle, in place. */
export function shuffle<T>(items: T[], random: Random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
