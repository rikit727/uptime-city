/**
 * The complete simulation state. Everything that must survive a save/load or
 * feed the determinism hash lives here; nothing else in the sim is authoritative.
 *
 * `cache` is the exception: it holds indexes and results derived from the
 * saved fields (tile -> building, the power network, last dispatch figures).
 * It is never saved; `rebuildCache()` recreates it after load, so it must be a
 * pure function of the saved state.
 */
import { CITY, GAME, TRAFFIC, TRIP_PURPOSES } from './data';
import type { TripPurpose } from './data';
import { generateTerrain } from './mapgen';
import { Rng, seedState } from './rng';
import type {
  AssetLayer,
  CityEventType,
  CoverageKind,
  CrewType,
  Department,
  EventMeasure,
  IncidentKind,
  WeatherEventId,
  ZoneId,
} from './types';
import { COVERAGE_KINDS, DEPARTMENTS, TAX_ZONES } from './types';
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
  /** Firefighting orders send one fire engine to a fire; fire.ts finishes them. */
  readonly type: 'repair' | 'maintenance' | 'firefighting';
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
  /** Minutes of work on site (shorter when combined with other works on the same street). */
  workMinutes: number;
  /** Cost in pounds: planned work is paid when raised, repairs when finished. Combining discounts it. */
  cost: number;
  readonly prepaid: boolean;
  crewId: number;
  /** Minute the crew started work on site (-1 before). */
  startedMinute: number;
  /** How the road is closed while the crew is on site ('none' off the road or for overhead lines). */
  readonly closure: RoadClosure;
  /** Night works: the permit slot starts in the evening; slower and dearer, but little traffic. */
  readonly night: boolean;
  /** Street works permit (0 = none needed). The crew is not sent before the permit's slot starts. */
  permitId: number;
  /** Booked together with other works on the same street (discounted). */
  combined: boolean;
}

export type RoadClosure = 'none' | 'lane' | 'full';

/**
 * A street works permit: a booked slot for works on one road segment (a run of
 * road between junctions). Emergency repairs get one at once; planned works are
 * booked now or for tonight. Permits on the same segment whose slots overlap
 * clash (flagged; derived in the cache) unless their works are combined into one.
 */
export interface Permit {
  readonly id: number;
  readonly kind: 'planned' | 'emergency';
  /** Road tiles of the works, ascending. */
  tiles: number[];
  /** Minute the slot starts and the booked end. */
  start: number;
  end: number;
  readonly night: boolean;
  readonly closure: 'lane' | 'full';
  /** Work orders under this permit, ascending id. The permit ends when they are all done. */
  orders: number[];
  /** Works have run past the booked end (counted once). */
  overrun: boolean;
  /** Other works were combined into this permit. */
  combined: boolean;
  /** Road tiles already dug up under this permit (main works done): resurfacing there is quicker. */
  dug: number[];
}

/** Roadworks figures (saved). */
export interface RoadworksKpis {
  permits: number;
  clashes: number;
  combined: number;
  /** Pounds saved by combining works. */
  combinedSavings: number;
  overruns: number;
  nightWorks: number;
}

/**
 * Trips per hour produced and attracted by each traffic cell, fixed at the
 * start of an assignment round (values rounded to 0.01 so saves are exact).
 */
export interface TripTable {
  /** Cell -> road tile its trips load onto (-1 = nothing there). */
  load: Int32Array;
  prod: Record<TripPurpose, Float64Array>;
  attr: Record<TripPurpose, Float64Array>;
}

/**
 * Saved traffic state: the assignment round in progress (cursor, trip table,
 * flows accumulated so far), per-cell commute times and the last round's figures.
 */
export interface TrafficState {
  /** Next traffic cell of the current assignment round; -1 between rounds. */
  cursor: number;
  /** This round's trips (valid while `cursor >= 0`). */
  table: TripTable;
  /** Flows assigned so far this round, per tile, in 1/16 PCU/h. */
  pending: Uint32Array;
  /** Mean trip time from each cell's homes, minutes ×10 (0 = unknown). */
  commute: Uint16Array;
  roundTrips: number;
  roundTripMinutes: number;
  roundFreeMinutes: number;
  roundUnserved: number;
  /** Last round: trips per hour, mean trip time, congested / free-flow time, trips with no route. */
  tripsPerHour: number;
  avgTripMinutes: number;
  congestion: number;
  unservedPerHour: number;
  nextPermitId: number;
  kpi: RoadworksKpis;
}

