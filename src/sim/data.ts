/**
 * Typed access to the JSON definitions in src/data. The simulation reads all
 * tunable numbers through this module so content can change without code changes.
 */
import assetsJson from '../data/assets.json';
import buildingsJson from '../data/buildings.json';
import cityJson from '../data/city.json';
import economyJson from '../data/economy.json';
import gameJson from '../data/game.json';
import growthJson from '../data/growth.json';
import powerJson from '../data/power.json';
import roadsJson from '../data/roads.json';
import servicesJson from '../data/services.json';
import trafficJson from '../data/traffic.json';
import waterJson from '../data/water.json';
import weatherJson from '../data/weather.json';
import zonesJson from '../data/zones.json';
import overlaysJson from '../data/overlays.json';
import heatwaveScenario from '../data/scenarios/heatwave.json';
import coldSnapScenario from '../data/scenarios/coldSnap.json';
import ageingNetworkScenario from '../data/scenarios/ageingNetwork.json';
import commercialFireScenario from '../data/scenarios/commercialFire.json';
import { SEASON_ORDER } from './types';
import type { CityParams } from './cityGen';
import type {
  CityEventType,
  CoverageKind,
  CrewType,
  Department,
  DensityId,
  DepotId,
  Difficulty,
  FacilityId,
  FacilityKind,
  FieldStyle,
  IncidentKind,
  LineTypeId,
  MainTypeId,
  OverlayId,
  PowerFacilityId,
  RoadClassId,
  SeasonId,
  ServiceFacilityId,
  ServiceKind,
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
  difficulty: Record<Difficulty, DifficultyDef>;
  /** Days of daily KPIs kept for the dashboard. */
  kpiHistoryDays: number;
}

export interface DifficultyDef {
  name: string;
  startingCash: number;
  /** Multiplies every asset's daily failure chance. */
  failureScale: number;
  /** Multiplies asset decay. */
  decayScale: number;
  /** Multiplies council tax, business rates and farm exports. */
  incomeScale: number;
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

export const GAME: GameConfig = gameJson as unknown as GameConfig;

export const difficultyDef = (d: Difficulty): DifficultyDef => GAME.difficulty[d];

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
  /** Farms: export income per day at full occupancy (paid by the economy). */
  exportPerDay?: number;
  fields?: FieldStyle;
  /** Air and noise pollution emitted per building at full occupancy (index points). */
  pollution?: Emissions;
}

