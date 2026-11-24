/** Core value types shared across the simulation. Pure data, no behaviour. */

export interface TileCoord {
  readonly x: number;
  readonly y: number;
}

/** Terrain codes stored in `WorldState.terrain`. */
export const Terrain = {
  Land: 0,
  Water: 1,
} as const;
export type TerrainCode = (typeof Terrain)[keyof typeof Terrain];

/** Road class ids. Numeric codes live in src/data/roads.json (`code`), 0 = no road. */
export type RoadClassId = 'local' | 'avenue' | 'highway';

/** Zone type ids. Numeric codes live in src/data/zones.json (`code`), 0 = unzoned. */
export type ZoneId = 'residential' | 'commercial' | 'office' | 'industrial' | 'agricultural';

/** Zone density ids. Numeric codes live in src/data/zones.json, 0 = not applicable. */
export type DensityId = 'low' | 'medium' | 'high';
