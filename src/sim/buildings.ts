/**
 * Building bookkeeping shared by commands and systems: footprints, adding and
 * removing buildings (keeping the tile index in the cache in step), and the
 * per-building figures (residents, jobs) that other systems aggregate.
 */
import { buildingDef } from './data';
import type { BuildingDef, GrownBuildingDef } from './data';
import type { Building, SimState } from './state';
import { dayOf } from './time';
import { tileIndex } from './world';
import type { WorldState } from './world';

export function defOf(b: Building): BuildingDef {
  const def = buildingDef(b.code);
  if (!def) throw new Error(`Unknown building code ${b.code}`);
  return def;
}

export function grownDefOf(b: Building): GrownBuildingDef | undefined {
  const def = buildingDef(b.code);
  return def?.role === 'grown' ? def : undefined;
}

/** Tile indices covered by a footprint at (x, y). Assumes it is in bounds. */
export function footprintTiles(w: WorldState, x: number, y: number, def: BuildingDef): number[] {
  const [fw, fd] = def.footprint;
  const out: number[] = [];
  for (let dy = 0; dy < fd; dy++)
    for (let dx = 0; dx < fw; dx++) out.push(tileIndex(w, x + dx, y + dy));
  return out;
}

export const buildingTiles = (state: SimState, b: Building): number[] =>
  footprintTiles(state.world, b.x, b.y, defOf(b));

/** Footprint centre tile (used for substation distance). */
export function centreOf(b: Building): { x: number; y: number } {
  const [fw, fd] = defOf(b).footprint;
  return { x: b.x + (fw - 1) / 2, y: b.y + (fd - 1) / 2 };
}

export function buildingAtTile(state: SimState, tile: number): Building | undefined {
  const id = state.cache.buildingAt[tile] ?? 0;
  return id === 0 ? undefined : state.cache.byId.get(id);
}

/** Add a building (caller has validated the footprint). Returns it. */
export function addBuilding(
  state: SimState,
  code: number,
  x: number,
  y: number,
  occupancy: number,
): Building {
  const b: Building = {
    id: state.nextBuildingId++,
    code,
    x,
    y,
    occupancy,
    unpoweredMinutes: 0,
    storedMWh: 0,
    storedMl: 0,
    dryMinutes: 0,
    condition: 100,
    builtDay: dayOf(state.minute),
    peakLoad: 0,
  };
  state.buildings.push(b);
  indexBuilding(state, b);
  return b;
}

function indexBuilding(state: SimState, b: Building): void {
  state.cache.byId.set(b.id, b);
  for (const t of buildingTiles(state, b)) state.cache.buildingAt[t] = b.id;
}

/** Remove buildings by id. Returns how many were removed. */
export function removeBuildings(state: SimState, ids: readonly number[]): number {
  if (ids.length === 0) return 0;
  const gone = new Set(ids);
  const cache = state.cache;
  for (const id of gone) {
    const b = cache.byId.get(id);
    if (!b) continue;
    for (const t of buildingTiles(state, b)) cache.buildingAt[t] = 0;
    cache.byId.delete(id);
    cache.loadKw.delete(id);
    cache.outputMW.delete(id);
    cache.waterFlowLps.delete(id);
    cache.waterUseLps.delete(id);
  }
  const before = state.buildings.length;
  state.buildings = state.buildings.filter((b) => !gone.has(b.id));
  return before - state.buildings.length;
}

/** Rebuild the tile -> building index from the building list. */
export function rebuildBuildingIndex(state: SimState): void {
  state.cache.buildingAt.fill(0);
  state.cache.byId.clear();
  for (const b of state.buildings) indexBuilding(state, b);
}

/** Distinct building ids found on the given tiles, in ascending order. */
export function buildingsOnTiles(state: SimState, tiles: readonly number[]): number[] {
  const ids = new Set<number>();
  for (const t of tiles) {
    const id = state.cache.buildingAt[t] ?? 0;
    if (id !== 0) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}

export const residentsOf = (b: Building): number => {
  const def = grownDefOf(b);
  return def ? Math.round(def.residents * b.occupancy) : 0;
};

export const jobsOf = (b: Building): number => {
  const def = defOf(b);
  return def.role === 'grown' ? Math.round(def.jobs * b.occupancy) : def.jobs;
};
