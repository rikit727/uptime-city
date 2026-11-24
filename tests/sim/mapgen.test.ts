import { describe, expect, it } from 'vitest';
import { GAME } from '../../src/sim/data';
import { createInitialState } from '../../src/sim/state';
import { Terrain } from '../../src/sim/types';
import { edgeDistance, tileIndex } from '../../src/sim/world';

describe('map generation', () => {
  it('builds a 128×128 grid', () => {
    const s = createInitialState({ seed: 1 });
    expect(s.world.width).toBe(128);
    expect(s.world.height).toBe(128);
    expect(s.world.terrain.length).toBe(128 * 128);
  });

  it('is deterministic per seed', () => {
    const a = createInitialState({ seed: 77 }).world.terrain;
    const b = createInitialState({ seed: 77 }).world.terrain;
    const c = createInitialState({ seed: 78 }).world.terrain;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });

  it.each([1, 2, 3, 99, 12345])(
    'makes one connected river from top to bottom (seed %i)',
    (seed) => {
      const w = createInitialState({ seed }).world;
      // every row has water, within the min/max width, away from the farmland edge band
      for (let y = 0; y < w.height; y++) {
        let count = 0;
        for (let x = 0; x < w.width; x++) {
          if (w.terrain[tileIndex(w, x, y)] === Terrain.Water) {
            count++;
            expect(edgeDistance(w, x, 64)).toBeGreaterThanOrEqual(GAME.agriculturalEdgeBand);
          }
        }
        expect(count).toBeGreaterThanOrEqual(GAME.river.minWidth - 1);
        expect(count).toBeLessThanOrEqual(GAME.river.maxWidth + 1);
      }
      // flood fill from the first water tile reaches all water
      const start = w.terrain.indexOf(Terrain.Water);
      const seen = new Uint8Array(w.terrain.length);
      const stack = [start];
      seen[start] = 1;
      let reached = 0;
      while (stack.length) {
        const i = stack.pop()!;
        reached++;
        const x = i % w.width;
        const y = Math.floor(i / w.width);
        for (const [nx, ny] of [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ] as const) {
          if (nx < 0 || ny < 0 || nx >= w.width || ny >= w.height) continue;
          const j = tileIndex(w, nx, ny);
          if (!seen[j] && w.terrain[j] === Terrain.Water) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
      expect(reached).toBe(w.terrain.filter((t) => t === Terrain.Water).length);
    },
  );
});
