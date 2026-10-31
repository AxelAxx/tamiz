/**
 * A seeded PRNG (mulberry32) so the synthetic datasets are reproducible byte for byte
 * (spec 007 research R-05). Not for anything security-related.
 */
export interface Random {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform integer in [min, max]. */
  between(min: number, max: number): number;
  pick<T>(items: ReadonlyArray<T>): T;
  chance(p: number): boolean;
  /** `length` decimal digits, leading zeros allowed. */
  digits(length: number): string;
}

export function seeded(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    next,
    int,
    between: (min, max) => min + int(max - min + 1),
    pick<T>(items: ReadonlyArray<T>): T {
      const item = items[int(items.length)];
      if (item === undefined) throw new Error("pick from an empty list");
      return item;
    },
    chance: (p) => next() < p,
    digits: (length) => Array.from({ length }, () => String(int(10))).join(""),
  };
}
