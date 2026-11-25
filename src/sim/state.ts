/**
 * The complete simulation state. Everything that must survive a save/load or
 * feed the determinism hash lives here; nothing else in the sim is authoritative.
 *
 * `cache` is the exception: it holds indexes and results derived from the
 * saved fields (tile -> building, the power network, last dispatch figures).
 * It is never saved; `rebuildCache()` recreates it after load, so it must be a
 * pure function of the saved state.
 */
import { GAME } from './data';
import { generateTerrain } from './mapgen';
import { Rng, seedState } from './rng';
import type { AssetLayer, CrewType, IncidentKind, WeatherEventId, ZoneId } from './types';
import { rebuildCache } from './cache';
import { initWeather } from './weather';
import { createWorld } from './world';
import type { WorldState } from './world';

/** RNG stream id for the live simulation. */
export const SIM_STREAM = 0;

/** A placed or grown building. Facilities (power plants, substations) are buildings too. */
export interface Building {
  readonly id: number;
  /** Definition code (buildings.json or power.json). */
  readonly code: number;
  /** Top-left tile of the footprint. */
  readonly x: number;
  readonly y: number;
  /** 0..1 share of capacity in use (residents or jobs). Facilities stay at 1. */
  occupancy: number;
  /** Minutes without power so far; 0 means powered. */
  unpoweredMinutes: number;
  /** Batteries only: stored energy in MWh. */
  storedMWh: number;
  /** Service reservoirs and water towers only: stored water in Ml. */
  storedMl: number;
  /** Minutes without water supply so far; 0 means supplied. */
  dryMinutes: number;
  /** Facilities: asset condition 0..100 (grown buildings keep 100; they do not decay). */
  condition: number;
  /** Day (1-based) the building was built or grown. */
  builtDay: number;
  /** Facilities: peak load share since the last daily decay (output / capacity), 0..~1. */
  peakLoad: number;
}

/** What an incident or work order concerns: a tile asset (id = tile) or a facility (id = building id). */
export interface AssetRef {
  layer: AssetLayer;
  id: number;
}

/** A failure or event that needs attention. Kept (resolved ones for a while) in ascending id. */
export interface Incident {
  readonly id: number;
  readonly kind: IncidentKind;
  /** Player-facing title, fixed when it opens (e.g. "Burst water main (feeder main)"). */
  readonly title: string;
  /** The failed asset; null for incidents with no asset (storm overflows). */
  readonly asset: AssetRef | null;
  /** Location tile (asset tile or facility origin). */
  readonly tile: number;
  readonly openedMinute: number;
  /** Target minutes to resolve (0 = none). */
  readonly slaMinutes: number;
  /** Minute it was resolved; -1 while open. */
  resolvedMinute: number;
  /** How it ended: repaired, removed (asset demolished or replaced), cleared (resolved itself). */
  outcome: '' | 'repaired' | 'removed' | 'cleared';
  /** Current severity, 1 (low) to 4 (critical). */
  severity: number;
  /** Customers (households and businesses) without supply now, and at the worst. */
  customers: number;
  peakCustomers: number;
  /** Priority customers (care homes, hospitals) without supply now. */
  priorityCustomers: number;
  customerMinutes: number;
  /** A bottled-water response has been sent. */
  bottledWater: boolean;
  slaBreached: boolean;
  /** Repair work order (0 = none). */
  orderId: number;
}

export type WorkOrderStatus = 'queued' | 'enRoute' | 'onSite';

/** A job for a crew: a reactive repair or planned maintenance. Removed when done. */
export interface WorkOrder {
  readonly id: number;
  readonly type: 'repair' | 'maintenance';
  readonly crew: CrewType;
  readonly asset: AssetRef;
  /** Site tile the crew drives to. */
  readonly tile: number;
  readonly incidentId: number;
  /** 1 (emergency) to 4 (routine). Follows the incident's severity unless set by the player. */
  priority: number;
  manualPriority: boolean;
  status: WorkOrderStatus;
  readonly createdMinute: number;
  readonly workMinutes: number;
  /** Cost in pounds: planned work is paid when raised, repairs when finished. */
  readonly cost: number;
  readonly prepaid: boolean;
  crewId: number;
  /** Minute the crew started work on site (-1 before). */
  startedMinute: number;
}

export type CrewStatus = 'idle' | 'enRoute' | 'onSite' | 'returning';

