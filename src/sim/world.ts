/**
 * The tile grid. Every per-tile layer is a flat typed array indexed by
 * `y * width + x`, which keeps memory small and makes later network and
 * overlay passes cheap.
 */
import { Terrain } from './types';
import type { TileCoord } from './types';

export interface WorldState {
  readonly width: number;
  readonly height: number;
  /** Terrain code per tile (see `Terrain`). */
  readonly terrain: Uint8Array;
  /** Road class code per tile (0 = none). See src/data/roads.json. */
  readonly road: Uint8Array;
  /** Zone type code per tile (0 = unzoned). See src/data/zones.json. */
  readonly zone: Uint8Array;
  /** Zone density code per tile (0 = n/a). */
  readonly density: Uint8Array;
}

export function createWorld(width: number, height: number): WorldState {
  const n = width * height;
  return {
    width,
    height,
    terrain: new Uint8Array(n).fill(Terrain.Land),
    road: new Uint8Array(n),
    zone: new Uint8Array(n),
    density: new Uint8Array(n),
  };
}

export const tileIndex = (w: WorldState, x: number, y: number): number => y * w.width + x;

export const inBounds = (w: WorldState, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < w.width && y < w.height;

export const coordOf = (w: WorldState, index: number): TileCoord => ({
  x: index % w.width,
  y: Math.floor(index / w.width),
});

/** Distance in tiles from (x, y) to the nearest map edge (0 on the edge row). */
export const edgeDistance = (w: WorldState, x: number, y: number): number =>
  Math.min(x, y, w.width - 1 - x, w.height - 1 - y);

export const isWater = (w: WorldState, i: number): boolean => w.terrain[i] === Terrain.Water;
