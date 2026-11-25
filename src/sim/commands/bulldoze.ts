import { removeBuildings } from '../buildings';
import { POWER, ROADS, WATER } from '../data';
import { rebuildEstates } from '../estates';
import { rectTiles } from '../geometry';
import { rebuildNetwork } from '../power';
import type { SimState } from '../state';
import { clearTileAsset } from '../assets';
import { depotDefOf } from '../crews';
import { rebuildFaults, removeDepotCrews, retireAsset } from '../incidents';
import { TILE_ASSET_LAYERS } from '../types';
import { assetCodeLayer } from '../world';
import { rebuildWater } from '../water';
import { buildingsOnTiles } from '../buildings';
import { demolishCost, finalisePlan, indicesInBounds, isValidCoord, rejected } from './common';
import type { BulldozeCommand, CommandPlan } from './types';

/**
 * Clear a rectangle: roads, power lines and water mains (at a demolition cost per tile),
 * buildings and facilities touching it (whole footprint, cost per tile) and
 * zoning (free).
 */
export function planBulldoze(state: SimState, cmd: BulldozeCommand): CommandPlan {
  if (!isValidCoord(cmd.from) || !isValidCoord(cmd.to)) return rejected('Invalid area.');
  const w = state.world;
  const tiles = indicesInBounds(state, rectTiles(cmd.from, cmd.to));
  const demolish = buildingsOnTiles(state, tiles);
  const affected: number[] = [];
  let cost = demolishCost(state, demolish);
  for (const i of tiles) {
    let hit = false;
    if (w.road[i] !== 0) {
      cost += ROADS.demolishCostPerTile;
      hit = true;
    }
    if (w.power[i] !== 0) {
      cost += POWER.lineDemolishCostPerTile;
      hit = true;
    }
    if (w.water[i] !== 0) {
      cost += WATER.mainDemolishCostPerTile;
      hit = true;
    }
    if (hit || w.zone[i] !== 0) affected.push(i);
  }
  return finalisePlan(
    state,
    affected,
    [],
    cost,
    ['road', 'zone', 'building', 'power', 'water', 'assets'],
    'Nothing to clear here.',
    demolish,
  );
}

export function applyBulldoze(state: SimState, _cmd: BulldozeCommand, plan: CommandPlan): void {
  const w = state.world;
  for (const id of plan.demolish) {
    const b = state.cache.byId.get(id);
    if (!b) continue;
    retireAsset(state, { layer: 'facility', id });
    if (depotDefOf(b)) removeDepotCrews(state, id);
  }
  for (const i of plan.affected) {
    for (const layer of TILE_ASSET_LAYERS) {
      if (assetCodeLayer(w, layer)[i] === 0) continue;
      retireAsset(state, { layer, id: i });
      clearTileAsset(state, layer, i);
    }
  }
  removeBuildings(state, plan.demolish);
  for (const i of plan.affected) {
    w.road[i] = 0;
    w.power[i] = 0;
    w.water[i] = 0;
    w.pressure[i] = 0;
    w.zone[i] = 0;
    w.density[i] = 0;
  }
  rebuildEstates(state);
  rebuildFaults(state);
  rebuildNetwork(state);
  rebuildWater(state);
}
