/**
 * Typed access to the JSON definitions in src/data. The simulation reads all
 * tunable numbers through this module so content can change without code changes.
 */
import gameJson from '../data/game.json';
import roadsJson from '../data/roads.json';
import zonesJson from '../data/zones.json';
import type { DensityId, RoadClassId, ZoneId } from './types';

export interface GameConfig {
  mapSize: number;
  metresPerTile: number;
  startingCash: number;
  startMinute: number;
  ticksPerRealSecondAt1x: number;
  speeds: number[];
  agriculturalEdgeBand: number;
  river: { minWidth: number; maxWidth: number };
}

export interface RoadClassDef {
  id: RoadClassId;
  code: number;
  name: string;
  lanes: number;
  capacityVehPerHour: number;
  speedKmh: number;
  costPerTile: number;
  colour: string;
}

export interface ZoneTypeDef {
  id: ZoneId;
  code: number;
  name: string;
  hasDensity: boolean;
  edgeOnly: boolean;
  costPerTile: number;
  colours: Record<DensityId, string>;
}

export interface DensityDef {
  id: DensityId;
  code: number;
  name: string;
}

export const GAME: GameConfig = gameJson;

export const ROADS = {
  bridgeCostMultiplier: roadsJson.bridgeCostMultiplier,
  demolishCostPerTile: roadsJson.demolishCostPerTile,
  classes: roadsJson.classes as RoadClassDef[],
};

export const ZONES = {
  densities: zonesJson.densities as DensityDef[],
  types: zonesJson.types as ZoneTypeDef[],
};

function indexBy<T, K extends string | number>(items: T[], key: (t: T) => K): Map<K, T> {
  const map = new Map<K, T>();
  for (const item of items) {
    const k = key(item);
    if (map.has(k)) throw new Error(`Duplicate data key: ${String(k)}`);
    map.set(k, item);
  }
  return map;
}

const roadById = indexBy(ROADS.classes, (r) => r.id);
const roadByCode = indexBy(ROADS.classes, (r) => r.code);
const zoneById = indexBy(ZONES.types, (z) => z.id);
const zoneByCode = indexBy(ZONES.types, (z) => z.code);
const densityById = indexBy(ZONES.densities, (d) => d.id);
const densityByCode = indexBy(ZONES.densities, (d) => d.code);

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Unknown ${what}`);
  return value;
}

export const roadClass = (id: RoadClassId): RoadClassDef => must(roadById.get(id), `road ${id}`);
export const roadClassByCode = (code: number): RoadClassDef | undefined => roadByCode.get(code);
export const zoneType = (id: ZoneId): ZoneTypeDef => must(zoneById.get(id), `zone ${id}`);
export const zoneTypeByCode = (code: number): ZoneTypeDef | undefined => zoneByCode.get(code);
export const density = (id: DensityId): DensityDef => must(densityById.get(id), `density ${id}`);
export const densityByCodeOf = (code: number): DensityDef | undefined => densityByCode.get(code);
