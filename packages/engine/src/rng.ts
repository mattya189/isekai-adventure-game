export interface RandomSource {
  next(): number;
  chance(probability: number): boolean;
  integer(maxExclusive: number): number;
}

/** Deterministic 32-bit PRNG. No Math.random or Date dependency. */
export function mulberry32(seed: number): RandomSource {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (probability) => next() < Math.max(0, Math.min(1, probability)),
    integer: (maxExclusive) => {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error('maxExclusive must be a positive integer');
      }
      return Math.floor(next() * maxExclusive);
    },
  };
}