export interface Emissions {
  air: number;
  noise: number;
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

/** Landmark details: business rates, land value lift and the events it hosts. */
export interface LandmarkSpec {
  ratesPerDay: number;
  /** Land value added at the landmark, falling to nothing at `landValueRadius` tiles. */
  landValue: number;
  landValueRadius: number;
  /** Power and water multipliers while an event is on. */
  eventPowerFactor: number;
  eventWaterFactor: number;
  /** Noise added at the venue while an event is on. */
  eventNoise: number;
  events: CityEventType[];
}

/** A public service or landmark (services.json). Draws power and water like a business. */
export interface ServiceFacilityDef extends BuildingDefBase {
  role: 'facility';
  utility: 'service';
  id: ServiceFacilityId;
  kind: ServiceKind;
  cost: number;
  upkeepPerDay: number;
  powerKw: number;
  waterLpd: number;
  /** Load-shedding priority (0 also makes it a priority water customer: hospitals). */
  priority: number;
  /** Demand curve used for its power and water use (and traffic: commercial = shoppers). */
  zone: ZoneId;
  /** Always 0 (nobody lives there); present so customer code can treat it like a grown building. */
  residents: number;
  /** Residents served, pupils, tonnes a day, landfill tonnes or event attendance (see services.json). */
  capacity?: number;
  /** Fire stations: crews (fire engines) based here. */
  crewType?: CrewType;
  crews?: number;
  pollution?: Emissions;
  landmark?: LandmarkSpec;
}

export type AnyFacilityDef = FacilityDef | WaterFacilityDef | DepotDef | ServiceFacilityDef;
/** A building that draws power and water as a customer: grown buildings and services. */
export type CustomerDef = GrownBuildingDef | ServiceFacilityDef;
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
  restrictions: {
    hosepipeBan: { residentialSaving: number; happinessPenalty: number };
    irrigationBan: { exportFactor: number; happinessPenalty: number };
  };
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
  crews: {
    mobiliseMinutes: number;
    /** Crew types that mobilise faster (fire engines). */
    mobiliseByType: Partial<Record<CrewType, number>>;
    offRoadKmh: number;
    roadSearchRadius: number;
  };
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

/** Trip purposes; eventIn / eventOut are trips to and from events at landmarks. */
export type TripPurpose = 'outbound' | 'return' | 'freight' | 'farm' | 'eventIn' | 'eventOut';
export const TRIP_PURPOSES: readonly TripPurpose[] = [
  'outbound',
  'return',
  'freight',
  'farm',
  'eventIn',
  'eventOut',
];

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
// ---- services, landmarks, events -------------------------------------------------

export interface CityEventDef {
  id: CityEventType;
  name: string;
  everyDays: number;
  jitterDays: number;
  startHour: number;
  hours: number;
  /** Attendance range as a share of the venue's capacity. */
  attendance: [number, number];
  carsPerAttendee: number;
  arrivalHours: number;
  departureHours: number;
  levyPerAttendee: number;
  policePer1000: number;
  crowdRisk: number;
}

export interface ServicesConfig {
  coverage: Record<CoverageKind, { goodMinutes: number; maxMinutes: number }>;
  pupilsPerResident: number;
  unpoweredServiceFactor: number;
  waste: {
    collectionHour: number;
    tonnesPerResident: number;
    tonnesPerJob: number;
    recyclableShare: number;
    litterTonnesPerAttendee: number;
  };
  fire: {
    ignitionPerBuildingDay: number;
    zoneRisk: Record<ZoneId, number>;
    startIntensity: number;
    growthPerMinute: number;
    accelerationAt: number;
    suppressionPerAppliance: number;
    hydrantSearchTiles: number;
    hydrantLps: number;
    goodHydrantM: number;
    tankShare: number;
    /** [footprint area, appliances] pairs, ascending area. */
    appliancesByArea: [number, number][];
    damageOccupancy: number;
    gutsCondition: number;
    smokeAir: number;
    targetResponseMinutes: number;
    measures: {
      isolatePower: {
        name: string;
        cost: number;
        liveSuppressionFactor: number;
        liveGrowthFactor: number;
      };
      cordon: {
        name: string;
        cost: number;
        radiusTiles: number;
        noCordonSuppressionFactor: number;
        peoplePerPcu: number;
      };
      evacuate: { name: string; costPerBuilding: number; radiusTiles: number };
    };
    smoke: {
      radiusTiles: number;
      minIntensity: number;
      complaintExposure: number;
      costPerPersonMinute: number;
    };
  };
  events: CityEventDef[];
  eventMeasures: {
    policing: { name: string; costPer1000: number; covers: number };
    stewarding: { name: string; costPer1000: number; carReduction: number };
    closeRoads: { name: string; cost: number; crowdRiskFactor: number };
    cleanup: { name: string; costPer1000: number };
  };
  eventsKept: number;
  scheduleAheadDays: number;
  facilities: ServiceFacilityDef[];
}

const rawServices = servicesJson as unknown as Omit<ServicesConfig, 'facilities'> & {
  facilities: Omit<ServiceFacilityDef, 'role' | 'utility' | 'residents'>[];
};
export const SERVICES: ServicesConfig = {
  ...rawServices,
  facilities: rawServices.facilities.map((f): ServiceFacilityDef => ({
    ...f,
    role: 'facility',
    utility: 'service',
    residents: 0,
  })),
};

// ---- economy ---------------------------------------------------------------------

export interface EconomyConfig {
  daysPerMonth: number;
  taxes: {
    perResident: number;
    perJob: Record<'commercial' | 'office' | 'industrial' | 'agricultural', number>;
    landValueWeight: Record<ZoneId, number>;
    rateLevels: number[];
  };
  tariffs: { electricityPerMWh: number; waterPerMl: number };
  fuel: { gasPerMWh: number };
  crewCostPerDay: Record<CrewType, number>;
  budgetLevels: number[];
  departments: Record<Department, { name: string; maintenancePerDay: number }>;
  autoMaintenance: { hour: number; belowCondition: number };
  underfundedDecayFactor: number;
  /** Running cost per day of power and water facilities and depots, by kind. */
  upkeepPerDay: Record<string, number>;
  loans: { amounts: number[]; ratePerMonth: number; termMonths: number; maxDebt: number };
  fines: { licenceBreach: number; spillPerMl: number; permitClash: number; permitOverrun: number };
  historyMonths: number;
  taxDemandEffect: number;
}
export const ECONOMY = economyJson as unknown as EconomyConfig;

// ---- pollution, land value, happiness, complaints -----------------------------------

export interface CityConfig {
  pollution: {
    cellSize: number;
    spreadTiles: { air: number; noise: number };
    traffic: { airPerPcu: number; noisePerPcu: number };
    highwayNoise: number;
    gasAirPerMW: number;
    sewageAir: number;
    thresholds: Record<'air' | 'noise', { quiet: number; bad: number }>;
  };
  landValue: {
    base: number;
    services: number;
    riverBonus: number;
    riverTiles: number;
    airPenalty: number;
    noisePenalty: number;
    growthMin: number;
    growthMax: number;
  };
  happiness: {
    weights: Record<
      'services' | 'utilities' | 'waste' | 'commute' | 'pollution' | 'taxes' | 'landValue',
      number
    >;
    complaintPenalty: number;
    maxComplaintPenalty: number;
    demandEffect: number;
  };
  complaints: {
    kept: number;
    waterHours: number[];
    powerHours: number[];
    cooldownHours: Record<string, number>;
    vcComplaint: number;
  };
  streets: { names: string[]; local: string[]; avenue: string[]; highway: string[] };
}
export const CITY = cityJson as unknown as CityConfig;

const allFacilities: AnyFacilityDef[] = [
  ...POWER.facilities,
  ...WATER.facilities,
  ...ASSETS.depots,
  ...SERVICES.facilities,
];
const allBuildings: BuildingDef[] = [...BUILDINGS.types, ...allFacilities];
const buildingByCodeMap = indexBy(allBuildings, (b) => b.code);
/** Dense code -> def table: buildingDef is on every hot path, and codes are small. */
const buildingByCodeArr: (BuildingDef | undefined)[] = [];
for (const [code, def] of buildingByCodeMap) buildingByCodeArr[code] = def;
const buildingByCode = {
  get: (code: number): BuildingDef | undefined => buildingByCodeArr[code],
};
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
export function facilityDef(id: ServiceFacilityId): ServiceFacilityDef;
export function facilityDef(id: FacilityId): AnyFacilityDef;
export function facilityDef(id: FacilityId): AnyFacilityDef {
  return must(facilityById.get(id), `facility ${id}`);
}
const eventById = indexBy(SERVICES.events, (e) => e.id);
export const cityEventDef = (id: CityEventType): CityEventDef =>
  must(eventById.get(id), `event ${id}`);

/** A building's definition if it is a public service or landmark. */
export const serviceDefOf = (code: number): ServiceFacilityDef | undefined => {
  const def = buildingByCode.get(code);
  return def?.role === 'facility' && def.utility === 'service' ? def : undefined;
};

/** Customer definition (grown building or service facility) for a building code. */
export const customerDefOf = (code: number): CustomerDef | undefined => {
  const def = buildingByCode.get(code);
  return def?.role === 'grown' || def?.utility === 'service' ? def : undefined;
};

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

// ---- scenarios (milestone 7) ----------------------------------------------------------

/** Objective kinds (scenario.ts `evaluateOne`). */
export type ScenarioObjectiveKind =
  | 'supplyShare'
  | 'noLicenceBreach'
  | 'mttr'
  | 'backlog'
  | 'budget'
  | 'worksBudget'
  | 'cashAbove'
  | 'customerMinutes'
  | 'fireContained'
  | 'happiness'
  | 'cost';

export interface ScenarioObjectiveDef {
  id: string;
  kind: ScenarioObjectiveKind;
  label: string;
  /** Target value: a share (supplyShare), minutes (mttr, fireContained), a count, £ or points. */
  target: number;
  /** Backlog: the condition (%) below which an asset counts. */
  below?: number;
  /** Points when met (default 100). */
  points?: number;
}

export interface ScenarioEventDef {
  /** Game hours after the start. Events must be listed in time order. */
  afterHours: number;
  kind: 'message' | 'weather' | 'fire' | 'failures';
  text?: string;
  tone?: 'info' | 'good' | 'warn' | 'error';
  /** weather: the event and how many days it lasts. */
  event?: WeatherEventId;
  days?: number;
  /** fire: the facility id of the building that catches fire, and its intensity when reported;
   *  failures: a facility that trips out instead of the worst tile assets. */
  target?: FacilityId;
  intensity?: number;
  /** failures: how many of the worst assets of a layer fail. */
  layer?: TileAssetLayer;
  count?: number;
}

export interface ScenarioDef {
  id: string;
  name: string;
  /** One line for the scenario list, and the briefing shown before it starts. */
  summary: string;
  briefing: string[];
  seed: number;
  start: { year: number; season: SeasonId; day: number; hour: number };
  durationHours: number;
  /** End early once the scenario's fire is out, `afterFireHours` later. */
  endOnFireOut?: boolean;
  afterFireHours?: number;
  rules: {
    weatherEvents: boolean;
    fires: boolean;
    difficulty: Difficulty;
    /** Abstraction licence multiplier (a drought order); default 1. */
    licenceFactor?: number;
  };
  startingCash: number;
  budgets?: Partial<Record<Department, number>>;
  constraints: {
    noLoans?: boolean;
    /** Cap on capital spending (roads, zoning, facilities, lines, mains) since the start, £. */
    capitalLimit?: number;
    /** Highest department budget level allowed (e.g. 1.2). */
    maxBudget?: number;
    /** Facilities that may not be built, and why. */
    noNewFacilities?: FacilityId[];
    noNewFacilitiesReason?: string;
  };
  city: CityParams;
  objectives: ScenarioObjectiveDef[];
  events: ScenarioEventDef[];
}

export const SCENARIOS: readonly ScenarioDef[] = [
  heatwaveScenario,
  coldSnapScenario,
  ageingNetworkScenario,
  commercialFireScenario,
] as unknown as ScenarioDef[];

export const scenarioDef = (id: string): ScenarioDef =>
  must(
    SCENARIOS.find((s) => s.id === id),
    `scenario ${id}`,
  );

// ---- overlays (milestone 7) -----------------------------------------------------------

export interface OverlayDef {
  id: Exclude<OverlayId, 'none'>;
  name: string;
  group: string;
  /** Colour stops for values 0..1 (none for purely categorical overlays). */
  ramp?: string[];
  rampLabels?: [number, string][];
  /** Category colours: overlayValues() writes -(k + 1) for category k. */
  categories?: { colour: string; label: string }[];
}

export const OVERLAYS: readonly OverlayDef[] = (
  overlaysJson as unknown as { overlays: OverlayDef[] }
).overlays;

export const overlayDef = (id: Exclude<OverlayId, 'none'>): OverlayDef =>
  must(
    OVERLAYS.find((o) => o.id === id),
    `overlay ${id}`,
  );
