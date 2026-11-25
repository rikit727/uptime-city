import { WATER, mainType } from '../data';
import { rebuildEstates } from '../estates';
import { roadPath } from '../geometry';
import type { SimState } from '../state';
import { rebuildWater } from '../water';
import { isWater } from '../world';
import {
  buildingsUnder,
  finalisePlan,
  indicesInBounds,
  isValidCoord,
  refuse,
  rejected,
} from './common';
import type { BuildMainCommand, CommandPlan } from './types';

/**
 * Lay a water main along an L-shaped path (like roads). Roads already come with
 * a 150 mm distribution main; this lays mains off-road or upgrades them to a
 * larger size (never down). Mains share tiles with roads and power lines, cross
 * the river on pipe bridges at a cost multiplier, pass through water facilities
 * (which connect anyway) and are blocked by grown buildings and power facilities.
 * Zoning under a new main is removed.
 */
export function planBuildMain(state: SimState, cmd: BuildMainCommand): CommandPlan {
  if (!isValidCoord(cmd.from) || !isValidCoord(cmd.to)) return rejected('Invalid main position.');
  let def;
  try {
    def = mainType(cmd.main);
  } catch {
    return rejected('Unknown main type.');
  }
  const w = state.world;
  const path = indicesInBounds(state, roadPath(cmd.from, cmd.to));
  const { grown, powerTiles, waterTiles } = buildingsUnder(state, path);
  const affected: number[] = [];
  const blocked: number[] = [];
  let cost = 0;
  for (const i of path) {
    if (waterTiles.has(i) || w.water[i]! >= def.code) continue;
    if (powerTiles.has(i) || (state.cache.buildingAt[i] ?? 0) !== 0) {
      blocked.push(i);
      continue;
    }
    affected.push(i);
    cost += def.costPerTile * (isWater(w, i) ? WATER.mainWaterCostMultiplier : 1);
  }
  const plan = finalisePlan(
    state,
    affected,
    blocked,
    cost,
    ['zone', 'water'],
    `There is already a main this size or larger here.`,
  );
  if (powerTiles.size > 0) return refuse(plan, 'A power facility is in the way.');
  return grown.length > 0 ? refuse(plan, 'A building is in the way. Bulldoze it first.') : plan;
}

export function applyBuildMain(state: SimState, cmd: BuildMainCommand, plan: CommandPlan): void {
  const code = mainType(cmd.main).code;
  const w = state.world;
  let rezoned = false;
  for (const i of plan.affected) {
    w.water[i] = code;
    if (w.zone[i] !== 0) rezoned = true;
    w.zone[i] = 0;
    w.density[i] = 0;
  }
  if (rezoned) rebuildEstates(state);
  rebuildWater(state);
}
