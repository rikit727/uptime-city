import { describe, expect, it } from 'vitest';
import { Rng, seedState } from '../../src/sim/rng';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(seedState(42));
    const b = new Rng(seedState(42));
    for (let i = 0; i < 100; i++) expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it('differs across seeds and streams', () => {
    expect(new Rng(seedState(1)).next()).not.toBe(new Rng(seedState(2)).next());
    expect(seedState(7, 0)).not.toBe(seedState(7, 1));
  });

  it('resumes from a saved state', () => {
    const a = new Rng(seedState(9));
    a.next();
    a.next();
    const b = new Rng(a.state);
    expect(b.next()).toBe(a.next());
  });

  it('produces values in range', () => {
    const r = new Rng(123);
    for (let i = 0; i < 1000; i++) {
      const f = r.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = r.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
});