/** A crew and its van. Based at a depot; travels along roads. */
export interface Crew {
  readonly id: number;
  readonly type: CrewType;
  readonly depot: number;
  status: CrewStatus;
  orderId: number;
  /** Route tiles from start to destination (consecutive tiles may be an off-road leg). */
  path: number[];
  /** Minute the van sets off (after mobilising) and arrives. */
  departMinute: number;
  arriveMinute: number;
  /** Where the crew is while stationary (depot exit or site). */
  tile: number;
}

/** Headline service figures (saved). */
export interface AssetKpis {
  incidents: number;
  repairs: number;
  /** Sum of open-to-repaired minutes over repaired incidents (for MTTR). */
  repairMinutes: number;
  slaMet: number;
  slaMissed: number;
  /** Customer-minutes without water or power, all time and today (reset at midnight). */
  customerMinutes: number;
  customerMinutesToday: number;
  customerMinutesYesterday: number;
}

/** Saved bookkeeping for asset decay, incidents, work orders and crews. */
export interface AssetsState {
  /** Next tile the daily decay sweep visits. */
  cursor: number;
  nextIncidentId: number;
  nextOrderId: number;
  nextCrewId: number;
  kpi: AssetKpis;
}

/** Derived per-tile fault flags (see FAULT) and facilities out of service. */
export interface FaultCache {
  tile: Uint8Array;
  offline: Set<number>;
  /** Incident id per tile asset key / facility, for quick lookups (open incidents only). */
  incidentAt: Map<string, number>;
  /** Work order id per asset key (every live order). */
  orderAt: Map<string, number>;
}

/** A named industrial estate: a 4-connected group of industrial-zoned tiles. */
export interface Estate {
  readonly id: number;
  readonly name: string;
  /** A tile inside the estate, used to keep the name when the estate changes shape. */
  anchor: number;
}

export interface WeatherState {
  temperatureC: number;
  rainMmPerHour: number;
  windMs: number;
  /** Cloud cover 0..1. */
  cloud: number;
  /** Solar irradiance factor 0..1 (0 at night). */
  sunshine: number;
  /** Today's temperature anomaly from the seasonal mean. */
  anomalyC: number;
  wetDay: boolean;
  dayCloud: number;
  dayWindMs: number;
  /** Hourly interpolation endpoints. */
  windFrom: number;
  windTo: number;
  cloudFrom: number;
  cloudTo: number;
  event: { id: WeatherEventId; startDay: number; endDay: number } | null;
}

/** Game rules chosen at new game (sandbox settings; more arrive in M7). */
export interface GameRules {
  weatherEvents: boolean;
}

export interface PowerIslandStats {
  id: number;
  capacityMW: number;
  availableMW: number;
  demandMW: number;
  servedMW: number;
  storedMWh: number;
}

/** City-wide power figures from the last dispatch (derived, for UI). */
export interface PowerStats {
  capacityMW: number;
  availableMW: number;
  demandMW: number;
  servedMW: number;
  shedMW: number;
  renewableMW: number;
  storedMWh: number;
  storageMWh: number;
  buildingsOff: number;
  residentsOff: number;
  islands: PowerIslandStats[];
}

export interface PowerIsland {
  readonly id: number;
  readonly facilities: Building[];
  /** Total nameplate generation capacity (excluding batteries), MW. */
  readonly generationMW: number;
}

export interface PowerNetwork {
  islands: PowerIsland[];
  /** Facility id -> island id. */
  islandOf: Map<number, number>;
  /** Tile -> id of the substation that serves it (0 = none in range). */
  coverage: Int32Array;
  /** Substation id -> most power it can draw through its weakest line, MW. */
  feedMW: Map<number, number>;
  /** Tile -> island id for line and power facility tiles (0 = not a node). */
  islandAt: Int32Array;
}

/** Saved water bookkeeping: the solve cursor, daily abstraction counters and alert flags. */
export interface WaterState {
  /** Step of the current solve round (index into the solvable networks, then the finish step); -1 idle. */
  cursor: number;
  /** River water taken by intakes today, Ml (public supply licence). */
  abstractedTodayMl: number;
  /** River water taken directly by farms for irrigation today, Ml. */
  farmAbstractedTodayMl: number;
  /** Farm irrigation from the river has hit today's licence and stopped. */
  irrigationCapped: boolean;
  /** The public supply licence has been exceeded today (reported once a day). */
  licenceBreached: boolean;
  /** A storm overflow is spilling now. */
  overflowing: boolean;
  /** Volume spilled in the current or last overflow, Ml. */
  spillMl: number;
  /** Some customers have no supply (for start/end events). */
  supplyAlert: boolean;
  /** Some priority customers have no supply. */
  priorityAlert: boolean;
}

