/** A small seeded random source, so every demo run and every test is reproducible. */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal (mean 0, standard deviation 1). */
  normal(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, maxExclusive). */
  int(min: number, maxExclusive: number): number;
}

/** 32-bit FNV-1a of a string, used to turn a label into a seed. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = (): number => {
    // Box-Muller; 1 - next() keeps the logarithm finite.
    const u = 1 - next();
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return {
    next,
    normal,
    range: (min, max) => min + (max - min) * next(),
    int: (min, maxExclusive) => min + Math.floor(next() * (maxExclusive - min)),
  };
}

/** A version 4 style UUID derived from a label: stable across runs and accepted by `z.string().uuid()`. */
export function uuidFromLabel(label: string): string {
  const rng = createRng(hashSeed(label));
  const bytes = Array.from({ length: 16 }, () => rng.int(0, 256));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0'));
  return [hex.slice(0, 4), hex.slice(4, 6), hex.slice(6, 8), hex.slice(8, 10), hex.slice(10, 16)]
    .map((part) => part.join(''))
    .join('-');
}
