import { buildingTiles } from '../buildings';
import { BUILDINGS, buildingDef } from '../data';
import type { SimState } from '../state';
import type { TileCoord } from '../types';
import { inBounds, tileIndex } from '../world';
import type { CommandPlan, Layer } from './types';

/** Convert coords to tile indices, dropping any outside the map. */
export function indicesInBounds(state: SimState, tiles: readonly TileCoord[]): number[] {
  const w = state.world;
  const out: number[] = [];
  for (const t of tiles) if (inBounds(w, t.x, t.y)) out.push(tileIndex(w, t.x, t.y));
  return out;
}

export function isValidCoord(c: unknown): c is TileCoord {
  if (typeof c !== 'object' || c === null) return false;
  const { x, y } = c as Record<string, unknown>;
  return Number.isInteger(x) && Number.isInteger(y);
}

export function rejected(reason: string, blocked: number[] = []): CommandPlan {
  return {
    ok: false,
    reason,
    cost: 0,
    affected: [],
    blocked,
    layers: [],
    demolish: [],
    removed: [],
  };
}

/** Footprint tiles of the given buildings. */
export function tilesOfBuildings(state: SimState, ids: readonly number[]): number[] {
  const out: number[] = [];
  for (const id of ids) {
    const b = state.cache.byId.get(id);
    if (b) out.push(...buildingTiles(state, b));
  }
  return out;
}

/** Finish a plan: fail if nothing changes or the player cannot afford it. */
export function finalisePlan(
  state: SimState,
  affected: number[],
  blocked: number[],
  cost: number,
  layers: Layer[],
  nothingReason: string,
  demolish: number[] = [],
): CommandPlan {
  const removed = tilesOfBuildings(state, demolish);
  if (affected.length === 0 && demolish.length === 0) {
    return {
      ok: false,
      reason: nothingReason,
      cost: 0,
      affected,
      blocked,
      layers: [],
      demolish,
      removed,
    };
  }
  if (cost > state.cash) {
    return {
      ok: false,
      reason: `Not enough cash: this costs £${cost.toLocaleString('en-GB')}.`,
      cost,
      affected,
      blocked,
      layers,
      demolish,
      removed,
    };
  }
  return { ok: true, cost, affected, blocked, layers, demolish, removed };
}

/** Grown-building ids on these tiles, and which tiles hold a facility (by utility). */
export function buildingsUnder(
  state: SimState,
  tiles: readonly number[],
): {
  grown: number[];
  facilityTiles: Set<number>;
  powerTiles: Set<number>;
  waterTiles: Set<number>;
  depotTiles: Set<number>;
} {
  const grown = new Set<number>();
  const facilityTiles = new Set<number>();
  const powerTiles = new Set<number>();
  const waterTiles = new Set<number>();
  const depotTiles = new Set<number>();
  for (const t of tiles) {
    const id = state.cache.buildingAt[t] ?? 0;
    if (id === 0) continue;
    const b = state.cache.byId.get(id)!;
    const def = buildingDef(b.code);
    if (def?.role === 'facility') {
      facilityTiles.add(t);
      (def.utility === 'power'
        ? powerTiles
        : def.utility === 'water'
          ? waterTiles
          : depotTiles
      ).add(t);
    } else grown.add(id);
  }
  return {
    grown: [...grown].sort((a, b) => a - b),
    facilityTiles,
    powerTiles,
    waterTiles,
    depotTiles,
  };
}

/** Demolition cost for buildings: per footprint tile. */
export const demolishCost = (state: SimState, ids: readonly number[]): number =>
  tilesOfBuildings(state, ids).length * BUILDINGS.demolishCostPerTile;

/** Turn a plan into a refusal while keeping its tiles for the preview. */
export const refuse = (plan: CommandPlan, reason: string): CommandPlan => ({
  ...plan,
  ok: false,
  reason,
  layers: [],
});
