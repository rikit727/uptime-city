/**
 * Seeded pseudo-random number generator (mulberry32). Its entire state is one
 * uint32, which is stored in the save file so a loaded game continues the same
 * random sequence. Never use Math.random() inside src/sim.
 */
export class Rng {
  private s: number;

  constructor(state: number) {
    this.s = state >>> 0;
  }

  /** Current internal state, for saving. */
  get state(): number {
    return this.s;
  }

  /** Next uint32. */
  nextUint32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Mix a seed (and optional stream label) into a well-spread uint32 state. */
export function seedState(seed: number, stream = 0): number {
  let h = (seed ^ Math.imul(stream + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
