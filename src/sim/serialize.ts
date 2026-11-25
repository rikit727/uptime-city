/**
 * Converts SimState to and from plain JSON-safe data. Per-tile layers are
 * run-length encoded ([value, count, value, count, ...]) which keeps saves of a
 * mostly empty 128x128 map to a few kilobytes. Save-file versioning and
 * migrations live in src/platform/saveFormat.ts; this is just the state body.
 */
import { rebuildCache } from './cache';
import { buildingDef } from './data';
import { Rng } from './rng';
import {
  emptyCache,
  emptyKpis,
  emptyRoadworksKpis,
  initialAssetsState,
  initialTrafficState,
  initialWaterState,
} from './state';
import type {
  AssetsState,
  Building,
  Crew,
  Estate,
  GameRules,
  Incident,
  Permit,
  SimState,
  TrafficState,
  WaterState,
  WeatherState,
  WorkOrder,
} from './state';
import { TRIP_PURPOSES } from './data';
import type { TripPurpose } from './data';
import { TILE_ASSET_LAYERS } from './types';
import type { TileAssetLayer, ZoneId } from './types';
import type { PerAssetLayer, WorldState } from './world';

/**
 * A building as saved: [id, code, x, y, occupancy, unpoweredMinutes, storedMWh,
 * storedMl, dryMinutes, condition, builtDay, peakLoad].
 */
export type SerializedBuilding = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Per-layer RLE arrays (road, main, line). */
export type SerializedAssetLayers = Record<TileAssetLayer, number[]>;

export interface SerializedWorld {
  width: number;
  height: number;
  terrain: number[];
  road: number[];
  zone: number[];
  density: number[];
  power: number[];
  water: number[];
  pressure: number[];
  traffic: number[];
  condition: SerializedAssetLayers;
  laid: SerializedAssetLayers;
  peakLoad: SerializedAssetLayers;
}

export interface SerializedState {
  seed: number;
  tick: number;
  minute: number;
  rngState: number;
  cash: number;
  rules: GameRules;
  world: SerializedWorld;
  buildings: SerializedBuilding[];
  nextBuildingId: number;
  estates: Estate[];
  nextEstateId: number;
  weather: WeatherState;
  demand: Record<ZoneId, number>;
  growthCursor: number;
  water: WaterState;
  assets: AssetsState;
  incidents: Incident[];
  workOrders: WorkOrder[];
  crews: Crew[];
  traffic: SerializedTraffic;
  permits: Permit[];
}

/** Traffic state as saved: typed arrays run-length encoded. */
export type SerializedTraffic = Omit<TrafficState, 'pending' | 'commute' | 'table'> & {
  pending: number[];
  commute: number[];
  table: {
    load: number[];
    prod: Record<TripPurpose, number[]>;
    attr: Record<TripPurpose, number[]>;
  };
};

export function rleEncode(data: ArrayLike<number>): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i]!;
    let run = 1;
    while (i + run < data.length && data[i + run] === v) run++;
    out.push(v, run);
    i += run;
  }
  return out;
}

export function rleDecode(rle: readonly number[], length: number): Uint8Array {
  return rleDecodeInto(rle, new Uint8Array(length), 255);
}

export function rleDecode16(rle: readonly number[], length: number): Uint16Array {
  return rleDecodeInto(rle, new Uint16Array(length), 65535);
}

/** Decode RLE into a float or int array (values may be negative or fractional). */
function rleDecodeNumbers<T extends Float64Array | Int32Array>(
  rle: readonly number[],
  out: T,
  integer: boolean,
): T {
  if (!Array.isArray(rle) || rle.length % 2 !== 0) throw new Error('Corrupt traffic data.');
  let pos = 0;
  for (let k = 0; k < rle.length; k += 2) {
    const v = rle[k]!;
    const run = rle[k + 1]!;
    if (typeof v !== 'number' || !Number.isFinite(v) || (integer && !Number.isInteger(v))) {
      throw new Error('Corrupt traffic data.');
    }
    if (!Number.isInteger(run) || run < 1 || pos + run > out.length) {
      throw new Error('Corrupt traffic data.');
    }
    out.fill(v, pos, pos + run);
    pos += run;
  }
  if (pos !== out.length) throw new Error('Corrupt traffic data.');
  return out;
}