/** One connected group of mains and water facilities (derived from the layout). */
export interface WaterNetwork {
  readonly id: number;
  /** Tiles in the network (mains and facility footprints), ascending. */
  readonly tiles: number[];
  /** Water facilities in the network (ascending id), sewage works excluded. */
  readonly facilities: Building[];
  /** Has a treatment works or storage, so the solver must run for it. */
  readonly solvable: boolean;
}

/** One connected group of road tiles (sewers) and sewage works (derived). */
export interface SewerNetwork {
  readonly id: number;
  readonly tiles: number;
  readonly works: Building[];
}

export interface WaterLayout {
  /** Tile -> water network id (0 = none). */
  netAt: Int32Array;
  /** Tile -> pressure zone id (0 = none; booster tiles are 0). Boosters separate zones. */
  zoneAt: Int32Array;
  /** Tile -> sewer network id (0 = none). */
  sewerAt: Int32Array;
  networks: WaterNetwork[];
  /** Ids of networks the solver runs for, in order. */
  solvable: number[];
  sewers: SewerNetwork[];
}

/** City-wide water figures (derived, for UI). Filled per solve round. */
export interface WaterStats {
  demandLps: number;
  suppliedLps: number;
  /** Treatment output possible right now (powered works, limited by intakes), l/s. */
  productionLps: number;
  storedMl: number;
  storageMl: number;
  customers: number;
  lowPressure: number;
  noSupply: number;
  priorityNoSupply: number;
  residentsNoSupply: number;
  sewageInflowLps: number;
  sewageCapacityLps: number;
  spillLps: number;
  untreatedLps: number;
  irrigationLps: number;
  licenceMlPerDay: number;
  farmLicenceMlPerDay: number;
  /** Water lost from unisolated bursts, l/s. */
  leakageLps: number;
}

export interface SimCache {
  /** Tile -> building id (0 = none). */
  buildingAt: Int32Array;
  byId: Map<number, Building>;
  /** Tile -> estate id (0 = none). */
  estateAt: Int32Array;
  network: PowerNetwork;
  power: PowerStats;
  /** Building id -> current load (kW) and facility output (MW), from the last dispatch. */
  loadKw: Map<number, number>;
  outputMW: Map<number, number>;
  /** Whether rolling outages were in force at the last dispatch (for events). */
  shedding: boolean;
  water: WaterLayout;
  waterStats: WaterStats;
  /** Facility id -> flow (l/s) at its last solve: output, abstraction, storage out (+) / in (-), booster throughput, sewage inflow. */
  waterFlowLps: Map<number, number>;
  /** Building id -> water use (l/s) at its last solve. */
  waterUseLps: Map<number, number>;
  /** Per-network figures gathered during the current solve round (UI only). */
  waterRound: WaterNetworkResult[];
  faults: FaultCache;
}

/** Network-level figures from one solve (for the UI). */
export interface WaterNetworkResult {
  demandLps: number;
  suppliedLps: number;
  /** Treatment output possible (powered works, limited by intakes), l/s. */
  productionLps: number;
  leakLps: number;
}

export interface SimState {
  /** Seed the game was created from. */
  readonly seed: number;
  /** Ticks run since the game started. */
  tick: number;
  /** Absolute game minute (see time.ts). */
  minute: number;
  /** The live simulation RNG. Its state is saved. */
  rng: Rng;
  /** Cash balance in whole pounds. Can go negative later via loans. */
  cash: number;
  rules: GameRules;
  world: WorldState;
  /** All buildings, in ascending id order. */
  buildings: Building[];
  nextBuildingId: number;
  estates: Estate[];
  nextEstateId: number;
  weather: WeatherState;
  /** Zone demand, -1..1, recomputed hourly. */
  demand: Record<ZoneId, number>;
  /** Next tile index the growth scan will look at. */
  growthCursor: number;
  water: WaterState;
  assets: AssetsState;
  /** Open incidents and recently resolved ones, ascending id. */
  incidents: Incident[];
  /** Live work orders, ascending id. */
  workOrders: WorkOrder[];
  /** Crews, ascending id. */
  crews: Crew[];
  /** Derived data; never saved. */
  cache: SimCache;
}

export interface NewGameOptions {
  seed: number;
  startingCash?: number;
  mapSize?: number;
  weatherEvents?: boolean;
}

