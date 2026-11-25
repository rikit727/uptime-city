/**
 * Typed access to the JSON definitions in src/data. The simulation reads all
 * tunable numbers through this module so content can change without code changes.
 */
import assetsJson from '../data/assets.json';
import buildingsJson from '../data/buildings.json';
import gameJson from '../data/game.json';
import growthJson from '../data/growth.json';
import powerJson from '../data/power.json';
import roadsJson from '../data/roads.json';
import trafficJson from '../data/traffic.json';
import waterJson from '../data/water.json';
import weatherJson from '../data/weather.json';
import zonesJson from '../data/zones.json';
import { SEASON_ORDER } from './types';
import type {
  CrewType,
  DensityId,
  DepotId,
  FacilityId,
  FacilityKind,
  FieldStyle,
  IncidentKind,
  LineTypeId,
  MainTypeId,
  PowerFacilityId,
  RoadClassId,
  SeasonId,
  TileAssetLayer,
  WaterFacilityId,
  WaterFacilityKind,
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
  /** Share of capacity left with one lane closed for works. */
  laneClosureCapacity: number;
  /** How an emergency repair closes this road. */
  repairClosure: 'full' | 'lane';
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
  /** Average water use at full occupancy, litres per day (water.json scales it by hour). */
  waterLpd: number;
  /** Farms: irrigation (or livestock watering) at reference conditions, litres per day. */
  irrigationLpd?: number;
  /**
   * Load-shedding priority: 0 is shed last (see power.json `priorityNames`). Priority 0
   * buildings are also priority water customers (hospitals, care homes).
   */
  priority: number;
  heightJitter: number;
  /** Farms: export income per day at full occupancy (used by the economy in M6). */
  exportPerDay?: number;
  fields?: FieldStyle;
}

/** A player-placed power facility (power.json). */
export interface FacilityDef extends BuildingDefBase {
  role: 'facility';
  utility: 'power';
  id: PowerFacilityId;
  kind: FacilityKind;
  capacityMW: number;
  cost: number;
  storageMWh?: number;
  efficiency?: number;
  /** Substations: distance in tiles over which they supply buildings. */
  serviceRadius?: number;
  wind?: { cutInMs: number; ratedMs: number; cutOutMs: number };
}

/** A player-placed water or wastewater facility (water.json). */
export interface WaterFacilityDef extends BuildingDefBase {
  role: 'facility';
  utility: 'water';
  id: WaterFacilityId;
  kind: WaterFacilityKind;
  cost: number;
  /** Electrical load while running, kW (pumps, treatment). */
  powerKw: number;
  /** Load-shedding priority (power.json `priorityNames`). */
  priority: number;
  /** Intake, treatment and sewage works: throughput, Ml per day. */
  capacityMlPerDay?: number;
  /** Intakes: the abstraction licence each one brings, Ml per day. */
  licenceMlPerDay?: number;
  /** Reservoirs and towers: storage, Ml. */
  storageMl?: number;
  /** Treatment works outlet and storage: pressure head supplied, m. */
  headM?: number;
  /** Boosters: head added downstream, m. */
  boostM?: number;
}

/** A maintenance depot that houses crews (assets.json `depots`). */
export interface DepotDef extends BuildingDefBase {
  role: 'facility';
  utility: 'depot';
  id: DepotId;
  kind: 'depot';
  crewType: CrewType;
  /** Crews based here. */
  crews: number;
  cost: number;
}

export type AnyFacilityDef = FacilityDef | WaterFacilityDef | DepotDef;
export type BuildingDef = GrownBuildingDef | AnyFacilityDef;

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
  facilities: Omit<FacilityDef, 'role' | 'utility'>[];
};
export const POWER: PowerConfig = {
  ...rawPower,
  facilities: rawPower.facilities.map((f): FacilityDef => ({
    ...f,
    role: 'facility',
    utility: 'power',
  })),
};

// ---- water --------------------------------------------------------------------

export interface MainTypeDef {
  id: MainTypeId;
  code: number;
  name: string;
  diameterMm: number;
  /** Flow at which the main is fully loaded, l/s. */
  capacityLps: number;
  /** Head loss per km with almost no flow (m/km). */
  baseLossPerKm: number;
  /** Extra head loss per km at capacity (m/km); scales with (flow / capacity)². */
  lossPerKmAtCapacity: number;
  costPerTile: number;
  colour: string;
}

