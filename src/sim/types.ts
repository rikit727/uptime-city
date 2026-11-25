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

/** Season ids, in calendar order. Definitions live in src/data/weather.json. */
export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASON_ORDER: readonly SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];

/** Weather event ids (src/data/weather.json `events`). */
export type WeatherEventId = 'heatwave' | 'coldSnap' | 'storm';

/** Power facility ids (src/data/power.json `facilities`). */
export type PowerFacilityId = 'gasPlant' | 'solarFarm' | 'windTurbine' | 'battery' | 'substation';
export type FacilityKind = 'gas' | 'solar' | 'wind' | 'battery' | 'substation';

/** Water and wastewater facility ids (src/data/water.json `facilities`). */
export type WaterFacilityId =
  'intake' | 'treatmentWorks' | 'serviceReservoir' | 'waterTower' | 'booster' | 'sewageWorks';
/** intake: river abstraction; treatment: clean-water works; storage: reservoir or tower. */
export type WaterFacilityKind = 'intake' | 'treatment' | 'storage' | 'booster' | 'sewage';

/** Any player-placed facility. */
export type FacilityId = PowerFacilityId | WaterFacilityId;

/** Water main ids (src/data/water.json `mains`). Codes live in the world's water layer. */
export type MainTypeId = 'distribution' | 'feeder' | 'trunk';

/** Power line type ids (src/data/power.json `lines`). Codes live in the world's power layer. */
export type LineTypeId = 'distribution' | 'transmission';

/** Farm field styles, used for seasonal field colours. */
export type FieldStyle = 'arable' | 'pasture' | 'glasshouse';
