import { describe, expect, it } from 'vitest';
import { rectTiles, roadPath } from '../../src/sim/geometry';

describe('roadPath', () => {
  it('handles a single tile', () => {
    expect(roadPath({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }]);
  });

  it('draws straight lines in either direction', () => {
    expect(roadPath({ x: 1, y: 2 }, { x: 4, y: 2 })).toHaveLength(4);
    const back = roadPath({ x: 4, y: 2 }, { x: 1, y: 2 });
    expect(back[0]).toEqual({ x: 4, y: 2 });
    expect(back[3]).toEqual({ x: 1, y: 2 });
    expect(roadPath({ x: 0, y: 5 }, { x: 0, y: 0 })).toHaveLength(6);
  });

  it('draws an L along the longer axis first without duplicate tiles', () => {
    const p = roadPath({ x: 0, y: 0 }, { x: 5, y: 2 });
    expect(p).toHaveLength(8);
    expect(p[5]).toEqual({ x: 5, y: 0 });
    expect(p[7]).toEqual({ x: 5, y: 2 });
    const keys = new Set(p.map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(p.length);
    const v = roadPath({ x: 0, y: 0 }, { x: 1, y: 4 });
    expect(v[4]).toEqual({ x: 0, y: 4 });
    expect(v[5]).toEqual({ x: 1, y: 4 });
  });
});

describe('rectTiles', () => {
  it('covers the rectangle from any corner', () => {
    expect(rectTiles({ x: 2, y: 2 }, { x: 0, y: 0 })).toHaveLength(9);
    expect(rectTiles({ x: 0, y: 0 }, { x: 3, y: 0 })).toHaveLength(4);
  });
});