const encodePurposes = (r: Record<TripPurpose, Float64Array>): Record<TripPurpose, number[]> =>
  Object.fromEntries(TRIP_PURPOSES.map((p) => [p, rleEncode(r[p])])) as Record<
    TripPurpose,
    number[]
  >;

export function rleDecode32(rle: readonly number[], length: number): Uint32Array {
  return rleDecodeInto(rle, new Uint32Array(length), 0xffffffff);
}

function rleDecodeInto<T extends Uint8Array | Uint16Array | Uint32Array>(
  rle: readonly number[],
  out: T,
  max: number,
): T {
  if (!Array.isArray(rle) || rle.length % 2 !== 0) {
    throw new Error('Corrupt tile data (odd RLE length).');
  }
  const length = out.length;
  let pos = 0;
  for (let k = 0; k < rle.length; k += 2) {
    const v = rle[k]!;
    const run = rle[k + 1]!;
    if (!Number.isInteger(v) || v < 0 || v > max || !Number.isInteger(run) || run < 1) {
      throw new Error('Corrupt tile data (bad RLE pair).');
    }
    if (pos + run > length) throw new Error('Corrupt tile data (too long).');
    out.fill(v, pos, pos + run);
    pos += run;
  }
  if (pos !== length) throw new Error('Corrupt tile data (too short).');
  return out;
}

export function serializeState(state: SimState): SerializedState {
  const w = state.world;
  return {
    seed: state.seed,
    tick: state.tick,
    minute: state.minute,
    rngState: state.rng.state,
    cash: state.cash,
    rules: { ...state.rules },
    world: {
      width: w.width,
      height: w.height,
      terrain: rleEncode(w.terrain),
      road: rleEncode(w.road),
      zone: rleEncode(w.zone),
      density: rleEncode(w.density),
      power: rleEncode(w.power),
      water: rleEncode(w.water),
      pressure: rleEncode(w.pressure),
      traffic: rleEncode(w.traffic),
      condition: encodeLayers(w.condition),
      laid: encodeLayers(w.laid),
      peakLoad: encodeLayers(w.peakLoad),
    },
    buildings: state.buildings.map((b) => [
      b.id,
      b.code,
      b.x,
      b.y,
      b.occupancy,
      b.unpoweredMinutes,
      b.storedMWh,
      b.storedMl,
      b.dryMinutes,
      b.condition,
      b.builtDay,
      b.peakLoad,
    ]),
    nextBuildingId: state.nextBuildingId,
    estates: state.estates.map((e) => ({ ...e })),
    nextEstateId: state.nextEstateId,
    weather: { ...state.weather, event: state.weather.event ? { ...state.weather.event } : null },
    demand: { ...state.demand },
    growthCursor: state.growthCursor,
    water: { ...state.water },
    assets: { ...state.assets, kpi: { ...state.assets.kpi } },
    incidents: state.incidents.map((i) => ({ ...i, asset: i.asset ? { ...i.asset } : null })),
    workOrders: state.workOrders.map((o) => ({ ...o, asset: { ...o.asset } })),
    crews: state.crews.map((c) => ({ ...c, path: [...c.path] })),
    traffic: {
      ...state.traffic,
      pending: rleEncode(state.traffic.pending),
      commute: rleEncode(state.traffic.commute),
      table: {
        load: rleEncode(state.traffic.table.load),
        prod: encodePurposes(state.traffic.table.prod),
        attr: encodePurposes(state.traffic.table.attr),
      },
      kpi: { ...state.traffic.kpi },
    },
    permits: state.permits.map((p) => ({
      ...p,
      tiles: [...p.tiles],
      orders: [...p.orders],
      dug: [...p.dug],
    })),
  };
}

function encodeLayers(layers: PerAssetLayer<ArrayLike<number>>): SerializedAssetLayers {
  return {
    road: rleEncode(layers.road),
    main: rleEncode(layers.main),
    line: rleEncode(layers.line),
  };
}

