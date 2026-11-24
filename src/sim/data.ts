/**
 * Typed access to the JSON definitions in src/data. The simulation reads all
 * tunable numbers through this module so content can change without code changes.
 */
import buildingsJson from '../data/buildings.json';
import gameJson from '../data/game.json';
import growthJson from '../data/growth.json';
import powerJson from '../data/power.json';
import roadsJson from '../data/roads.json';
import weatherJson from '../data/weather.json';
import zonesJson from '../data/zones.json';
import { SEASON_ORDER } from './types';
import type {
  DensityId,
  FacilityId,
  FacilityKind,
  FieldStyle,
  LineTypeId,
  RoadClassId,
  SeasonId,
  WeatherEventId,
  ZoneId,
} from './types';

export interface GameConfig {
  mapSize: number;
  metresPerTile: number;
  startingCash: number;
  startMinute: number;
  ticksPerRealSecondAt1x: number;
  speeds: number[];
  agriculturalEdgeBand: number;
  river: { minWidth: number; maxWidth: number };
  calendar: { daysPerSeason: number };
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

// ---- weather --------------------------------------------------------------

export interface SeasonDef {
  id: SeasonId;
  name: string;
  meanC: number;
  diurnalRangeC: number;
  dayLengthHours: number;
  /** Peak solar irradiance at noon under a clear sky, 0..1. */
  solarPeak: number;
  cloudMean: number;
  wetDayChance: number;
  windMeanMs: number;
}

export interface WeatherEventDef {
  id: WeatherEventId;
  name: string;
  seasons: SeasonId[];
  chancePerDay: number;
  minDays: number;
  maxDays: number;
  tempOffsetC: number;
  cloudFactor: number;
  wetFactor: number;
  windFactor: number;
  minWindMs: number;
  minRainMmPerHour: number;
}

export interface WeatherConfig {
  seasons: SeasonDef[];
  anomaly: { persistence: number; dailySpreadC: number; maxC: number };
  cloud: { dailySpread: number; wetDayBoost: number; hourlyJitter: number; irradianceLoss: number };
  rain: { showerChancePerHour: number; meanMmPerHour: number; maxMmPerHour: number };
  wind: { dailySpread: number; hourlyJitter: number; maxMs: number };
  events: WeatherEventDef[];
}

export const WEATHER = weatherJson as WeatherConfig;

// ---- buildings and power ----------------------------------------------------

export type PartShape = 'box' | 'gable' | 'cylinder' | 'tunnel' | 'rotor';

/** One primitive of a building model, in tile units relative to the footprint's top-left. */
export interface ModelPart {
  shape: PartShape;
  /** Centre within the footprint. */
  x: number;
  z: number;
  /** Base height (default 0). */
  y?: number;
  w: number;
  d: number;
  h: number;
  /** One colour, or a list the renderer picks from per building. */
  colour: string | string[];
  /** Draw window bands (lit at night when powered). */
  windows?: boolean;
}

interface BuildingDefBase {
  code: number;
  name: string;
  /** [width along x, depth along y] in tiles. */
  footprint: [number, number];
  jobs: number;
  parts: ModelPart[];
}

/** A building that grows on zoned land (buildings.json). */
export interface GrownBuildingDef extends BuildingDefBase {
  role: 'grown';
  id: string;
  /** Player-facing subtype, e.g. "Light industry", "Retail park". */
  category: string;
  zone: ZoneId;
  /** Densities it grows on; empty for zones without density. */
  densities: DensityId[];
  weight: number;
  residents: number;
  /** Peak electrical load at full occupancy, kW. */
  powerKw: number;
  /** Load-shedding priority: 0 is shed last (see power.json `priorityNames`). */
  priority: number;
  heightJitter: number;
  /** Farms: export income per day at full occupancy (used by the economy in M6). */
  exportPerDay?: number;
  fields?: FieldStyle;
}

/** A player-placed power facility (power.json). */
export interface FacilityDef extends BuildingDefBase {
  role: 'facility';
  id: FacilityId;
  kind: FacilityKind;
  capacityMW: number;
  cost: number;
  storageMWh?: number;
  efficiency?: number;
  /** Substations: distance in tiles over which they supply buildings. */
  serviceRadius?: number;
  wind?: { cutInMs: number; ratedMs: number; cutOutMs: number };
}

export type BuildingDef = GrownBuildingDef | FacilityDef;

export interface LineTypeDef {
  id: LineTypeId;
  code: number;
  name: string;
  capacityMW: number;
  costPerTile: number;
  colour: string;
}

export interface PowerConfig {
  dispatchIntervalMinutes: number;
  rota: { blocks: number; minutes: number };
  priorityNames: string[];
  temperature: {
    heatingBelowC: number;
    heatingPerDegree: number;
    coolingAboveC: number;
    coolingPerDegree: number;
  };
  vacantLoadFraction: number;
  demandCurves: Record<ZoneId, number[]>;
  lines: LineTypeDef[];
  lineWaterCostMultiplier: number;
  lineDemolishCostPerTile: number;
  facilities: FacilityDef[];
}

export const BUILDINGS = {
  demolishCostPerTile: buildingsJson.demolishCostPerTile,
  fieldColours: buildingsJson.fieldColours as Record<FieldStyle, Record<SeasonId, string>>,
  types: (buildingsJson.types as Omit<GrownBuildingDef, 'role'>[]).map((t): GrownBuildingDef => ({
    ...t,
    role: 'grown',
  })),
};

const rawPower = powerJson as unknown as Omit<PowerConfig, 'facilities'> & {
  facilities: Omit<FacilityDef, 'role'>[];
};
export const POWER: PowerConfig = {
  ...rawPower,
  facilities: rawPower.facilities.map((f): FacilityDef => ({ ...f, role: 'facility' })),
};

export interface GrowthConfig {
  scanTilesPerTick: number;
  spawnChance: number;
  initialOccupancy: number;
  occupancyGrowthPerHour: number;
  occupancyDeclinePerHour: number;
  outageGraceMinutes: number;
  demand: {
    workforcePerResident: number;
    bootstrapJobs: number;
    commercialJobsPerResident: number;
    officeJobsPerResident: number;
    industrialJobsPerResident: number;
    agriculturalJobsPerResident: number;
    baseCommercialJobs: number;
    baseOfficeJobs: number;
    baseIndustrialJobs: number;
    baseAgriculturalJobs: number;
    minScale: number;
  };
  estates: { names: string[]; suffixes: string[] };
}

export const GROWTH = growthJson as GrowthConfig;

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
const allBuildings: BuildingDef[] = [...BUILDINGS.types, ...POWER.facilities];
const buildingByCode = indexBy(allBuildings, (b) => b.code);
indexBy(allBuildings, (b) => b.id);
const facilityById = indexBy(POWER.facilities, (f) => f.id);
const lineById = indexBy(POWER.lines, (l) => l.id);
const lineByCode = indexBy(POWER.lines, (l) => l.code);
const seasonById = indexBy(WEATHER.seasons, (s) => s.id);
const weatherEventById = indexBy(WEATHER.events, (e) => e.id);
if (WEATHER.seasons.map((s) => s.id).join() !== SEASON_ORDER.join()) {
  throw new Error('weather.json seasons must be listed in calendar order.');
}
for (const [zone, curve] of Object.entries(POWER.demandCurves)) {
  if (curve.length !== 24) throw new Error(`Demand curve ${zone} needs 24 hourly values.`);
}

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

export const buildingDef = (code: number): BuildingDef | undefined => buildingByCode.get(code);
export const facilityDef = (id: FacilityId): FacilityDef =>
  must(facilityById.get(id), `facility ${id}`);
export const lineType = (id: LineTypeId): LineTypeDef => must(lineById.get(id), `line ${id}`);
export const lineTypeByCode = (code: number): LineTypeDef | undefined => lineByCode.get(code);
export const season = (id: SeasonId): SeasonDef => must(seasonById.get(id), `season ${id}`);
export const weatherEvent = (id: WeatherEventId): WeatherEventDef =>
  must(weatherEventById.get(id), `weather event ${id}`);

/** Grown building types for a zone code and density code (0 for zones without density). */
export function grownTypesFor(zoneCode: number, densityCode: number): readonly GrownBuildingDef[] {
  return grownByZoneDensity.get(zoneCode * 4 + densityCode) ?? [];
}

const grownByZoneDensity = new Map<number, GrownBuildingDef[]>();
for (const t of BUILDINGS.types) {
  const zone = zoneType(t.zone);
  const codes = zone.hasDensity ? t.densities.map((d) => density(d).code) : [0];
  for (const d of codes) {
    const key = zone.code * 4 + d;
    const list = grownByZoneDensity.get(key) ?? [];
    list.push(t);
    grownByZoneDensity.set(key, list);
  }
}