export const emptyDemand = (): Record<ZoneId, number> => ({
  residential: 0,
  commercial: 0,
  office: 0,
  industrial: 0,
  agricultural: 0,
});

export const emptyPowerStats = (): PowerStats => ({
  capacityMW: 0,
  availableMW: 0,
  demandMW: 0,
  servedMW: 0,
  shedMW: 0,
  renewableMW: 0,
  storedMWh: 0,
  storageMWh: 0,
  buildingsOff: 0,
  residentsOff: 0,
  islands: [],
});

export const initialWaterState = (): WaterState => ({
  cursor: -1,
  abstractedTodayMl: 0,
  farmAbstractedTodayMl: 0,
  irrigationCapped: false,
  licenceBreached: false,
  overflowing: false,
  spillMl: 0,
  supplyAlert: false,
  priorityAlert: false,
});

export const emptyWaterStats = (): WaterStats => ({
  demandLps: 0,
  suppliedLps: 0,
  productionLps: 0,
  storedMl: 0,
  storageMl: 0,
  customers: 0,
  lowPressure: 0,
  noSupply: 0,
  priorityNoSupply: 0,
  residentsNoSupply: 0,
  sewageInflowLps: 0,
  sewageCapacityLps: 0,
  spillLps: 0,
  untreatedLps: 0,
  irrigationLps: 0,
  licenceMlPerDay: 0,
  farmLicenceMlPerDay: 0,
  leakageLps: 0,
});

export const emptyKpis = (): AssetKpis => ({
  incidents: 0,
  repairs: 0,
  repairMinutes: 0,
  slaMet: 0,
  slaMissed: 0,
  customerMinutes: 0,
  customerMinutesToday: 0,
  customerMinutesYesterday: 0,
});

export const initialAssetsState = (): AssetsState => ({
  cursor: 0,
  nextIncidentId: 1,
  nextOrderId: 1,
  nextCrewId: 1,
  kpi: emptyKpis(),
});

/** An empty cache sized for the world; call rebuildCache() to fill it. */
export function emptyCache(world: WorldState): SimCache {
  const n = world.width * world.height;
  return {
    buildingAt: new Int32Array(n),
    byId: new Map(),
    estateAt: new Int32Array(n),
    network: {
      islands: [],
      islandOf: new Map(),
      coverage: new Int32Array(n),
      feedMW: new Map(),
      islandAt: new Int32Array(n),
    },
    power: emptyPowerStats(),
    loadKw: new Map(),
    outputMW: new Map(),
    shedding: false,
    water: {
      netAt: new Int32Array(n),
      zoneAt: new Int32Array(n),
      sewerAt: new Int32Array(n),
      networks: [],
      solvable: [],
      sewers: [],
    },
    waterStats: emptyWaterStats(),
    waterFlowLps: new Map(),
    waterUseLps: new Map(),
    waterRound: [],
    faults: {
      tile: new Uint8Array(n),
      offline: new Set(),
      incidentAt: new Map(),
      orderAt: new Map(),
    },
  };
}

/** Placeholder weather; the weather module rolls the real first day in createInitialState. */
export const blankWeather = (): WeatherState => ({
  temperatureC: 10,
  rainMmPerHour: 0,
  windMs: 5,
  cloud: 0.5,
  sunshine: 0,
  anomalyC: 0,
  wetDay: false,
  dayCloud: 0.5,
  dayWindMs: 5,
  windFrom: 5,
  windTo: 5,
  cloudFrom: 0.5,
  cloudTo: 0.5,
  event: null,
});

/** A new game: generated terrain, first day's weather rolled, caches built. */
export function createInitialState(opts: NewGameOptions): SimState {
  const size = opts.mapSize ?? GAME.mapSize;
  const world = createWorld(size, size);
  generateTerrain(world, opts.seed);
  const state: SimState = {
    seed: opts.seed >>> 0,
    tick: 0,
    minute: GAME.startMinute,
    rng: new Rng(seedState(opts.seed, SIM_STREAM)),
    cash: opts.startingCash ?? GAME.startingCash,
    rules: { weatherEvents: opts.weatherEvents ?? true },
    world,
    buildings: [],
    nextBuildingId: 1,
    estates: [],
    nextEstateId: 1,
    weather: blankWeather(),
    demand: emptyDemand(),
    growthCursor: 0,
    water: initialWaterState(),
    assets: initialAssetsState(),
    incidents: [],
    workOrders: [],
    crews: [],
    cache: emptyCache(world),
  };
  initWeather(state);
  rebuildCache(state);
  return state;
}
