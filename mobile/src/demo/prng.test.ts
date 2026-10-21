import { describe, expect, it } from 'vitest';

import { createRng, hashSeed, uuidFromLabel } from './prng';

describe('seeded random source', () => {
  it('repeats exactly for the same seed and differs for another', () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = Array.from({ length: 20 }, () => a.next());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(seqA);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('draws a standard normal with the right mean and spread', () => {
    const rng = createRng(7);
    const values = Array.from({ length: 5000 }, () => rng.normal());
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(sd).toBeGreaterThan(0.95);
    expect(sd).toBeLessThan(1.05);
  });

  it('hashes a label to a stable seed and a stable valid UUID', () => {
    expect(hashSeed('a')).toBe(hashSeed('a'));
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
    expect(uuidFromLabel('asset:X')).toBe(uuidFromLabel('asset:X'));
    expect(uuidFromLabel('asset:X')).not.toBe(uuidFromLabel('asset:Y'));
    expect(uuidFromLabel('asset:X')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