function decodeLayers<T>(
  raw: unknown,
  what: string,
  decode: (rle: readonly number[]) => T,
): PerAssetLayer<T> {
  if (typeof raw !== 'object' || raw === null) throw new Error(`Save is missing ${what}.`);
  const r = raw as Record<string, unknown>;
  const out = {} as PerAssetLayer<T>;
  for (const layer of TILE_ASSET_LAYERS) out[layer] = decode(arr(r[layer], `${what} (${layer})`));
  return out;
}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Save is missing ${what}.`);
  return v;
}

function arr(v: unknown, what: string): number[] {
  if (!Array.isArray(v)) throw new Error(`Save is missing ${what}.`);
  return v as number[];
}

export function deserializeState(data: SerializedState): SimState {
  const wd = data.world;
  if (typeof wd !== 'object' || wd === null) throw new Error('Save is missing the world.');
  const width = num(wd.width, 'world width');
  const height = num(wd.height, 'world height');
  if (width < 1 || height < 1 || width > 1024 || height > 1024) {
    throw new Error('Save has an invalid map size.');
  }
  const n = width * height;
  const world: WorldState = {
    width,
    height,
    terrain: rleDecode(arr(wd.terrain, 'terrain'), n),
    road: rleDecode(arr(wd.road, 'roads'), n),
    zone: rleDecode(arr(wd.zone, 'zones'), n),
    density: rleDecode(arr(wd.density, 'densities'), n),
    power: rleDecode(arr(wd.power, 'power lines'), n),
    water: rleDecode(arr(wd.water, 'water mains'), n),
    pressure: rleDecode(arr(wd.pressure, 'water pressures'), n),
    traffic: rleDecode16(arr(wd.traffic, 'traffic flows'), n),
    condition: decodeLayers(wd.condition, 'asset condition', (r) => rleDecode16(r, n)),
    laid: decodeLayers(wd.laid, 'asset ages', (r) => rleDecode16(r, n)),
    peakLoad: decodeLayers(wd.peakLoad, 'asset loads', (r) => rleDecode(r, n)),
  };
  const buildings = arr(data.buildings, 'buildings').map((raw) => parseBuilding(raw, world));
  for (let k = 1; k < buildings.length; k++) {
    if (buildings[k]!.id <= buildings[k - 1]!.id) throw new Error('Save has corrupt buildings.');
  }
  const rules = data.rules as Partial<GameRules> | undefined;
  if (typeof data.weather !== 'object' || data.weather === null) {
    throw new Error('Save is missing the weather.');
  }
  for (const [k, v] of Object.entries(data.weather)) {
    if (k !== 'event' && k !== 'wetDay') num(v, `weather ${k}`);
  }
  const demand = data.demand;
  if (typeof demand !== 'object' || demand === null) throw new Error('Save is missing demand.');
  const state: SimState = {
    seed: num(data.seed, 'seed') >>> 0,
    tick: num(data.tick, 'tick'),
    minute: num(data.minute, 'time'),
    rng: new Rng(num(data.rngState, 'RNG state')),
    cash: num(data.cash, 'cash'),
    rules: { weatherEvents: rules?.weatherEvents !== false },
    world,
    buildings,
    nextBuildingId: num(data.nextBuildingId, 'building counter'),
    estates: arr(data.estates, 'estates').map((e) => {
      const r = e as unknown as Estate;
      if (typeof r.name !== 'string') throw new Error('Save has a corrupt estate.');
      return { id: num(r.id, 'estate id'), name: r.name, anchor: num(r.anchor, 'estate anchor') };
    }),
    nextEstateId: num(data.nextEstateId, 'estate counter'),
    weather: {
      ...data.weather,
      event: data.weather.event ? { ...data.weather.event } : null,
    },
    demand: { ...demand },
    growthCursor: num(data.growthCursor, 'growth cursor') % n,
    water: parseWater(data.water),
    assets: parseAssets(data.assets),
    incidents: parseList(data.incidents, 'incidents', parseIncident),
    workOrders: parseList(data.workOrders, 'work orders', parseOrder),
    crews: parseList(data.crews, 'crews', parseCrew),
    traffic: parseTraffic(data.traffic, world),
    permits: parseList(data.permits, 'permits', parsePermit),
    cache: emptyCache(world),
  };
  rebuildCache(state);
  return state;
}

function parseWater(raw: unknown): WaterState {
  if (typeof raw !== 'object' || raw === null) throw new Error('Save is missing the water state.');
  const r = raw as Record<string, unknown>;
  const out = initialWaterState();
  for (const k of Object.keys(out) as (keyof WaterState)[]) {
    const v = r[k];
    if (typeof out[k] === 'boolean') (out as unknown as Record<string, boolean>)[k] = v === true;
    else (out as unknown as Record<string, number>)[k] = num(v, `water ${k}`);
  }
  return out;
}

function parseAssets(raw: unknown): AssetsState {
  if (typeof raw !== 'object' || raw === null) throw new Error('Save is missing the asset state.');
  const r = raw as Record<string, unknown>;
  const out = initialAssetsState();
  out.cursor = num(r.cursor, 'asset cursor');
  out.nextIncidentId = num(r.nextIncidentId, 'incident counter');
  out.nextOrderId = num(r.nextOrderId, 'work order counter');
  out.nextCrewId = num(r.nextCrewId, 'crew counter');
  const kpi = (r.kpi ?? {}) as Record<string, unknown>;
  const k = emptyKpis();
  for (const key of Object.keys(k) as (keyof typeof k)[]) k[key] = num(kpi[key], `KPI ${key}`);
  out.kpi = k;
  return out;
}

/** Parse a saved list of records, checking ids ascend. */
function parseList<T extends { id: number }>(
  raw: unknown,
  what: string,
  parse: (r: Record<string, unknown>) => T,
): T[] {
  const list = arr(raw, what) as unknown[];
  const out = list.map((item) => {
    if (typeof item !== 'object' || item === null) throw new Error(`Save has corrupt ${what}.`);
    return parse(item as Record<string, unknown>);
  });
  for (let k = 1; k < out.length; k++) {
    if (out[k]!.id <= out[k - 1]!.id) throw new Error(`Save has corrupt ${what}.`);
  }
  return out;
}

const ASSET_LAYERS = new Set(['road', 'main', 'line', 'facility']);

function parseRef(raw: unknown): { layer: 'road' | 'main' | 'line' | 'facility'; id: number } {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r.layer !== 'string' || !ASSET_LAYERS.has(r.layer)) {
    throw new Error('Save has a corrupt asset reference.');
  }
  return { layer: r.layer as 'road', id: num(r.id, 'asset id') };
}

function oneOf<T extends string>(v: unknown, options: readonly T[], what: string): T {
  if (typeof v !== 'string' || !options.includes(v as T))
    throw new Error(`Save has a corrupt ${what}.`);
  return v as T;
}

function parseIncident(r: Record<string, unknown>): Incident {
  return {
    id: num(r.id, 'incident id'),
    kind: oneOf(
      r.kind,
      ['burst', 'cableFault', 'roadDefect', 'facilityFault', 'overflow'],
      'incident',
    ),
    title: typeof r.title === 'string' ? r.title : 'Incident',
    asset: r.asset === null ? null : parseRef(r.asset),
    tile: num(r.tile, 'incident tile'),
    openedMinute: num(r.openedMinute, 'incident time'),
    slaMinutes: num(r.slaMinutes, 'incident SLA'),
    resolvedMinute: num(r.resolvedMinute, 'incident time'),
    outcome: oneOf(r.outcome, ['', 'repaired', 'removed', 'cleared'], 'incident'),
    severity: num(r.severity, 'incident severity'),
    customers: num(r.customers, 'incident customers'),
    peakCustomers: num(r.peakCustomers, 'incident customers'),
    priorityCustomers: num(r.priorityCustomers, 'incident customers'),
    customerMinutes: num(r.customerMinutes, 'incident customer-minutes'),
    bottledWater: r.bottledWater === true,
    slaBreached: r.slaBreached === true,
    orderId: num(r.orderId, 'incident work order'),
  };
}

function parseOrder(r: Record<string, unknown>): WorkOrder {
  return {
    id: num(r.id, 'work order id'),
    type: oneOf(r.type, ['repair', 'maintenance'], 'work order'),
    crew: oneOf(r.crew, ['roads', 'water', 'power'], 'work order'),
    asset: parseRef(r.asset),
    tile: num(r.tile, 'work order tile'),
    incidentId: num(r.incidentId, 'work order incident'),
    priority: num(r.priority, 'work order priority'),
    manualPriority: r.manualPriority === true,
    status: oneOf(r.status, ['queued', 'enRoute', 'onSite'], 'work order'),
    createdMinute: num(r.createdMinute, 'work order time'),
    workMinutes: num(r.workMinutes, 'work order duration'),
    cost: num(r.cost, 'work order cost'),
    prepaid: r.prepaid === true,
    crewId: num(r.crewId, 'work order crew'),
    startedMinute: num(r.startedMinute, 'work order time'),
    closure: oneOf(r.closure, ['none', 'lane', 'full'], 'work order'),
    night: r.night === true,
    permitId: num(r.permitId, 'work order permit'),
    combined: r.combined === true,
  };
}

function parseTraffic(raw: unknown, world: WorldState): TrafficState {
  if (typeof raw !== 'object' || raw === null)
    throw new Error('Save is missing the traffic state.');
  const r = raw as Record<string, unknown>;
  const out = initialTrafficState(world);
  out.cursor = num(r.cursor, 'traffic cursor');
  out.pending = rleDecode32(arr(r.pending, 'traffic round'), world.width * world.height);
  out.commute = rleDecode16(arr(r.commute, 'commute times'), out.commute.length);
  const table = r.table as Record<string, unknown> | undefined;
  if (typeof table !== 'object' || table === null) throw new Error('Save is missing trip data.');
  rleDecodeNumbers(arr(table.load, 'trip data'), out.table.load, true);
  for (const part of ['prod', 'attr'] as const) {
    const rec = (table[part] ?? {}) as Record<string, unknown>;
    for (const p of TRIP_PURPOSES) {
      rleDecodeNumbers(arr(rec[p], 'trip data'), out.table[part][p], false);
    }
  }
  for (const k of [
    'roundTrips',
    'roundTripMinutes',
    'roundFreeMinutes',
    'roundUnserved',
    'tripsPerHour',
    'avgTripMinutes',
    'congestion',
    'unservedPerHour',
    'nextPermitId',
  ] as const) {
    out[k] = num(r[k], `traffic ${k}`);
  }
  const kpi = (r.kpi ?? {}) as Record<string, unknown>;
  const k = emptyRoadworksKpis();
  for (const key of Object.keys(k) as (keyof typeof k)[]) k[key] = num(kpi[key], `KPI ${key}`);
  out.kpi = k;
  return out;
}

const numList = (v: unknown, what: string): number[] => arr(v, what).map((x) => num(x, what));

function parsePermit(r: Record<string, unknown>): Permit {
  return {
    id: num(r.id, 'permit id'),
    kind: oneOf(r.kind, ['planned', 'emergency'], 'permit'),
    tiles: numList(r.tiles, 'permit tiles'),
    start: num(r.start, 'permit time'),
    end: num(r.end, 'permit time'),
    night: r.night === true,
    closure: oneOf(r.closure, ['lane', 'full'], 'permit'),
    orders: numList(r.orders, 'permit orders'),
    overrun: r.overrun === true,
    combined: r.combined === true,
    dug: numList(r.dug, 'permit tiles'),
  };
}

function parseCrew(r: Record<string, unknown>): Crew {
  return {
    id: num(r.id, 'crew id'),
    type: oneOf(r.type, ['roads', 'water', 'power'], 'crew'),
    depot: num(r.depot, 'crew depot'),
    status: oneOf(r.status, ['idle', 'enRoute', 'onSite', 'returning'], 'crew'),
    orderId: num(r.orderId, 'crew work order'),
    path: arr(r.path, 'crew route').map((v) => num(v, 'crew route')),
    departMinute: num(r.departMinute, 'crew time'),
    arriveMinute: num(r.arriveMinute, 'crew time'),
    tile: num(r.tile, 'crew tile'),
  };
}

function parseBuilding(raw: unknown, world: WorldState): Building {
  if (!Array.isArray(raw) || raw.length !== 12) throw new Error('Save has a corrupt building.');
  const [
    id,
    code,
    x,
    y,
    occupancy,
    unpoweredMinutes,
    storedMWh,
    storedMl,
    dryMinutes,
    condition,
    builtDay,
    peakLoad,
  ] = raw.map((v) => num(v, 'building data')) as SerializedBuilding;
  const def = buildingDef(code);
  if (!def) throw new Error(`Save has an unknown building type (${code}).`);
  const [fw, fd] = def.footprint;
  if (x < 0 || y < 0 || x + fw > world.width || y + fd > world.height) {
    throw new Error('Save has a building outside the map.');
  }
  return {
    id,
    code,
    x,
    y,
    occupancy,
    unpoweredMinutes,
    storedMWh,
    storedMl,
    dryMinutes,
    condition,
    builtDay,
    peakLoad,
  };
}
