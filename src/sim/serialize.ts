/**
 * Converts SimState to and from plain JSON-safe data. Per-tile layers are
 * run-length encoded ([value, count, value, count, ...]) which keeps saves of a
 * mostly empty 128x128 map to a few kilobytes. Save-file versioning and
 * migrations live in src/platform/saveFormat.ts; this is just the state body.
 */
import { rebuildCache } from './cache';
import { buildingDef } from './data';
import { Rng } from './rng';
import { emptyCache } from './state';
import type { Building, Estate, GameRules, SimState, WeatherState } from './state';
import type { ZoneId } from './types';
import type { WorldState } from './world';

/** A building as saved: [id, code, x, y, occupancy, unpoweredMinutes, storedMWh]. */
export type SerializedBuilding = [number, number, number, number, number, number, number];

export interface SerializedWorld {
  width: number;
  height: number;
  terrain: number[];
  road: number[];
  zone: number[];
  density: number[];
  power: number[];
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
}

export function rleEncode(data: Uint8Array): number[] {
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
  if (rle.length % 2 !== 0) throw new Error('Corrupt tile data (odd RLE length).');
  const out = new Uint8Array(length);
  let pos = 0;
  for (let k = 0; k < rle.length; k += 2) {
    const v = rle[k]!;
    const run = rle[k + 1]!;
    if (!Number.isInteger(v) || v < 0 || v > 255 || !Number.isInteger(run) || run < 1) {
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
    },
    buildings: state.buildings.map((b) => [
      b.id,
      b.code,
      b.x,
      b.y,
      b.occupancy,
      b.unpoweredMinutes,
      b.storedMWh,
    ]),
    nextBuildingId: state.nextBuildingId,
    estates: state.estates.map((e) => ({ ...e })),
    nextEstateId: state.nextEstateId,
    weather: { ...state.weather, event: state.weather.event ? { ...state.weather.event } : null },
    demand: { ...state.demand },
    growthCursor: state.growthCursor,
  };
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
    cache: emptyCache(world),
  };
  rebuildCache(state);
  return state;
}

function parseBuilding(raw: unknown, world: WorldState): Building {
  if (!Array.isArray(raw) || raw.length !== 7) throw new Error('Save has a corrupt building.');
  const [id, code, x, y, occupancy, unpoweredMinutes, storedMWh] = raw.map((v) =>
    num(v, 'building data'),
  ) as SerializedBuilding;
  const def = buildingDef(code);
  if (!def) throw new Error(`Save has an unknown building type (${code}).`);
  const [fw, fd] = def.footprint;
  if (x < 0 || y < 0 || x + fw > world.width || y + fd > world.height) {
    throw new Error('Save has a building outside the map.');
  }
  return { id, code, x, y, occupancy, unpoweredMinutes, storedMWh };
}