export interface WaterConfig {
  solveIntervalMinutes: number;
  solveOffset: number;
  pressure: { goodM: number; lowM: number; noSupplyM: number; maxM: number };
  /** Pressure overlay colour ramp (colour-blind safe), from 0 m to `rampMaxM`. */
  overlay: { rampMaxM: number; ramp: string[] };
  /** Source heads are scaled by (1 - unmet share) ^ this when a network cannot meet demand. */
  deficitHeadExponent: number;
  /** Tiles around a footprint searched for a main (and a road for the sewer). */
  connectionRange: number;
  /** Minutes without water before occupancy starts to fall. */
  outageGraceMinutes: number;
  vacantUseFraction: number;
  temperature: { refC: number; perDegreeAbove: number };
  /** Hourly factors per zone, normalised to an average of 1. */
  demandCurves: Record<ZoneId, number[]>;
  irrigation: {
    seasonFactor: Record<SeasonId, number>;
    refC: number;
    perDegreeAbove: number;
    heatwaveFactor: number;
    rainStopsMmPerHour: number;
    riverRangeTiles: number;
    farmLicenceMlPerDay: number;
  };
  wastewater: { returnFraction: number; runoffCoefficient: number };
  mains: MainTypeDef[];
  mainWaterCostMultiplier: number;
  mainDemolishCostPerTile: number;
  facilities: WaterFacilityDef[];
}

const rawWater = waterJson as unknown as Omit<WaterConfig, 'facilities'> & {
  facilities: Omit<WaterFacilityDef, 'role' | 'utility'>[];
};
const normalise = (curve: number[]): number[] => {
  const mean = curve.reduce((s, v) => s + v, 0) / curve.length;
  return curve.map((v) => v / mean);
};
export const WATER: WaterConfig = {
  ...rawWater,
  demandCurves: Object.fromEntries(
    Object.entries(rawWater.demandCurves).map(([z, c]) => [z, normalise(c)]),
  ) as Record<ZoneId, number[]>,
  facilities: rawWater.facilities.map((f): WaterFacilityDef => ({
    ...f,
    role: 'facility',
    utility: 'water',
  })),
};

// ---- assets, incidents and crews ------------------------------------------------

export interface WorkSpec {
  minutes: number;
  cost: number;
}

interface AssetClassBase {
  crew: CrewType;
  /** Condition points lost per day. */
  decayPerDay: number;
  /** Extra points per day at full load, scaled by (load share)². */
  loadDecayPerDay: number;
  failureScale: number;
  /** Failure-rate multipliers while a weather event is on. */
  weather?: Partial<Record<WeatherEventId, number>>;
  repair: WorkSpec;
  maintenance: WorkSpec & { name: string };
}

/** A road class, main size or line type as an asset. */
export interface TileAssetClass extends AssetClassBase {
  id: string;
  layer: TileAssetLayer;
  /** Road class, main or line code in that layer. */
  code: number;
  name: string;
  failure: IncidentKind;
}

/** A facility kind as an asset (power and water facilities; depots do not decay). */
export interface FacilityAssetClass extends AssetClassBase {
  kind: FacilityKind | WaterFacilityKind;
}

export interface IncidentDef {
  name: string;
  /** Base severity, 1 (low) to 4 (critical). */
  severity: number;
  /** Target time to resolve; 0 = no SLA. */
  slaMinutes: number;
}

export interface AssetsConfig {
  /** [condition, daily failure probability] pairs, condition descending. */
  failureCurve: [number, number][];
  repairRestoresTo: number;
  maintenanceRestoresTo: number;
  excavationRoadWear: number;
  /** Leak from an unisolated burst, as a share of the main's capacity. */
  burstLeakFraction: number;
  householdSize: number;
  maintenanceThresholds: number[];
  resolvedKept: number;
  migrationCondition: number;
  crews: { mobiliseMinutes: number; offRoadKmh: number; roadSearchRadius: number };
  bottledWater: { cost: number };
  severity: { names: string[]; customerSteps: number[]; priorityCustomerBump: number };
  priorityNames: string[];
  incidents: Record<IncidentKind, IncidentDef>;
  tileClasses: TileAssetClass[];
  facilityClasses: FacilityAssetClass[];
  depots: DepotDef[];
}

const rawAssets = assetsJson as unknown as Omit<AssetsConfig, 'depots'> & {
  depots: Omit<DepotDef, 'role' | 'utility'>[];
};
export const ASSETS: AssetsConfig = {
  ...rawAssets,
  depots: rawAssets.depots.map((d): DepotDef => ({ ...d, role: 'facility', utility: 'depot' })),
};

const tileClassByKey = new Map<string, TileAssetClass>();
for (const c of ASSETS.tileClasses) {
  const key = `${c.layer}:${c.code}`;
  if (tileClassByKey.has(key)) throw new Error(`Duplicate asset class ${key}`);
  tileClassByKey.set(key, c);
}
const facilityClassByKind = new Map<string, FacilityAssetClass>();
for (const c of ASSETS.facilityClasses) facilityClassByKind.set(c.kind, c);

