import { rebuildServices } from '../services';
import { removeBuildings } from '../buildings';
import { ROADS, mainType, roadClass } from '../data';
import { rebuildEstates } from '../estates';
import { roadPath } from '../geometry';
import type { SimState } from '../state';
import { layTileAsset } from '../assets';
import { retireAsset } from '../incidents';
import { rebuildTraffic } from '../traffic';
import { rebuildWater } from '../water';
import { isWater } from '../world';
import {
  buildingsUnder,
  demolishCost,
  finalisePlan,
  indicesInBounds,
  isValidCoord,
  refuse,
  rejected,
} from './common';
import type { BuildRoadCommand, CommandPlan } from './types';

/**
 * Lay a road along an L-shaped path. Existing roads of another class are
 * replaced (upgrade or downgrade) at the full cost of the new class; tiles that
 * already carry this class are skipped. Roads over water become bridges at a
 * cost multiplier. A road over zoned land removes the zoning, and over a grown
 * building (including a farm) demolishes it. Facilities block roads; power
 * lines and water mains can share a tile with a road. Every road comes with a
 * sewer and, where there is no main yet, a 150 mm distribution main (included
 * in the road's cost).
 */
export function planBuildRoad(state: SimState, cmd: BuildRoadCommand): CommandPlan {
  if (!isValidCoord(cmd.from) || !isValidCoord(cmd.to)) return rejected('Invalid road position.');
  let def;
  try {
    def = roadClass(cmd.roadClass);
  } catch {
    return rejected('Unknown road type.');
  }
  const w = state.world;
  const path = indicesInBounds(state, roadPath(cmd.from, cmd.to));
  const { grown, facilityTiles } = buildingsUnder(state, path);
  const affected: number[] = [];
  const blocked: number[] = [];
  let cost = 0;
  for (const i of path) {
    if (facilityTiles.has(i)) {
      blocked.push(i);
      continue;
    }
    if (w.road[i] === def.code) continue;
    affected.push(i);
    cost += def.costPerTile * (isWater(w, i) ? ROADS.bridgeCostMultiplier : 1);
  }
  cost += demolishCost(state, grown);
  const plan = finalisePlan(
    state,
    affected,
    blocked,
    cost,
    ['road', 'zone', 'building', 'water', 'traffic'],
    `There is already a ${def.name.toLowerCase()} here.`,
    grown,
  );
  return blocked.length > 0 ? refuse(plan, 'A facility is in the way.') : plan;
}

export function applyBuildRoad(state: SimState, cmd: BuildRoadCommand, plan: CommandPlan): void {
  const code = roadClass(cmd.roadClass).code;
  const main = mainType('distribution').code;
  const w = state.world;
  removeBuildings(state, plan.demolish);
  let rezoned = false;
  for (const i of plan.affected) {
    if (w.road[i] !== 0) retireAsset(state, { layer: 'road', id: i });
    w.road[i] = code;
    layTileAsset(state, 'road', i);
    if (w.water[i] === 0) {
      w.water[i] = main;
      layTileAsset(state, 'main', i);
    }
    if (w.zone[i] !== 0) rezoned = true;
    w.zone[i] = 0;
    w.density[i] = 0;
  }
  if (rezoned) rebuildEstates(state);
  rebuildWater(state);
  rebuildTraffic(state);
  rebuildServices(state);
}
