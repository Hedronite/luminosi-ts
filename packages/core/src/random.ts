/** A seeded pseudo-random sequence. The same seed gives the same sequence on every platform. */
export interface Random {
  /** The next number in [0, 1). */
  next(): number;
  /** A number in [min, max). */
  range(min: number, max: number): number;
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** One item of a non-empty list. */
  pick<T>(items: readonly T[]): T;
}

/** Mulberry32: small, fast and well distributed enough for procedural geometry. Not for security. */
export function createRandom(seed: number): Random {
  let state = Math.trunc(seed) >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick(items) {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new RangeError("cannot pick from an empty list");
      return item;
    },
  };
}