/** Asset class of a road, main or line code (undefined for code 0). */
export const tileAssetClass = (layer: TileAssetLayer, code: number): TileAssetClass | undefined =>
  tileClassByKey.get(`${layer}:${code}`);

/** Asset class of a facility kind (undefined for depots). */
export const facilityAssetClass = (kind: string): FacilityAssetClass | undefined =>
  facilityClassByKind.get(kind);

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

// ---- traffic and roadworks --------------------------------------------------------

export type TripPurpose = 'outbound' | 'return' | 'freight' | 'farm';
export const TRIP_PURPOSES: readonly TripPurpose[] = ['outbound', 'return', 'freight', 'farm'];

export interface TrafficConfig {
  cellSize: number;
  assignIntervalMinutes: number;
  assignOffset: number;
  /** Road tiles settled per tick by the assignment (at least one origin per tick). */
  nodesPerTick: number;
  /** Share of a new round's flows blended into the saved flows. */
  blend: number;
  bpr: { alpha: number; beta: number; maxRatio: number };
  /** Gravity model: destinations weighted by exp(-minutes / this). */
  deterrenceMinutes: number;
  trips: {
    outboundPerResident: number;
    visitsPerCommercialJob: number;
    freightPerIndustrialJob: number;
    freightPerCommercialJob: number;
    farmTripsPerFarm: number;
  };
  pcu: { hgv: number; farm: number };
  /** Share of each purpose's daily trips in each hour (normalised to sum to 1). */
  curves: Record<TripPurpose, number[]>;
  commute: { goodMinutes: number; badMinutes: number; minFactor: number };
  crews: { maxSlowdown: number };
  roadworks: {
    night: { startHour: number; endHour: number; costFactor: number; durationFactor: number };
    laneClosure: { durationFactor: number };
    combine: { discount: number; resurfaceFactor: number };
    allowanceMinutes: number;
  };
  cars: { pcuPerCar: number; maxPerTile: number; maxCars: number };
  overlay: { ramp: string[]; rampMaxRatio: number; closed: string; lane: string };
}

const rawTraffic = trafficJson as unknown as TrafficConfig;
const shares = (curve: number[]): number[] => {
  const sum = curve.reduce((s, v) => s + v, 0);
  return curve.map((v) => (sum > 0 ? v / sum : 0));
};
export const TRAFFIC: TrafficConfig = {
  ...rawTraffic,
  curves: Object.fromEntries(TRIP_PURPOSES.map((p) => [p, shares(rawTraffic.curves[p])])) as Record<
    TripPurpose,
    number[]
  >,
};
for (const p of TRIP_PURPOSES) {
  if (TRAFFIC.curves[p].length !== 24)
    throw new Error(`Traffic curve ${p} needs 24 hourly values.`);
}

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
const allFacilities: AnyFacilityDef[] = [
  ...POWER.facilities,
  ...WATER.facilities,
  ...ASSETS.depots,
];
const allBuildings: BuildingDef[] = [...BUILDINGS.types, ...allFacilities];
const buildingByCode = indexBy(allBuildings, (b) => b.code);
indexBy(allBuildings, (b) => b.id);
const facilityById = indexBy<AnyFacilityDef, string>(allFacilities, (f) => f.id);
const mainById = indexBy(WATER.mains, (m) => m.id);
const mainByCode = indexBy(WATER.mains, (m) => m.code);
const lineById = indexBy(POWER.lines, (l) => l.id);
const lineByCode = indexBy(POWER.lines, (l) => l.code);
const seasonById = indexBy(WEATHER.seasons, (s) => s.id);
const weatherEventById = indexBy(WEATHER.events, (e) => e.id);
if (WEATHER.seasons.map((s) => s.id).join() !== SEASON_ORDER.join()) {
  throw new Error('weather.json seasons must be listed in calendar order.');
}
for (const curves of [POWER.demandCurves, WATER.demandCurves]) {
  for (const [zone, curve] of Object.entries(curves)) {
    if (curve.length !== 24) throw new Error(`Demand curve ${zone} needs 24 hourly values.`);
  }
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
/** Any facility (power or water) by id. */
export function facilityDef(id: PowerFacilityId): FacilityDef;
export function facilityDef(id: WaterFacilityId): WaterFacilityDef;
export function facilityDef(id: DepotId): DepotDef;
export function facilityDef(id: FacilityId): AnyFacilityDef;
export function facilityDef(id: FacilityId): AnyFacilityDef {
  return must(facilityById.get(id), `facility ${id}`);
}
export const mainType = (id: MainTypeId): MainTypeDef => must(mainById.get(id), `main ${id}`);
export const mainTypeByCode = (code: number): MainTypeDef | undefined => mainByCode.get(code);
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
