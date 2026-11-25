/**
 * The tile grid. Every per-tile layer is a flat typed array indexed by
 * `y * width + x`, which keeps memory small and makes later network and
 * overlay passes cheap.
 */
import { Terrain } from './types';
import type { TileAssetLayer, TileCoord } from './types';

/** One typed array per tile asset layer (road, main, line). */
export type PerAssetLayer<T> = Record<TileAssetLayer, T>;

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
  /** Power line type code per tile (0 = none). See src/data/power.json `lines`. */
  readonly power: Uint8Array;
  /** Water main type code per tile (0 = none). See src/data/water.json `mains`. */
  readonly water: Uint8Array;
  /**
   * Water pressure per main tile from the last network solve, whole metres of head
   * (0 = no water). Saved, because growth and supply status read it between solves.
   */
  readonly pressure: Uint8Array;
  /**
   * Traffic flow per road tile from the last assignment, PCU per hour (both
   * directions). Saved, because travel times and road wear are derived from it.
   */
  readonly traffic: Uint16Array;
  /** Asset condition per tile and layer, in hundredths of a point (0..10000; 0 where no asset). */
  readonly condition: PerAssetLayer<Uint16Array>;
  /** Day (1-based) each tile asset was laid, for its age (0 = none). */
  readonly laid: PerAssetLayer<Uint16Array>;
  /**
   * Peak load share since the last daily decay, percent (main flow / capacity,
   * line loading, road traffic flow / capacity). Saved: decay reads it, then resets it.
   */
  readonly peakLoad: PerAssetLayer<Uint8Array>;
}

const perLayer = <T>(make: () => T): PerAssetLayer<T> => ({
  road: make(),
  main: make(),
  line: make(),
});

export function createWorld(width: number, height: number): WorldState {
  const n = width * height;
  return {
    width,
    height,
    terrain: new Uint8Array(n).fill(Terrain.Land),
    road: new Uint8Array(n),
    zone: new Uint8Array(n),
    density: new Uint8Array(n),
    power: new Uint8Array(n),
    water: new Uint8Array(n),
    pressure: new Uint8Array(n),
    traffic: new Uint16Array(n),
    condition: perLayer(() => new Uint16Array(n)),
    laid: perLayer(() => new Uint16Array(n)),
    peakLoad: perLayer(() => new Uint8Array(n)),
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

/** The world layer that holds a tile asset's class code. */
export const assetCodeLayer = (w: WorldState, layer: TileAssetLayer): Uint8Array =>
  layer === 'road' ? w.road : layer === 'main' ? w.water : w.power;

export const isWater = (w: WorldState, i: number): boolean => w.terrain[i] === Terrain.Water;