/** Derived traffic data (never saved). */
export interface TrafficCache {
  /** Seconds to cross each road tile now (BPR with closures; Infinity = closed or no road). */
  timeSec: Float32Array;
  /** Free-flow seconds per road tile (0 = no road). */
  freeSec: Float32Array;
  /** Effective capacity per tile, PCU/h (lane closures reduce it; 0 = closed). */
  capacity: Float32Array;
  /** Crew travel-time multiplier per road tile (congestion, capped; crews pass closures). */
  crewSlow: Float32Array;
  /** Road segment id per road tile (0 = no road). Junctions are their own segments. */
  segmentAt: Int32Array;
  /** Permit id -> ids of permits it clashes with. */
  clashes: Map<number, number[]>;
  /** Building id -> road tile it loads its traffic onto (-1 = none). Cleared when roads change. */
  access: Map<number, number>;
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
  /** Random building fires (on by default; scenarios and tests may turn them off). */
  fires: boolean;
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

// ---- services, fires, events, economy, city (milestone 6) -------------------------

/** A building on fire. Fire engines are sent through firefighting work orders. */
export interface Fire {
  readonly id: number;
  readonly building: number;
  /** Road tile the engines park on (closed while they work), or the building's corner. */
  readonly tile: number;
  /** Main tile the engines draw from (-1 = none in reach: tank water only). */
  readonly hydrant: number;
  readonly startMinute: number;
  /** Share of the building involved, 0..100. */
  intensity: number;
  peak: number;
  readonly incidentId: number;
  /** Minute the first engine got there (-1 before). */
  firstArrival: number;
}

export type CityEventStatus = 'booked' | 'live' | 'done';

/** An event at a landmark (match, concert, conference, shopping weekend, graduation). */
export interface CityEvent {
  readonly id: number;
  readonly type: CityEventType;
  /** Venue building id. */
  readonly venue: number;
  /** Doors open and the event ends (minutes). Crowds arrive before and leave after. */
  readonly start: number;
  readonly end: number;
  readonly attendance: number;
  /** Preparations booked by the player (ascending order of EVENT_MEASURES). */
  measures: EventMeasure[];
  status: CityEventStatus;
  /** Filled in when it ends: congestion index at the start, crowd trouble, litter left, levy paid. */
  congestion: number;
  trouble: boolean;
  litter: boolean;
  revenue: number;
}

/** A complaint from residents, generated from real sim events. Newest last. */
export interface Complaint {
  readonly id: number;
  readonly minute: number;
  /** Category for filtering and cooldowns (water, power, bins, traffic, ...). */
  readonly kind: string;
  readonly text: string;
  readonly tile: number;
  /** De-duplication key: the same key is not repeated within its cooldown. */
  readonly key: string;
}

export type IncomeLine =
  'councilTax' | 'businessRates' | 'farmExports' | 'electricity' | 'water' | 'events';
export type ExpenseLine =
  | 'capital'
  | 'maintenance'
  | 'repairs'
  | 'crews'
  | 'upkeep'
  | 'fuel'
  | 'services'
  | 'fines'
  | 'interest';
export const INCOME_LINES: readonly IncomeLine[] = [
  'councilTax',
  'businessRates',
  'farmExports',
  'electricity',
  'water',
  'events',
];
export const EXPENSE_LINES: readonly ExpenseLine[] = [
  'capital',
  'maintenance',
  'repairs',
  'crews',
  'upkeep',
  'fuel',
  'services',
  'fines',
  'interest',
];

/** One month's accounts: income and expenses by line, plus borrowing and loan principal repaid. */
export interface Ledger {
  income: Record<IncomeLine, number>;
  expenses: Record<ExpenseLine, number>;
  borrowed: number;
  repaid: number;
}

export interface MonthSummary {
  /** Month number (1 = the first 30 days). */
  month: number;
  income: number;
  expenses: number;
  cash: number;
}

export interface Loan {
  readonly id: number;
  readonly principal: number;
  balance: number;
  readonly payment: number;
  monthsLeft: number;
}

/** Saved economy: budgets, tax rates, this and last month's accounts, meters, loans. */
export interface EconomyState {
  budgets: Record<Department, number>;
  taxRates: Record<ZoneId, number>;
  month: Ledger;
  lastMonth: Ledger | null;
  history: MonthSummary[];
  /** Energy and water sold since the last hourly settlement (and gas burnt). */
  meter: { electricityMWh: number; gasMWh: number; waterMl: number };
  loans: Loan[];
  nextLoanId: number;
}

export interface FireKpis {
  fires: number;
  extinguished: number;
  destroyed: number;
  /** Sum of minutes from ignition to the first engine on site, and how many responses. */
  responseMinutes: number;
  responses: number;
}

export interface WasteFigures {
  generatedT: number;
  collectedT: number;
  recycledT: number;
  landfilledT: number;
  /** Buildings whose bins were missed at the last collection. */
  missed: number;
}

/** Saved service figures, recomputed hourly (ratios) or daily (waste). */
export interface ServicesState {
  /** [facility id, share of its catchment it can serve 0..1], ascending id (police, health, school, waste). */
  ratios: [number, number][];
  /** Share of collected waste that could be tipped (recycling + landfill space), 0..1. */
  tipping: number;
  /** [landfill id, tonnes tipped so far], ascending id. */
  landfill: [number, number][];
  waste: WasteFigures;
  fireKpi: FireKpis;
  nextFireId: number;
  nextEventId: number;
  nextComplaintId: number;
}

export type HappinessFactor =
  'services' | 'utilities' | 'waste' | 'commute' | 'pollution' | 'taxes' | 'landValue';

/**
 * City happiness (residents-weighted) from the last residents round, and the
 * round in progress: each hour every building is visited once, a slice per
 * tick in id order, to collect its taxes and score its residents' happiness.
 */
export interface HappinessState {
  /** 0..100. */
  city: number;
  /** Average score of each factor, 0..1. */
  factors: Record<HappinessFactor, number>;
  /** Points lost to recent complaints. */
  complaintPenalty: number;
  /** Id of the last building visited this round; -1 between rounds. */
  cursor: number;
  /** Partial sums of the round in progress: residents, residents × score, residents × factor. */
  sumWeight: number;
  sumScore: number;
  sumFactors: Record<HappinessFactor, number>;
}

/** Air and noise pollution on the coarse pollution grid (index points × 10), recomputed hourly. */
export interface PollutionState {
  air: Uint16Array;
  noise: Uint16Array;
}

/** Derived service coverage (never saved): free-flow minutes from the nearest facility per road tile. */
export interface ServicesCache {
  minutes: Record<CoverageKind, Float32Array>;
  nearest: Record<CoverageKind, Int32Array>;
  /** Facility id -> served share, from `services.ratios`. */
  ratio: Map<number, number>;
  /** Landmark buildings (for land value), ascending id. */
  landmarks: Building[];
  /** Land value parts that change only with the layout: river and landmarks, per tile. */
  landStatic: Float32Array;
  /** Public services score per road tile (time quality × served share, no outages), 0..1. */
  roadServices: Float32Array;
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
  traffic: TrafficCache;
  services: ServicesCache;
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
  traffic: TrafficState;
  /** Street works permits, ascending id. */
  permits: Permit[];
  economy: EconomyState;
  services: ServicesState;
  /** Fires burning now, ascending id. */
  fires: Fire[];
  /** Booked, live and recent events at landmarks, ascending id. */
  events: CityEvent[];
  /** Recent complaints, oldest first. */
  complaints: Complaint[];
  happiness: HappinessState;
  pollution: PollutionState;
  /** Derived data; never saved. */
  cache: SimCache;
}

export interface NewGameOptions {
  seed: number;
  startingCash?: number;
  mapSize?: number;
  weatherEvents?: boolean;
  fires?: boolean;
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

export const emptyRoadworksKpis = (): RoadworksKpis => ({
  permits: 0,
  clashes: 0,
  combined: 0,
  combinedSavings: 0,
  overruns: 0,
  nightWorks: 0,
});

/** Traffic cells along each side of the map. */
export const trafficCellsAcross = (size: number): number => Math.ceil(size / TRAFFIC.cellSize);

const perPurpose = (n: number): Record<TripPurpose, Float64Array> =>
  Object.fromEntries(TRIP_PURPOSES.map((p) => [p, new Float64Array(n)])) as Record<
    TripPurpose,
    Float64Array
  >;

export const emptyTripTable = (cells: number): TripTable => ({
  load: new Int32Array(cells).fill(-1),
  prod: perPurpose(cells),
  attr: perPurpose(cells),
});

export function initialTrafficState(world: { width: number; height: number }): TrafficState {
  const cells = trafficCellsAcross(world.width) * trafficCellsAcross(world.height);
  return {
    cursor: -1,
    table: emptyTripTable(cells),
    pending: new Uint32Array(world.width * world.height),
    commute: new Uint16Array(cells),
    roundTrips: 0,
    roundTripMinutes: 0,
    roundFreeMinutes: 0,
    roundUnserved: 0,
    tripsPerHour: 0,
    avgTripMinutes: 0,
    congestion: 1,
    unservedPerHour: 0,
    nextPermitId: 1,
    kpi: emptyRoadworksKpis(),
  };
}

const perKind = <T>(make: () => T): Record<CoverageKind, T> =>
  Object.fromEntries(COVERAGE_KINDS.map((k) => [k, make()])) as Record<CoverageKind, T>;

export const emptyLedger = (): Ledger => ({
  income: {
    councilTax: 0,
    businessRates: 0,
    farmExports: 0,
    electricity: 0,
    water: 0,
    events: 0,
  },
  expenses: {
    capital: 0,
    maintenance: 0,
    repairs: 0,
    crews: 0,
    upkeep: 0,
    fuel: 0,
    services: 0,
    fines: 0,
    interest: 0,
  },
  borrowed: 0,
  repaid: 0,
});

export const initialEconomyState = (): EconomyState => ({
  budgets: Object.fromEntries(DEPARTMENTS.map((d) => [d, 1])) as Record<Department, number>,
  taxRates: Object.fromEntries(TAX_ZONES.map((z) => [z, 1])) as Record<ZoneId, number>,
  month: emptyLedger(),
  lastMonth: null,
  history: [],
  meter: { electricityMWh: 0, gasMWh: 0, waterMl: 0 },
  loans: [],
  nextLoanId: 1,
});

export const emptyFireKpis = (): FireKpis => ({
  fires: 0,
  extinguished: 0,
  destroyed: 0,
  responseMinutes: 0,
  responses: 0,
});

export const emptyWaste = (): WasteFigures => ({
  generatedT: 0,
  collectedT: 0,
  recycledT: 0,
  landfilledT: 0,
  missed: 0,
});

export const initialServicesState = (): ServicesState => ({
  ratios: [],
  tipping: 1,
  landfill: [],
  waste: emptyWaste(),
  fireKpi: emptyFireKpis(),
  nextFireId: 1,
  nextEventId: 1,
  nextComplaintId: 1,
});

const zeroFactors = (): Record<HappinessFactor, number> => ({
  services: 0,
  utilities: 0,
  waste: 0,
  commute: 0,
  pollution: 0,
  taxes: 0,
  landValue: 0,
});

export const initialHappiness = (): HappinessState => ({
  city: 0,
  factors: zeroFactors(),
  complaintPenalty: 0,
  cursor: -1,
  sumWeight: 0,
  sumScore: 0,
  sumFactors: zeroFactors(),
});

/** Pollution grid cells along each side of the map. */
export const pollutionCellsAcross = (size: number, cellSize: number): number =>
  Math.ceil(size / cellSize);

export function initialPollution(world: { width: number; height: number }, cellSize: number) {
  const cells =
    pollutionCellsAcross(world.width, cellSize) * pollutionCellsAcross(world.height, cellSize);
  return { air: new Uint16Array(cells), noise: new Uint16Array(cells) };
}

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
    traffic: {
      timeSec: new Float32Array(n),
      freeSec: new Float32Array(n),
      capacity: new Float32Array(n),
      crewSlow: new Float32Array(n).fill(1),
      segmentAt: new Int32Array(n),
      clashes: new Map(),
      access: new Map(),
    },
    services: {
      minutes: perKind(() => new Float32Array(n).fill(Infinity)),
      nearest: perKind(() => new Int32Array(n)),
      ratio: new Map(),
      landmarks: [],
      landStatic: new Float32Array(n),
      roadServices: new Float32Array(n),
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
    rules: { weatherEvents: opts.weatherEvents ?? true, fires: opts.fires ?? true },
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
    traffic: initialTrafficState(world),
    permits: [],
    economy: initialEconomyState(),
    services: initialServicesState(),
    fires: [],
    events: [],
    complaints: [],
    happiness: initialHappiness(),
    pollution: initialPollution(world, CITY.pollution.cellSize),
    cache: emptyCache(world),
  };
  initWeather(state);
  rebuildCache(state);
  return state;
}
